// Document lifecycle: recent-file memory, unsaved prompts, creating and closing
// charts and projects, and the chart-properties form.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { ChartModel, DIFFICULTY_COLORS } from "../core/chart-model.js";
import { History } from "../core/history.js";
import { uniqueChartFilename } from "../core/project.js";
import {
	LAST_CHARTER_KEY,
	LAST_OPEN_KEY,
	RECENT_OPEN_KEY,
	metadataFields,
	applyPresetDifficultyColor,
	difficultyColor,
} from "./app-helpers.js";

class DocumentLifecycleTrait {
	rememberLastOpen(kind, pathname) {
		if (!globalThis.nw || !pathname) {
			return;
		}
		const entry = {
			kind,
			path: String(pathname),
			title: String(this.model?.metadata?.title || ""),
			at: Date.now(),
		};
		const list = this.recentOpens().filter(item => item.path !== entry.path);
		list.unshift(entry);
		try {
			localStorage.setItem(RECENT_OPEN_KEY, JSON.stringify(list.slice(0, 20)));
		} catch {
			/* Storage may be unavailable. */
		}
		try {
			localStorage.setItem(LAST_OPEN_KEY, JSON.stringify({ kind: entry.kind, path: entry.path }));
		} catch {
			/* Storage may be unavailable. */
		}
	}

	async reopenLastDocument() {
		if (!globalThis.nw) {
			return false;
		}
		let recent;
		try {
			recent = JSON.parse(localStorage.getItem(LAST_OPEN_KEY) || "null");
		} catch {
			recent = null;
		}
		if (!recent?.path || !["project", "chart"].includes(recent.kind)) {
			return false;
		}
		try {
			if (recent.kind === "project") {
				const opened = await this.openProject({
					directoryPath: recent.path,
					skipUnsaved: true,
					silent: true,
				});
				if (!opened) {
					throw new Error("The recent project is unavailable.");
				}
				return true;
			}
			const file = await this.files.fileFromLocalPath(recent.path);
			if (!file) {
				throw new Error("The recent chart is unavailable.");
			}
			const opened = await this.openFile(file, { skipUnsaved: true, silent: true });
			if (!opened) {
				throw new Error("The recent chart is unavailable.");
			}
			return true;
		} catch (error) {
			console.warn("Unable to reopen the recent chart or project", error);
			try {
				localStorage.removeItem(LAST_OPEN_KEY);
			} catch {
				/* Storage may be unavailable. */
			}
			return false;
		}
	}

	async confirmUnsaved() {
		if (!this.dirty) {
			return true;
		}
		const result = await this.dialogs.open({
			titleKey: "dialog.unsaved",
			messageKey: "dialog.unsavedMessage",
			buttons: [
				{ id: "save", labelKey: "dialog.save", primary: true, value: "save", validate: false },
				{ id: "discard", labelKey: "dialog.dontSave", value: "discard", validate: false },
				{ id: "cancel", labelKey: "dialog.cancel", cancel: true, value: "cancel", validate: false },
			],
		});
		if (result?.value === "save") {
			return Boolean(await (this.editingProject ? this.saveProject() : this.saveChart()));
		}
		return result?.value === "discard";
	}

	async confirmUnsavedChart() {
		if (!this.dirty) {
			return true;
		}
		const result = await this.dialogs.open({
			titleKey: "dialog.unsaved",
			messageKey: "dialog.unsavedChartMessage",
			buttons: [
				{ id: "save", labelKey: "dialog.save", primary: true, value: "save", validate: false },
				{ id: "discard", labelKey: "dialog.dontSave", value: "discard", validate: false },
				{ id: "cancel", labelKey: "dialog.cancel", cancel: true, value: "cancel", validate: false },
			],
		});
		if (result?.value === "save") {
			return Boolean(await this.saveChart());
		}
		return result?.value === "discard";
	}

	async switchDifficulty(id, options = {}) {
		if (id === this.activeDifficultyId) {
			return true;
		}
		const target = this.difficulties.find(entry => entry.id === id);
		if (!target) {
			return false;
		}
		if (!options.skipSavePrompt && !(await this.confirmUnsavedChart())) {
			const select = document.getElementById("difficulty-select");
			if (select) {
				select.value = this.activeDifficultyId;
			}
			return false;
		}
		if (this.audio.playing) {
			this.audio.pause();
		}
		this.exitModes();
		this.syncActiveDifficultyState();
		this.activeDifficultyId = target.id;
		this.model = target.model;
		this.history = target.history;
		this.savedSignature = target.savedSignature;
		this.projectMusic = String(this.model.music || "");
		this.projectImage = String(this.model.image || "");
		this.difficultyUiSignature = "";
		this.updateDirty();
		this.refresh();
		await this.queueMediaSync();
		return true;
	}

	async newDifficulty() {
		this.exitModes();
		if (!(await this.confirmUnsavedChart())) {
			return null;
		}
		const source = this.model;
		const difficultyName = this.difficulties.some(
			entry => entry.model.metadata.difficultyName.toLowerCase() === "master",
		)? "Special": "Master";
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
		if (!values) {
			return null;
		}
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
		});
		model.snappees[0].name = i18n.t("snappee.preset.playfieldGrid");
		const id = `difficulty-${this.nextDifficultyId++}`;
		const history = new History(model.snapshot(), { initialLabel: i18n.t("history.initial"), limit: 1000 });
		this.difficulties.push({
			id,
			file: uniqueChartFilename(
				model.metadata.difficultyName,
				this.difficulties.map(entry => entry.file),
			),
			model,
			history,
			savedSignature: null,
		});
		this.projectDirty = true;
		await this.switchDifficulty(id, { skipSavePrompt: true });
		return id;
	}

	async deleteDifficulty() {
		if (!this.editingProject || this.difficulties.length <= 1) {
			return false;
		}
		const activeIndex = this.difficulties.findIndex(entry => entry.id === this.activeDifficultyId);
		if (activeIndex < 0) {
			return false;
		}
		const values = await this.dialogs.form({
			titleKey: "dialog.deleteChart",
			values: { deleteFile: true },
			fields: [{ id: "deleteFile", type: "checkbox", labelKey: "field.deleteChartFile" }],
		});
		if (!values) {
			return false;
		}
		const [deleted] = this.difficulties.splice(activeIndex, 1);
		if (values.deleteFile) {
			await this.files.deleteProjectChart(deleted.file);
		}
		this.projectDirty = true;
		const next = this.difficulties[activeIndex] || this.difficulties[activeIndex - 1];
		this.activeDifficultyId = next.id;
		this.model = next.model;
		this.history = next.history;
		this.savedSignature = next.savedSignature;
		this.projectMusic = String(this.model.music || "");
		this.projectImage = String(this.model.image || "");
		this.difficultyUiSignature = "";
		this.syncProjectSharedFields();
		this.updateDirty();
		this.refresh();
		await this.queueMediaSync();
		return true;
	}

	async closeDocument() {
		this.exitModes();
		if (!(await this.confirmUnsaved())) {
			return false;
		}
		await this.clearRuntimeMedia();
		this.files.clearProjectTarget();
		this.editingProject = false;
		const model = ChartModel.createDefault();
		model.snappees[0].name = i18n.t("snappee.preset.playfieldGrid");
		this.installProject(
			[{ id: "difficulty-0", file: uniqueChartFilename(model.metadata.difficultyName), model }],
			{
				activeChart: "difficulty-0",
				name: model.metadata.title,
				saved: true,
			},
		);
		this.markProjectSaved();
		this.refresh();
		return true;
	}

	lastCharter() {
		try {
			return localStorage.getItem(LAST_CHARTER_KEY) || "";
		} catch {
			return "";
		}
	}

	rememberCharter(value) {
		try {
			localStorage.setItem(LAST_CHARTER_KEY, String(value || ""));
		} catch {
			/* Storage may be unavailable. */
		}
	}

	async newChart() {
		if (this.editingProject) {
			return this.newDifficulty();
		}
		return this.newProject({ chartOnly: true });
	}

	async newProject(options = {}) {
		if (!options.chartOnly && !globalThis.nw) {
			return;
		}
		this.exitModes();
		if (!(await this.confirmUnsaved())) {
			return;
		}
		const defaults = ChartModel.createDefault();
		const values = await this.dialogs.form({
			titleKey: options.chartOnly ? "dialog.newChart" : "dialog.newProject",
			values: {
				...defaults.metadata,
				title: "New chart",
				artist: "",
				charter: this.lastCharter(),
				difficultyName: "Master",
				difficultyColor: DIFFICULTY_COLORS.master,
				difficulty: "12",
				difficultySup: "",
				offset: 0,
				initialBpm: 120,
			},
			fields: metadataFields(),
			onChange: applyPresetDifficultyColor,
		});
		if (!values) {
			return;
		}
		this.rememberCharter(values.charter);
		values.difficultyColor = difficultyColor(values.difficultyName, values.difficultyColor);
		const model = ChartModel.createDefault({
			metadata: values,
			timing: { offset: values.offset, initialBpm: values.initialBpm, bpmChanges: [] },
		});
		model.snappees[0].name = i18n.t("snappee.preset.playfieldGrid");
		this.installProject(
			[{ model, id: "difficulty-0", file: uniqueChartFilename(model.metadata.difficultyName) }],
			{
				activeChart: "difficulty-0",
				name: model.metadata.title,
				saved: false,
			},
		);
		this.editingProject = !options.chartOnly;
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
		if (!values) {
			return null;
		}
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
		return values;
	}
}

export const withDocumentLifecycle = composeTraits("DocumentLifecycleLayer", DocumentLifecycleTrait);
