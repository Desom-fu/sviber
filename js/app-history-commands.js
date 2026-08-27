// History navigation, recovery dialogs, playback transport shortcuts and the
// composition root for the command-related traits.

import { composeTraits } from "./mixin.js";
import { i18n } from "./i18n.js";
import { uniqueChartFilename } from "./core/project.js";
import { Rational } from "./core/rational.js";
import { LAST_OPEN_KEY, RECENT_OPEN_KEY, deepClone, localizedErrorMessage } from "./app-helpers.js";
import { listRunnableMacros, runChosenMacro } from "./app-macro-bridge.js";
import { withCommandBindings } from "./app-command-bindings.js";
import { withEventTools } from "./app-event-tools.js";
import { withChannelCommands } from "./app-channel-commands.js";
export { toggledCreationMode } from "./app-event-tools.js";

class HistoryCommandsTrait {
	goToHistory(index) {
		if (this.model.editor.readOnly) {
			return false;
		}
		if (this.freeTransform) {
			this.cancelFreeTransform();
		}
		this.cancelPreview();
		this.creationMode = null;
		this.curveDraft = null;
		this.restoreHistorySnapshot(this.history.goTo(index));
		this.curveDraft = deepClone(this.history.currentMetadata?.curveDraft || null);
		this.updateDirty();
		this.queueMediaSync();
		this.refresh();
		return true;
	}

	undo() {
		if (this.freeTransform) {
			this.cancelFreeTransform();
		}
		this.cancelPreview();
		const previousMode = this.creationMode;
		const creationAction = this.history.currentMetadata?.creationMode;
		this.creationMode = creationAction ? previousMode || creationAction : null;
		this.curveDraft = null;
		const snapshot = this.history.undo();
		if (!snapshot) {
			return;
		}
		this.restoreHistorySnapshot(snapshot);
		this.curveDraft = deepClone(this.history.currentMetadata?.curveDraft || null);
		this.updateDirty();
		this.queueMediaSync();
		this.refresh();
	}

	redo() {
		if (this.freeTransform) {
			this.cancelFreeTransform();
		}
		this.cancelPreview();
		const previousMode = this.creationMode;
		const creationAction = this.history.entries[this.history.cursor + 1]?.metadata?.creationMode;
		this.creationMode = creationAction ? previousMode || creationAction : null;
		this.curveDraft = null;
		const snapshot = this.history.redo();
		if (!snapshot) {
			return;
		}
		this.restoreHistorySnapshot(snapshot);
		this.curveDraft = deepClone(this.history.currentMetadata?.curveDraft || null);
		this.updateDirty();
		this.queueMediaSync();
		this.refresh();
	}

	recentOpens() {
		try {
			const parsed = JSON.parse(localStorage.getItem(RECENT_OPEN_KEY) || "[]");
			if (Array.isArray(parsed) && parsed.length) {
				return parsed.filter(item => item?.path && ["project", "chart"].includes(item.kind));
			}
		} catch {
			/* Ignore a damaged recent list. */
		}
		try {
			const last = JSON.parse(localStorage.getItem(LAST_OPEN_KEY) || "null");
			if (last?.path && ["project", "chart"].includes(last.kind)) {
				return [last];
			}
		} catch {
			/* Ignore a damaged last-open record. */
		}
		return [];
	}

	async openRecent() {
		this.exitModes();
		const recent = this.recentOpens();
		if (!recent.length) {
			this.toast?.show("toast.noRecentFiles");
			return;
		}
		const values = await this.dialogs.form({
			titleKey: "dialog.openRecent",
			values: { item: `${recent[0].kind}:${recent[0].path}` },
			fields: [
				{
					id: "item",
					type: "select",
					labelKey: "field.recentFile",
					options: recent.map(item => ({
						value: `${item.kind}:${item.path}`,
						label: `${item.title || i18n.t("field.untitled")} — ${item.path}`,
					})),
				},
			],
		});
		if (!values) {
			return;
		}
		const [kind, ...rest] = String(values.item).split(":");
		const entry = { kind, path: rest.join(":") };
		let opened;
		if (entry.kind === "project") {
			opened = await this.openProject({ directoryPath: entry.path });
		} else {
			opened = await this.openFile(await this.files.fileFromLocalPath(entry.path));
		}
		if (!opened) {
			this.toast?.error("toast.openFailed", { message: i18n.t("toast.recentUnavailable") });
		}
	}

	// v17 splits the picker from the follow-up prompts so that app-project-files.js can
	// reuse the list while applying the project-aware decision tree.
	async chooseRecentEntry() {
		const recent = this.recentOpens();
		if (!recent.length) {
			this.toast?.show("toast.noRecentFiles");
			return null;
		}
		const values = await this.dialogs.form({
			titleKey: "dialog.openRecent",
			values: { item: `${recent[0].kind}:${recent[0].path}` },
			fields: [
				{
					id: "item",
					type: "select",
					labelKey: "field.recentFile",
					options: recent.map(item => ({
						value: `${item.kind}:${item.path}`,
						label: `${item.title || i18n.t("field.untitled")} — ${item.path}`,
					})),
				},
			],
		});
		if (!values) {
			return null;
		}
		const [kind, ...rest] = String(values.item).split(":");
		return { kind, path: rest.join(":") };
	}

	async applyAutosaveRecovery(recovery) {
		const source = recovery?.source && typeof recovery.source === "object" ? recovery.source : {};
		const projectPath = String(source.projectPath || "");
		if (globalThis.nw && projectPath) {
			try {
				const opened = await this.openProject({
					directoryPath: projectPath,
					skipUnsaved: true,
					silent: true,
				});
				if (opened) {
					const filename =
						String(source.chartFilename || "") ||
						this.difficulties.find(entry => entry.id === this.activeDifficultyId)?.file ||
						this.difficulties[0]?.file ||
						uniqueChartFilename(recovery.model.metadata.difficultyName);
					this.activateProjectChart(recovery.model, filename, { saved: false });
					this.projectDirty = true;
					if (this.files.supportsLocalPaths) {
						await this.syncMediaFromModel();
					}
					this.refresh();
					return true;
				}
			} catch (error) {
				console.warn("Autosave project restore fell back to a standalone chart", error);
			}
		}
		await this.clearRuntimeMedia();
		this.files.restoreLocalSourceContext(source);
		this.installProject(
			[
				{
					id: "difficulty-0",
					file: source.chartFilename || uniqueChartFilename(recovery.model.metadata.difficultyName),
					model: recovery.model,
				},
			],
			{
				activeChart: "difficulty-0",
				name: source.projectName || recovery.model.metadata.title,
				saved: false,
			},
		);
		this.editingProject = false;
		if (this.files.supportsLocalPaths) {
			await this.syncMediaFromModel();
		}
		this.refresh();
		return true;
	}

	async openAutosave() {
		this.exitModes();
		const recoveries = this.autosave.listed();
		if (!recoveries.length) {
			this.toast?.show("toast.noAutosaves");
			return;
		}
		const values = await this.dialogs.form({
			titleKey: "dialog.openAutosave",
			values: { recovery: String(recoveries[0].timestamp) },
			fields: [
				{
					id: "recovery",
					type: "select",
					labelKey: "field.autosave",
					options: recoveries.map(entry => ({
						value: String(entry.timestamp),
						label: `${new Date(entry.timestamp).toLocaleString()} - ${
							entry.model.metadata.title || i18n.t("field.untitled")
						}`,
					})),
				},
			],
		});
		if (!values || !(await this.confirmUnsaved())) {
			return;
		}
		const recovery =
			recoveries.find(entry => String(entry.timestamp) === String(values.recovery)) || recoveries[0];
		await this.applyAutosaveRecovery(recovery);
	}

	async runMacroDialog() {
		this.exitModes();
		if (this.model.editor.readOnly) {
			return;
		}
		const lists = await listRunnableMacros(this);
		// v17: the scope choice is remembered until sviber exits.
		const remembered =
			this.macroScopeChoice && lists[this.macroScopeChoice]?.length ? this.macroScopeChoice : null;
		const scope = remembered || (lists.global.length || !lists.project.length ? "global" : "project");
		const first = lists[scope][0] || lists.global[0] || lists.project[0];
		const values = await this.dialogs.form({
			titleKey: "dialog.runMacro",
			values: { scope, macro: first?.id || "" },
			fields: [
				{
					id: "scope",
					type: "radio",
					labelKey: "field.macroScope",
					options: [
						{ value: "global", labelKey: "field.macroGlobal" },
						{ value: "project", labelKey: "field.macroProject" },
					],
				},
				{
					id: "macro",
					type: "select",
					labelKey: "field.macro",
					options: [...lists.global, ...lists.project].map(item => ({
						value: item.id,
						label: item.label,
					})),
				},
			],
			onChange: (next, dialogState) => {
				const select = dialogState.entries.find(item => item.field.id === "macro")?.control?.element;
				const scope = dialogState.entries.find(item => item.field.id === "scope")?.control?.element;
				if (!select || !scope?.contains?.(dialogState.event?.target)) {
					return;
				}
				select.replaceChildren(
					...(lists[next.scope] || []).map(item => {
						const option = document.createElement("option");
						option.value = item.id;
						option.textContent = item.label;
						return option;
					}),
				);
			},
		});
		if (values?.scope) {
			this.macroScopeChoice = values.scope;
		}
		if (!values?.macro) {
			return;
		}
		try {
			await runChosenMacro(this, values.macro);
		} catch (error) {
			this.toast.error("toast.macroFailed", { message: localizedErrorMessage(error) });
		}
	}

	async togglePlayback() {
		if (this.audio.playing) {
			this.audio.pause();
			return;
		}
		this._syncAudioLoop();
		this.audio.seek(this.currentSeconds());
		this.audio.setRate(this.model.editor.speed);
		await this.audio.play();
	}

	async toggleReversePlayback() {
		if (this.audio.playing && this.audio.direction < 0) {
			this.audio.pause();
			return;
		}
		this._syncAudioLoop();
		this.audio.setRate(this.model.editor.speed);
		if (!this.audio.playing) {
			this.audio.seek(this.currentSeconds());
		}
		await this.audio.playReverse();
	}

	toggleAbLoop() {
		if (this.audio.playing) {
			return false;
		}
		const current = Rational.from(this.model.editor.currentTime);
		const marks = (this.model.editor.abLoopMarks || []).map(mark => Rational.from(mark));
		if (!marks.length) {
			marks.push(current);
		} else if (marks.length === 1) {
			if (!marks[0].equals(current)) {
				marks.push(current);
			}
		} else {
			marks.length = 0;
		}
		marks.sort((left, right) => left.compare(right));
		this.model.editor.abLoopMarks = marks.map(mark => mark.toJSON());
		this._syncAudioLoop();
		this.refreshInteractionPreview?.({ rebuildIndex: false });
		return true;
	}

	seekStart() {
		const start = this.timeBounds()[0];
		const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
		if (this.audio.playing) {
			this.audio.seek(start);
			if (
				!this.model.editor.lockVisibleRange &&
				(start < this.model.editor.visibleRangeBeginning || start > this.model.editor.visibleRangeEnd)
			) {
				this.setVisibleRange(start, start + span);
			}
			return;
		}
		const beat = this.timing().secondsToSnappedBeat(start, this.model.editor.subdivision);
		this.seekBeat(beat.toJSON());
		const snappedStart = this.currentSeconds();
		if (
			!this.model.editor.lockVisibleRange &&
			(snappedStart < this.model.editor.visibleRangeBeginning ||
				snappedStart > this.model.editor.visibleRangeEnd)
		) {
			this.setVisibleRange(snappedStart, snappedStart + span, true);
		}
	}

	seekSeconds(delta) {
		const seconds = Math.max(
			this.timeBounds()[0],
			Math.min(this.timeBounds()[1], this.currentSeconds() + delta),
		);
		if (this.audio.playing) {
			this.audio.seek(seconds);
			if (!this.model.editor.lockVisibleRange) {
				const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
				if (
					seconds < this.model.editor.visibleRangeBeginning ||
					seconds > this.model.editor.visibleRangeEnd
				) {
					this.setVisibleRange(seconds - span / 2, seconds + span / 2, true);
				}
			}
			return;
		}
		this.seekBeat(this.timing().secondsToSnappedBeat(seconds, this.model.editor.subdivision).toJSON());
		if (
			!this.model.editor.lockVisibleRange &&
			(seconds < this.model.editor.visibleRangeBeginning || seconds > this.model.editor.visibleRangeEnd)
		) {
			const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
			this.setVisibleRange(seconds - span / 2, seconds + span / 2, true);
		}
	}

	setSubdivision(value) {
		const subdivision = Math.max(1, Math.floor(value));
		this.model.editor.subdivision = subdivision;
		if (!this.audio.playing) {
			this.model.editor.currentTime = this.currentBeat().snap(subdivision).toJSON();
		}
		this.refreshInteractionPreview?.({ rebuildIndex: false });
	}

	setSpeed(value) {
		const speed = Math.max(0.1, Math.min(4, Math.round(Number(value) * 10000) / 10000));
		this.model.editor.speed = speed;
		this.audio.setRate(speed);
		this._syncCheckedCommands?.();
		this.refreshInteractionPreview?.({ rebuildIndex: false });
	}
}

const withHistoryBase = composeTraits("HistoryCommandsLayer", HistoryCommandsTrait);

export const withHistoryCommands = Base =>
	withChannelCommands(withEventTools(withCommandBindings(withHistoryBase(Base))));
