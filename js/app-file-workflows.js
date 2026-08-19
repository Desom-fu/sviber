import { i18n } from "./i18n.js";
import { CommandRegistry } from "./commands.js";
import { DialogManager, MenuBar, ToastManager, Toolbar, TooltipManager } from "./ui.js";
import { ChartModel, DIFFICULTY_COLORS, EVENT_TYPES, connectSelectedTipPointChain, createEvent } from "./core/chart-model.js";
import { uniqueChartFilename } from "./core/project.js";
import { History } from "./core/history.js";
import { Rational } from "./core/rational.js";
import { TimingMap } from "./core/timing.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, isPointWithinChartBounds, multiplyTransforms, penCommandsFromNodes, resolveAttachedPosition, sampleSnappee, transformAngle } from "./core/geometry.js";
import { AudioPlayer } from "./audio/player.js";
import { collectHitSchedule, collectHoldReleaseSchedule } from "./audio/scheduler.js";
import { TimelineView } from "./render/timeline.js";
import { StageView } from "./render/stage.js";
import { AutosaveManager, FileManager } from "./platform.js";
import { HistoryPanel, InspectorPanel, SnappeesPanel } from "./panels.js";
import { MOVABLE_TYPES, DURATION_TYPES, PATTERN_TYPES, SNAPPEE_COLORS, LAST_CHARTER_KEY, LAST_OPEN_KEY, loadPreferences, storePreferences, resolvePreferenceLanguage, applyThemePreference, deepClone, formatTime, formatBeat, evaluateExpression, selected, allowsOutOfBounds, pointAllowed, attachedMoveAllowed, attachedNotesStayWithinBounds, mutateSnappeeWithinBounds, constrainPastedEvent, difficultyColor, eventTypeLabel, localizedErrorMessage, localizedImportWarning, metadataFields, applyPresetDifficultyColor } from "./app-helpers.js";

export const withFileWorkflows = Base => class extends Base {
	rememberLastOpen(kind, pathname) {
		if (!globalThis.nw || !pathname) return;
		try { localStorage.setItem(LAST_OPEN_KEY, JSON.stringify({ kind, path: String(pathname) })); } catch { /* Storage may be unavailable. */ }
	}

	async reopenLastDocument() {
		if (!globalThis.nw) return false;
		let recent;
		try { recent = JSON.parse(localStorage.getItem(LAST_OPEN_KEY) || "null"); } catch { recent = null; }
		if (!recent?.path || !["project", "chart"].includes(recent.kind)) return false;
		try {
			if (recent.kind === "project") {
				const opened = await this.openProject({ directoryPath: recent.path, skipUnsaved: true, silent: true });
				if (!opened) throw new Error("The recent project is unavailable.");
				return true;
			}
			const file = await this.files.fileFromLocalPath(recent.path);
			if (!file) throw new Error("The recent chart is unavailable.");
			const opened = await this.openFile(file, { skipUnsaved: true, silent: true });
			if (!opened) throw new Error("The recent chart is unavailable.");
			return true;
		} catch (error) {
			console.warn("Unable to reopen the recent chart or project", error);
			try { localStorage.removeItem(LAST_OPEN_KEY); } catch { /* Storage may be unavailable. */ }
			return false;
		}
	}
	async confirmUnsaved() {
		if (!this.dirty) return true;
		const result = await this.dialogs.open({
			titleKey: "dialog.unsaved",
			messageKey: "dialog.unsavedMessage",
			buttons: [
				{ id: "save", labelKey: "dialog.save", primary: true, value: "save", validate: false },
				{ id: "discard", labelKey: "dialog.dontSave", value: "discard", validate: false },
				{ id: "cancel", labelKey: "dialog.cancel", cancel: true, value: "cancel", validate: false },
			],
		});
		if (result?.value === "save") return Boolean(await (globalThis.nw ? this.saveProject() : this.saveChart()));
		return result?.value === "discard";
	}

	async confirmUnsavedChart() {
		if (this.modelSignature() === this.savedSignature) return true;
		const result = await this.dialogs.open({
			titleKey: "dialog.unsaved",
			messageKey: "dialog.unsavedChartMessage",
			buttons: [
				{ id: "save", labelKey: "dialog.save", primary: true, value: "save", validate: false },
				{ id: "discard", labelKey: "dialog.dontSave", value: "discard", validate: false },
				{ id: "cancel", labelKey: "dialog.cancel", cancel: true, value: "cancel", validate: false },
			],
		});
		if (result?.value === "save") return Boolean(await this.saveChart());
		return result?.value === "discard";
	}

	async switchDifficulty(id, options = {}) {
		if (id === this.activeDifficultyId) return true;
		const target = this.difficulties.find(entry => entry.id === id);
		if (!target) return false;
		if (!options.skipSavePrompt && !await this.confirmUnsavedChart()) {
			const select = document.getElementById("difficulty-select");
			if (select) select.value = this.activeDifficultyId;
			return false;
		}
		if (this.audio.playing) this.audio.pause();
		this.exitModes();
		this.syncActiveDifficultyState();
		this.activeDifficultyId = target.id;
		this.model = target.model;
		this.history = target.history;
		this.savedSignature = target.savedSignature;
		this.difficultyUiSignature = "";
		this.updateDirty();
		this.refresh();
		return true;
	}

	async newDifficulty() {
		this.exitModes();
		if (!await this.confirmUnsavedChart()) return null;
		const source = this.model;
		const difficultyName = this.difficulties.some(entry => entry.model.metadata.difficultyName.toLowerCase() === "master")
			? "Special" : "Master";
		const values = await this.dialogs.form({
			titleKey: "dialog.newChart",
			values: {
				...source.metadata,
				charter: this.lastCharter(),
				difficultyName,
				difficultyColor: difficultyColor(difficultyName),
				difficulty: "12",
				difficultySup: "",
				offset: 0,
				initialBpm: 120,
			},
			fields: metadataFields(),
			onChange: applyPresetDifficultyColor,
		});
		if (!values) return null;
		this.rememberCharter(values.charter);
		values.difficultyColor = difficultyColor(values.difficultyName, values.difficultyColor);
		this.projectName = values.title;
		this.projectTitle = values.title;
		this.projectArtist = values.artist;
		this.syncProjectSharedFields();
		this.syncProjectHistorySharedFields({ media: false });
		const model = ChartModel.createDefault({
			metadata: values,
			timing: {
				offset: values.offset,
				initialBpm: values.initialBpm,
				bpmChanges: [],
			},
			music: this.projectMusic,
			image: this.projectImage,
			editor: { allowOutOfBounds: this.preferences.allowOutOfBounds },
		});
		model.snappees[0].name = i18n.t("snappee.preset.playfieldGrid");
		const id = `difficulty-${this.nextDifficultyId++}`;
		const history = new History(model.snapshot(), { initialLabel: i18n.t("history.initial"), limit: 1000 });
		this.difficulties.push({
			id,
			file: uniqueChartFilename(model.metadata.difficultyName, this.difficulties.map(entry => entry.file)),
			model,
			history,
			savedSignature: null,
		});
		this.projectDirty = true;
		await this.switchDifficulty(id, { skipSavePrompt: true });
		return id;
	}

	async deleteDifficulty() {
		if (!this.files.projectPath && !this.files.projectDirectoryHandle) return false;
		const activeIndex = this.difficulties.findIndex(entry => entry.id === this.activeDifficultyId);
		if (activeIndex < 0) return false;
		const confirmed = await this.dialogs.confirm({
			titleKey: "dialog.deleteChart",
			messageKey: "dialog.deleteChartMessage",
		});
		if (!confirmed) return false;
		this.difficulties.splice(activeIndex, 1);
		this.projectDirty = true;
		const next = this.difficulties[activeIndex] || this.difficulties[activeIndex - 1];
		if (next) {
			this.activeDifficultyId = next.id;
			this.model = next.model;
			this.history = next.history;
			this.savedSignature = next.savedSignature;
		} else {
			const metadata = {
				...this.model.metadata,
				title: this.projectTitle || "New chart",
				artist: this.projectArtist || "",
				difficultyName: "Master",
				difficultyColor: difficultyColor("Master"),
				difficulty: "12",
				difficultySup: "",
				charter: this.lastCharter(),
			};
			this.model = ChartModel.createDefault({
				metadata,
				timing: { offset: 0, initialBpm: 120, bpmChanges: [] },
				music: this.projectMusic,
				image: this.projectImage,
				editor: { allowOutOfBounds: this.preferences.allowOutOfBounds },
			});
			this.model.snappees[0].name = i18n.t("snappee.preset.playfieldGrid");
			this.activeDifficultyId = `difficulty-${this.nextDifficultyId++}`;
			this.history = new History(this.model.snapshot(), { initialLabel: i18n.t("history.initial"), limit: 1000 });
			this.difficulties.push({
				id: this.activeDifficultyId,
				file: uniqueChartFilename(this.model.metadata.difficultyName, this.difficulties.map(entry => entry.file)),
				model: this.model,
				history: this.history,
				savedSignature: null,
			});
			this.savedSignature = null;
		}
		this.difficultyUiSignature = "";
		this.syncProjectSharedFields();
		this.updateDirty();
		this.refresh();
		return true;
	}

	lastCharter() {
		try { return localStorage.getItem(LAST_CHARTER_KEY) || ""; } catch { return ""; }
	}

	rememberCharter(value) {
		try { localStorage.setItem(LAST_CHARTER_KEY, String(value || "")); } catch { /* Storage may be unavailable. */ }
	}

	async newChart() {
		if (globalThis.nw) return this.newDifficulty();
		return this.newProject({ chartOnly: true });
	}

	async newProject(options = {}) {
		this.exitModes();
		if (!await this.confirmUnsaved()) return;
		const defaults = ChartModel.createDefault();
		const values = await this.dialogs.form({
			titleKey: options.chartOnly ? "dialog.newChart" : "dialog.newProject",
			values: {
				...defaults.metadata,
				title: "New chart", artist: "", charter: this.lastCharter(),
				difficultyName: "Master", difficultyColor: DIFFICULTY_COLORS.master,
				difficulty: "12", difficultySup: "", offset: 0, initialBpm: 120,
			},
			fields: metadataFields(),
			onChange: applyPresetDifficultyColor,
		});
		if (!values) return;
		this.rememberCharter(values.charter);
		values.difficultyColor = difficultyColor(values.difficultyName, values.difficultyColor);
		const model = ChartModel.createDefault({
			metadata: values,
			timing: { offset: values.offset, initialBpm: values.initialBpm, bpmChanges: [] },
			editor: { allowOutOfBounds: this.preferences.allowOutOfBounds },
		});
		model.snappees[0].name = i18n.t("snappee.preset.playfieldGrid");
		this.installProject([{ model, id: "difficulty-0", file: uniqueChartFilename(model.metadata.difficultyName) }], {
			activeChart: "difficulty-0",
			name: model.metadata.title,
			saved: false,
		});
		this.files.clearProjectTarget();
		await this.clearRuntimeMedia();
		this.updateDirty();
		this.refresh();
	}

	async showChartProperties(newChart = false) {
		const values = await this.dialogs.form({
			titleKey: newChart ? "dialog.newChart" : "dialog.chartProperties",
			values: {
				...this.model.metadata,
				offset: this.model.timing.offset,
				initialBpm: this.model.timing.initialBpm,
			},
			fields: metadataFields(),
			onChange: applyPresetDifficultyColor,
		});
		if (!values) return null;
		this.rememberCharter(values.charter);
		this.commit(i18n.t("dialog.chartProperties"), model => {
			model.metadata = {
				title: values.title,
				artist: values.artist,
				charter: values.charter,
				difficultyName: values.difficultyName,
				difficultyColor: difficultyColor(values.difficultyName, values.difficultyColor),
				difficulty: String(values.difficulty),
				difficultySup: values.difficultySup,
			};
			model.timing.setOffset(values.offset);
			model.timing.setInitialBpm(values.initialBpm);
		});
		this.projectName = values.title;
		this.projectTitle = values.title;
		this.projectArtist = values.artist;
		this.syncProjectSharedFields();
		this.syncProjectHistorySharedFields({ excludeDifficultyId: this.activeDifficultyId, media: false });
		this.updateDirty();
		this.refresh();
		return values;
	}

	async showPreferences() {
		const values = await this.dialogs.form({
			titleKey: "dialog.preferences",
			values: this.preferences,
			fields: [
				{ id: "theme", type: "select", labelKey: "field.theme", options: [
					{ value: "system", labelKey: "option.theme.system" },
					{ value: "light", labelKey: "option.theme.light" },
					{ value: "dark", labelKey: "option.theme.dark" },
				] },
				{ id: "language", type: "select", labelKey: "field.language", options: [
					{ value: "system", labelKey: "option.language.system" },
					{ value: "en-US", labelKey: "option.language.english" },
					{ value: "zh-CN", labelKey: "option.language.chinese" },
				] },
				{ id: "noteSpeed", type: "number", labelKey: "field.noteSpeed", positive: true, min: 0.01, step: "any" },
				{ id: "seVolume", type: "number", labelKey: "field.seVolume", min: 0, max: 1, step: 0.05 },
				{ id: "musicVolume", type: "number", labelKey: "field.musicVolume", min: 0, max: 1, step: 0.05 },
				{ id: "allowOutOfBounds", type: "checkbox", labelKey: "field.allowOutOfBounds" },
				{ id: "autoSaveInterval", type: "number", labelKey: "field.autoSaveInterval", min: 0, step: 1 },
			],
		});
		if (!values) return null;
		this.preferences = storePreferences(values);
		applyThemePreference(this.preferences.theme);
		i18n.setLanguage(resolvePreferenceLanguage(this.preferences.language));
		this.audio.setSeVolume(this.preferences.seVolume);
		this.audio.setMusicVolume(this.preferences.musicVolume);
		this.startAutosave();
		for (const entry of this.difficulties) {
			entry.model.editor.allowOutOfBounds = this.preferences.allowOutOfBounds;
			entry.history.transformStates(state => {
				state.editor.allowOutOfBounds = this.preferences.allowOutOfBounds;
				return state;
			});
		}
		this.model.editor.allowOutOfBounds = this.preferences.allowOutOfBounds;
		this.refresh();
		return this.preferences;
	}

	startAutosave() {
		this.autosave.setInterval(this.preferences.autoSaveInterval * 1000);
		this.autosave.start(() => {
			if (this.modelSignature() === this.savedSignature) return;
			try {
				const timestamp = this.autosave.save(this.model);
				this.history.markCurrent("autosave", timestamp);
				this.historyPanel.render(this.history);
				this.toast.show("toast.autosaved", {}, { duration: 1400 });
			} catch (error) {
				console.warn("Auto-save failed", error);
			}
		});
	}

	async requestImportOptions(document) {
		if (document?.sviber) return {};
		const values = await this.dialogs.form({
			titleKey: "dialog.importTiming",
			values: { offset: 0, initialBpm: 120, largestDenominator: 192, bpmChanges: [] },
			fields: [
				{ id: "offset", type: "number", labelKey: "field.offset", step: "any" },
				{ id: "initialBpm", type: "number", labelKey: "field.initialBpm", positive: true, min: 0.001, step: "any" },
				{ id: "largestDenominator", type: "integer", labelKey: "field.largestDenominator", positive: true, min: 1 },
				{
					id: "bpmChanges", type: "array", labelKey: "field.bpmChanges", stacked: true,
					newItem: { time: [0, 0, 1], bpm: 120 },
					fields: [
						{ id: "time", type: "rational", labelKey: "field.beat" },
						{ id: "bpm", type: "number", labelKey: "field.bpm", positive: true, min: 0.001, step: "any" },
					],
				},
			],
		});
		if (!values) return null;
		return {
			offset: values.offset,
			initialBpm: values.initialBpm,
			bpmChanges: values.bpmChanges.map(change => ({ time: Rational.from(change.time).toJSON(), bpm: Number(change.bpm) })),
			largestDenominator: values.largestDenominator,
		};
	}

	async clearRuntimeMedia() {
		await this.audio.unload();
		this.files.clearCurrentAssets();
		if (this.backgroundUrl) URL.revokeObjectURL(this.backgroundUrl);
		this.backgroundUrl = null;
		this.stage.setBackground(null);
	}

	async decodeBackground(file) {
		if (this.backgroundUrl) URL.revokeObjectURL(this.backgroundUrl);
		this.backgroundUrl = URL.createObjectURL(file);
		const image = new Image();
		await new Promise((resolve, reject) => {
			image.onload = resolve;
			image.onerror = () => reject(new Error("Unable to decode the selected image."));
			image.src = this.backgroundUrl;
		});
		this.stage.setBackground(image);
		return image;
	}

	async syncMediaFromModel() {
		this.syncProjectSharedFields();
		const musicReference = this.projectMusic;
		if (musicReference !== this.files.musicReference) {
			await this.audio.unload();
			this.files.musicFile = null;
			this.files.musicReference = "";
			if (musicReference) {
				try {
					const file = await this.files.fileForAsset(musicReference, "music");
					if (file) {
						await this.audio.load(file);
						this.files.rememberAsset(musicReference, file, "music");
					}
				} catch (error) {
					console.warn("Unable to restore music", error);
					this.toast.error("toast.musicRestoreFailed", { message: localizedErrorMessage(error) });
				}
			}
		}

		const imageReference = this.projectImage;
		if (imageReference !== this.files.imageReference) {
			if (this.backgroundUrl) URL.revokeObjectURL(this.backgroundUrl);
			this.backgroundUrl = null;
			this.stage.setBackground(null);
			this.files.imageFile = null;
			this.files.imageReference = "";
			if (imageReference) {
				try {
					const file = await this.files.fileForAsset(imageReference, "image");
					if (file) {
						await this.decodeBackground(file);
						this.files.rememberAsset(imageReference, file, "image");
					}
				} catch (error) {
					console.warn("Unable to restore background", error);
					this.toast.error("toast.backgroundRestoreFailed", { message: localizedErrorMessage(error) });
				}
			}
		}
		this.refresh();
	}

	queueMediaSync() {
		this.mediaSync = this.mediaSync.catch(() => {}).then(() => this.syncMediaFromModel());
		return this.mediaSync;
	}

	async openProject(options = {}) {
		this.exitModes();
		if (!options.skipUnsaved && !await this.confirmUnsaved()) return null;
		try {
			const parsed = await this.files.openProject(options);
			if (!parsed) return null;
			const charts = parsed.charts.map(entry => ({
				...entry,
				model: ChartModel.import(entry.document),
			}));
			await this.clearRuntimeMedia();
			this.installProject(charts, {
				activeChart: parsed.manifest.activeChart,
				name: parsed.manifest.name,
				music: parsed.manifest.music,
				image: parsed.manifest.image,
				saved: true,
			});
			if (parsed.musicFile) await this.loadMusic(parsed.musicFile, false, { reference: parsed.manifest.music });
			if (parsed.imageFile) await this.loadBackground(parsed.imageFile, false, { reference: parsed.manifest.image });
			this.markProjectSaved();
			this.rememberLastOpen("project", this.files.projectPath);
			if (!options.silent) this.toast.show("toast.projectOpened");
			const warnings = this.difficulties.flatMap(entry => entry.model.importWarnings || []);
			if (warnings.length) this.toast.show(warnings.map(localizedImportWarning).join("\n"), {}, { raw: true, duration: 6500 });
			this.refresh();
			return parsed;
		} catch (error) {
			console.error(error);
			if (!options.silent) this.toast.error("toast.projectOpenFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async openFile(file, options = {}) {
		if (!file || !options.skipUnsaved && !await this.confirmUnsaved()) return;
		try {
			const parsed = await this.files.parseFile(file);
			if (!parsed) return;
			const importOptions = await this.requestImportOptions(parsed.document);
			if (importOptions == null) return;
			const model = ChartModel.import(parsed.document, importOptions);
			this.installProject([{
				id: "difficulty-0",
				file: uniqueChartFilename(model.metadata.difficultyName),
				model,
			}], { activeChart: "difficulty-0", name: model.metadata.title, saved: true });
			this.files.clearProjectTarget();
			this.files.adoptChartSource(parsed);
			await this.clearRuntimeMedia();
			if (parsed.fromLevel) {
				this.projectMusic = "";
				this.projectImage = "";
				this.syncProjectSharedFields();
				this.syncProjectHistorySharedFields({ metadata: false });
				if (parsed.musicFile) await this.loadMusic(parsed.musicFile, false);
				if (parsed.imageFile) await this.loadBackground(parsed.imageFile, false);
			} else if (this.files.supportsLocalPaths) {
				await this.syncMediaFromModel();
			}
			this.markProjectSaved();
			this.rememberLastOpen("chart", this.files.chartPath);
			if (!options.silent) this.toast.show("toast.opened");
			if (this.model.importWarnings.length) {
				this.toast.show(this.model.importWarnings.map(localizedImportWarning).join("\n"), {}, { raw: true, duration: 6500 });
			}
			this.refresh();
			return parsed;
		} catch (error) {
			console.error(error);
			if (!options.silent) this.toast.error("toast.openFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async loadMusic(file, record = true, options = {}) {
		if (!file) return;
		try {
			await this.audio.load(file);
			const copiedReference = record && globalThis.nw
				? await this.files.copyAssetIntoProject(file, "music") : "";
			const reference = String(options.reference || copiedReference || this.files.assetReference(file));
			this.files.rememberAsset(reference, file, "music");
			this.projectMusic = reference;
			this.syncProjectSharedFields();
			this.syncProjectHistorySharedFields({ metadata: false });
			if (record) {
				this.model.editor.visibleRangeBeginning = Math.min(0, this.model.timing.offset);
				this.model.editor.visibleRangeEnd = Math.min(this.audio.duration, this.model.editor.visibleRangeBeginning + 10);
			}
			if (record) {
				this.projectDirty = true;
				this.updateDirty();
			}
			this.toast.show("toast.musicLoaded");
			this.refresh();
		} catch (error) {
			console.error(error);
			this.toast.error("toast.musicLoadFailed", { message: localizedErrorMessage(error) });
		}
	}

	async loadBackground(file, record = true, options = {}) {
		if (!file) return;
		try {
			await this.decodeBackground(file);
			const copiedReference = record && globalThis.nw
				? await this.files.copyAssetIntoProject(file, "cover") : "";
			const reference = String(options.reference || copiedReference || this.files.assetReference(file));
			this.files.rememberAsset(reference, file, "image");
			this.projectImage = reference;
			this.syncProjectSharedFields();
			this.syncProjectHistorySharedFields({ metadata: false });
			if (record) {
				this.projectDirty = true;
				this.updateDirty();
			}
			this.toast.show("toast.backgroundLoaded");
			this.refresh();
		} catch (error) {
			console.error(error);
			this.toast.error("toast.backgroundLoadFailed", { message: localizedErrorMessage(error) });
		}
	}

	async saveChart() {
		try {
			if (this.freeTransform) this.finishFreeTransform();
			const location = await this.files.saveChart(this.model, {
				projectFilename: this.activeDifficultyState()?.file,
			});
			if (!location) return null;
			this.markSaved();
			this.history.markCurrent("save");
			this.autosave.markManualSave();
			this.toast.show("toast.saved");
			this.refresh();
			return location;
		} catch (error) {
			this.toast.error("toast.saveFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async saveProject() {
		try {
			if (this.freeTransform) this.finishFreeTransform();
			const result = await this.files.saveProject(this.projectSnapshot());
			if (!result) return null;
			this.projectName = result.manifest.name;
			this.projectMusic = result.manifest.music;
			this.projectImage = result.manifest.image;
			this.syncProjectSharedFields();
			this.syncProjectHistorySharedFields({ metadata: false });
			this.markProjectSaved();
			for (const entry of this.difficulties) entry.history.markCurrent("save");
			this.autosave.markManualSave();
			this.toast.show("toast.projectSaved");
			this.refresh();
			return result.location;
		} catch (error) {
			this.toast.error("toast.projectSaveFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async saveChartAs() {
		try {
			if (this.freeTransform) this.finishFreeTransform();
			const location = await this.files.saveChart(this.model, { saveAs: true });
			if (!location) return null;
			this.savedSignature = this.modelSignature();
			this.syncActiveDifficultyState();
			this.history.markCurrent("save");
			this.autosave.markManualSave();
			this.updateDirty();
			this.toast.show("toast.saved");
			this.refresh();
			return location;
		} catch (error) {
			this.toast.error("toast.saveFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async saveLevel() {
		try {
			if (this.freeTransform) this.finishFreeTransform();
			const project = this.projectSnapshot();
			if (!globalThis.nw) project.charts = project.charts.filter(entry => entry.id === this.activeDifficultyId);
			const filename = await this.files.saveLevel(project);
			if (filename) this.toast.show("toast.levelExported");
			return filename;
		} catch (error) {
			this.toast.error("toast.levelExportFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async importClipboard() {
		try {
			const text = await navigator.clipboard.readText();
			const document = JSON.parse(text);
			if (!await this.confirmUnsaved()) return;
			const options = await this.requestImportOptions(document);
			if (options == null) return;
			const model = ChartModel.import(document, options);
			this.installProject([{
				id: "difficulty-0",
				file: uniqueChartFilename(model.metadata.difficultyName),
				model,
			}], { activeChart: "difficulty-0", name: model.metadata.title, saved: false });
			this.files.clearProjectTarget();
			await this.clearRuntimeMedia();
			if (this.files.supportsLocalPaths) await this.syncMediaFromModel();
			this.updateDirty();
			this.toast.show("toast.pasted");
			this.refresh();
		} catch (error) {
			this.toast.error("toast.clipboardFailed", { message: localizedErrorMessage(error) });
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
		const chosen = selected(this.model);
		if (!chosen.length) return;
		const minimumBeat = chosen.map(event => Rational.from(event.time)).reduce((left, right) => left.compare(right) <= 0 ? left : right);
		const channelIndices = chosen.map(event => this.model.channels.findIndex(channel => channel.id === event.channel));
		const minimumChannel = Math.min(...channelIndices);
		const snappeeIds = new Set(chosen.flatMap(event => [event.snappee, event.tipPointSpawnSnappee]).filter(value => value != null));
		const events = chosen.map(event => {
			const copy = deepClone(event);
			copy.time = Rational.from(event.time).sub(minimumBeat).toJSON();
			copy.channel = this.model.channels.findIndex(channel => channel.id === event.channel) - minimumChannel;
			return copy;
		});
		this.internalClipboard = {
			version: 1,
			events,
			snappees: this.model.snappees.filter(snappee => snappeeIds.has(snappee.id)).map(deepClone),
		};
		try { await navigator.clipboard.writeText(JSON.stringify(events)); } catch { /* Internal clipboard remains available. */ }
	}

	async cutEvents() {
		await this.copyEvents();
		this.deleteSelected();
	}

	async pasteEvents(duplicateSnappees) {
		const internalData = this.internalClipboard;
		let data = internalData;
		try {
			const parsed = JSON.parse(await navigator.clipboard.readText());
			if (Array.isArray(parsed)) {
				const matchesInternal = internalData?.version === 1 && Array.isArray(internalData.events)
					&& JSON.stringify(parsed) === JSON.stringify(internalData.events);
				data = matchesInternal ? internalData : { version: 1, events: parsed, snappees: [] };
			}
			else if (parsed?.version === 1 && Array.isArray(parsed.events)) data = parsed;
		} catch { /* Use internal clipboard. */ }
		if (!data?.events?.length) return;
		this.commit(i18n.t("toast.pasted"), model => {
			const snappeeMap = new Map();
			if (duplicateSnappees) {
				const names = new Set(model.snappees.map(snappee => snappee.name));
				const referencedSnappees = new Set(data.events
					.flatMap(event => [event.snappee, event.tipPointSpawnSnappee])
					.filter(value => value != null));
				const sourceSnappees = data.snappees?.length
					? data.snappees
					: model.snappees.filter(snappee => referencedSnappees.has(snappee.id));
				const duplicateName = base => {
					let suffix = 2;
					let name = `${base} ${suffix}`;
					while (names.has(name)) name = `${base} ${++suffix}`;
					names.add(name);
					return name;
				};
				for (const snappee of sourceSnappees) {
					const copy = model.addSnappee({ ...deepClone(snappee), id: null, selected: false, name: duplicateName(snappee.name) });
					snappeeMap.set(snappee.id, copy.id);
				}
			}
			for (const event of model.events) event.selected = false;
			const currentChannel = model.channels.findIndex(channel => channel.id === model.editor.currentChannel);
			const channelOffset = event => Math.max(0, Math.round(Number(event.channelOffset ?? event.channel) || 0));
			const maximumOffset = Math.max(...data.events.map(channelOffset));
			while (currentChannel + maximumOffset >= model.channels.length) model.addChannel(model.channels.length);
			model.editor.currentChannel = model.channels[currentChannel].id;
			for (const source of data.events) {
				const copy = deepClone(source);
				copy.id = null;
				copy.time = this.currentBeat().add(copy.time ?? copy.beat ?? 0).toJSON();
				copy.channel = model.channels[currentChannel + channelOffset(copy)].id;
				copy.selected = true;
				delete copy.beat;
				delete copy.channelOffset;
				if (duplicateSnappees && snappeeMap.has(copy.snappee)) copy.snappee = snappeeMap.get(copy.snappee);
				if (duplicateSnappees && snappeeMap.has(copy.tipPointSpawnSnappee)) copy.tipPointSpawnSnappee = snappeeMap.get(copy.tipPointSpawnSnappee);
				const pasted = model.addEvent(copy);
				constrainPastedEvent(model, pasted);
			}
		});
	}

};
