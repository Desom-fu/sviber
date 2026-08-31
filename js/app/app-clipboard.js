import { i18n } from "../ui/i18n.js";
import { ChartModel } from "../core/chart-model.js";
import { uniqueChartFilename } from "../core/project.js";
import { TimingMap } from "../core/timing.js";
import { SNAPPEE_TYPE_SET } from "../core/chart-vocabulary.js";
import { deepClone, localizedErrorMessage, selected } from "./app-helpers.js";
import { applyClipboardPaste, buildClipboardPayload, resolveClipboardPayload } from "../cli/clipboard-payload.js";
import { composeTraits } from "../core/mixin.js";

// Selected roots of the current selection: events whose ancestors are all unselected, so
// that copying a group does not also copy its children as separate top level entries.
function selectedRoots(model) {
	return selected(model).filter(event => !model.ancestorsOf(event.id).some(ancestor => ancestor.selected));
}

// Clipboard interchange (system clipboard and the internal clipboard). Split out of
// app-file-workflows.js: those workflows are about files on disk, these are about
// transient chart fragments. The payload format itself lives in clipboard-payload.js.
class ClipboardTrait {
	async importClipboard() {
		try {
			const document = JSON.parse(await navigator.clipboard.readText());
			const addToProject = Boolean(this.editingProject && (await this.confirmAddToProject()));
			if (!(await (addToProject ? this.confirmUnsavedChart() : this.confirmUnsaved()))) {
				return;
			}
			const options = await this.requestImportOptions(document);
			if (options == null) {
				return;
			}
			const model = ChartModel.import(document, options);
			if (addToProject) {
				await this.addImportedChartToProject(model);
			} else {
				await this.replaceProjectWithImportedChart(model);
			}
			this.updateDirty();
			this.toast.show("toast.pasted");
			this.refresh();
		} catch (error) {
			this.toast.error("toast.clipboardFailed", { message: localizedErrorMessage(error) });
		}
	}

	async addImportedChartToProject(model) {
		const taken = this.difficulties.map(entry => entry.file);
		const file = uniqueChartFilename(model.metadata.difficultyName, taken);
		this.activateProjectChart(model, file, { saved: false });
		this.projectDirty = true;
		await this.syncMediaFromModel();
	}

	async replaceProjectWithImportedChart(model) {
		const file = uniqueChartFilename(model.metadata.difficultyName);
		const difficulties = [{ id: "difficulty-0", file, model }];
		const state = { activeChart: "difficulty-0", name: model.metadata.title, saved: false };
		this.installProject(difficulties, state);
		this.editingProject = false;
		this.files.clearProjectTarget();
		await this.clearRuntimeMedia();
		if (this.files.supportsLocalPaths) {
			await this.syncMediaFromModel();
		}
	}

	async exportClipboard() {
		try {
			await this.files.exportClipboard(this.model);
			this.toast.show("toast.copied");
		} catch (error) {
			this.toast.error("toast.clipboardFailed", { message: localizedErrorMessage(error) });
		}
	}

	async copyEvents() {
		const chosen = selectedRoots(this.model);
		if (!chosen.length) {
			return;
		}
		this.internalClipboard = buildClipboardPayload(this.model, chosen);
		try {
			await navigator.clipboard.writeText(JSON.stringify(this.internalClipboard));
		} catch {
			/* Internal clipboard remains available. */
		}
	}

	async cutEvents() {
		await this.copyEvents();
		this.deleteSelected();
	}

	async pasteEvents(duplicateSnappees = false, options = {}) {
		const data = await resolveClipboardPayload(this.internalClipboard);
		if (!data?.events?.length) {
			return;
		}
		const paste = {
			duplicateSnappees: Boolean(duplicateSnappees || options.duplicateSnappees),
			duplicateChannels: Boolean(options.duplicateChannels),
		};
		this.commit(i18n.t("toast.pasted"), model => applyClipboardPaste(this, model, data, paste));
	}

	async showPasteOptions() {
		const values = await this.dialogs.form({
			titleKey: "dialog.pasteOptions",
			values: { duplicateChannels: false, duplicateSnappees: false },
			fields: [
				{ id: "duplicateChannels", type: "checkbox", labelKey: "field.duplicateChannels" },
				{ id: "duplicateSnappees", type: "checkbox", labelKey: "field.duplicateSnappees" },
			],
		});
		if (values) {
			await this.pasteEvents(false, values);
		}
	}

	async copyTiming() {
		try {
			await navigator.clipboard.writeText(JSON.stringify(this.model.timing.toJSON()));
		} catch (error) {
			this.toast.error("toast.clipboardFailed", { message: localizedErrorMessage(error) });
		}
	}

	async copySnappee() {
		const snappee = this.model.snappees.find(item => item.selected);
		if (!snappee) {
			return;
		}
		try {
			await navigator.clipboard.writeText(JSON.stringify(snappee));
			this.toast.show("toast.snappeeCopied");
		} catch (error) {
			this.toast.error("toast.clipboardFailed", { message: localizedErrorMessage(error) });
		}
	}

	async pasteSnappee() {
		try {
			const data = JSON.parse(await navigator.clipboard.readText());
			if (!data || typeof data !== "object" || !SNAPPEE_TYPE_SET.has(data.type)) {
				throw new TypeError("Clipboard does not contain snappee JSON data");
			}
			this.commit(i18n.t("history.createSnappee"), model => {
				const created = model.addSnappee({
					...data,
					id: null,
					selected: false,
					name: this.uniqueSnappeeName(String(data.name ?? data.type)),
				});
				for (const snappee of model.snappees) {
					snappee.selected = snappee.id === created.id;
				}
			});
			this.toast.show("toast.snappeePasted");
		} catch (error) {
			this.toast.error("toast.clipboardFailed", { message: localizedErrorMessage(error) });
		}
	}

	async pasteTiming() {
		try {
			const data = JSON.parse(await navigator.clipboard.readText());
			this.commit(i18n.t("history.editTiming"), model => {
				model.timing = new TimingMap(data);
			});
		} catch (error) {
			this.toast.error("toast.clipboardFailed", { message: localizedErrorMessage(error) });
		}
	}
}

// The Clips panel stores clipboard payloads inside the chart so that recurring patterns
// can be recalled later. A clip is pasted by temporarily swapping it in as the internal
// clipboard, which keeps a single paste implementation for both sources.
class ClipLibraryTrait {
	async saveEventsToClip() {
		if (!selectedRoots(this.model).length) {
			return;
		}
		await this.copyEvents();
		const name = i18n.t("clip.defaultName", { n: this.model.clips.length + 1 });
		this.commit(i18n.t("history.saveClip"), model =>
			model.addClip(deepClone(this.internalClipboard), name));
	}

	async pasteClip(index) {
		const clip = this.model.clips?.[index];
		if (!clip?.data) {
			return;
		}
		const previous = this.internalClipboard;
		this.internalClipboard = deepClone(clip.data);
		try {
			await this.pasteEvents(false);
		} finally {
			this.internalClipboard = previous;
		}
	}

	moveClip(index, direction) {
		this.commit(i18n.t("history.editClip"), model => {
			const target = index + direction;
			if (index < 0 || target < 0 || target >= model.clips.length) {
				return;
			}
			[model.clips[index], model.clips[target]] = [model.clips[target], model.clips[index]];
		});
	}

	setClipExpanded(index, expanded = true) {
		const clip = this.model.clips?.[index];
		if (!clip || clip.expanded === Boolean(expanded)) {
			return false;
		}
		this.commit(
			i18n.t("history.editClip"),
			model => {
				if (model.clips[index]) {
					model.clips[index].expanded = Boolean(expanded);
				}
			},
			{
				lightweight: true,
				viewOnly: true,
				scheduleDirty: false,
				skipCommands: true,
			},
		);
		return true;
	}

	async editClip(index) {
		const clip = this.model.clips?.[index];
		if (!clip) {
			return;
		}
		const values = await this.dialogs.form({
			titleKey: "dialog.editClip",
			values: { name: clip.name },
			fields: [{ id: "name", type: "text", labelKey: "field.name", required: true }],
		});
		if (!values) {
			return;
		}
		this.commit(i18n.t("history.editClip"), model => {
			if (model.clips[index]) {
				model.clips[index].name = String(values.name);
			}
		});
	}

	deleteClip(index) {
		this.commit(i18n.t("history.deleteClip"), model => {
			if (index >= 0) {
				model.clips.splice(index, 1);
			}
		});
	}
}

export const withClipboard = composeTraits("ClipboardLayer", ClipboardTrait, ClipLibraryTrait);
