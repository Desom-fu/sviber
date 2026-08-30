// Opening and saving charts, projects and levels, plus live-hosting controls.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { ChartModel } from "../core/chart-model.js";
import { History } from "../core/history.js";
import { exportLyricaChart, importLyricaChart, isLyricaChartText } from "../core/lyrica.js";
import { uniqueChartFilename } from "../core/project.js";
import { SSCHARTER_VERSION, hostedLevelUrl, parseAddress } from "../platform/live-hosting.js";
import { localizedErrorMessage, localizedImportWarning } from "./app-helpers.js";

class OpenSaveTrait {
	async openProject(options = {}) {
		if (!globalThis.nw) {
			return null;
		}
		this.exitModes();
		if (!options.skipUnsaved && !(await this.confirmUnsaved())) {
			return null;
		}
		try {
			return await this.withLoadingOverlay(async () => {
				const parsed = await this.files.openProject(options);
				if (!parsed) {
					return null;
				}
				const charts = parsed.charts.map(entry => ({
					...entry,
					model: ChartModel.import(entry.document),
				}));
				await this.clearRuntimeMedia();
				this.installProject(charts, {
					activeChart: parsed.manifest.activeChart,
					name: parsed.projectName,
					saved: true,
				});
				this.editingProject = true;
				this.projectMusic = String(this.model.music || "");
				this.projectImage = String(this.model.image || "");
				await this.syncMediaFromModel();
				this.markProjectSaved();
				this.rememberLastOpen("project", this.files.projectPath);
				if (!options.silent) {
					this.toast.show("toast.projectOpened");
				}
				const warnings = this.difficulties.flatMap(entry => entry.model.importWarnings || []);
				if (warnings.length) {
					this.toast.show(warnings.map(localizedImportWarning).join("\n"), {}, { raw: true, duration: 6500 });
				}
				this.refresh();
				return parsed;
			}, "loading.project");
		} catch (error) {
			console.error(error);
			if (!options.silent) {
				this.toast.error("toast.projectOpenFailed", { message: localizedErrorMessage(error) });
			}
			return null;
		}
	}

	activateProjectChart(model, filename, options = {}) {
		let target = this.difficulties.find(entry => entry.file.toLowerCase() === filename.toLowerCase());
		if (!target) {
			target = {
				id: `difficulty-${this.nextDifficultyId++}`,
				file: filename,
				model,
				history: null,
				savedSignature: null,
			};
			this.difficulties.push(target);
			this.projectDirty = true;
		}
		target.model = model;
		target.history = new History(model.snapshot(), { initialLabel: i18n.t("history.initial"), limit: 1000 });
		target.savedSignature = options.saved === false ? null : this.modelSignature(model);
		this.activeDifficultyId = target.id;
		this.model = model;
		this.history = target.history;
		this.savedSignature = target.savedSignature;
		this.projectMusic = String(model.music || "");
		this.projectImage = String(model.image || "");
		this.syncProjectSharedFields();
		this.difficultyUiSignature = "";
		this.updateDirty();
		this.refresh();
		return target;
	}

	async confirmAddToProject() {
		return this.dialogs.confirm({
			titleKey: "dialog.addChartToProject",
			messageKey: "dialog.addChartToProjectMessage",
		});
	}

	// Copies the music and image a chart references into the open project folder so that
	// adding a chart to a project brings its media along.
	async copyChartAssetsIntoProject(model) {
		if (!globalThis.nw || !this.files.projectPath) {
			return model;
		}
		for (const [field, fallback] of [
			["music", "music"],
			["image", "cover"],
		]) {
			const reference = String(model[field] || "");
			if (!reference) {
				continue;
			}
			try {
				const file = await this.files.fileForAsset(reference, field);
				if (!file) {
					continue;
				}
				model[field] = (await this.files.copyAssetIntoProject(file, fallback, reference)) || reference;
			} catch (error) {
				console.warn(`Unable to copy project ${field}`, error);
			}
		}
		return model;
	}

	async offeredAddToProject(options) {
		if (options.forceAddToProject) {
			return true;
		}
		if (options.forceStandalone) {
			return false;
		}
		return Boolean(options.offerAddToProject && (await this.confirmAddToProject()));
	}

	async openContainingProjectForChart(sourcePath, options) {
		const opened = await this.openProject({
			directoryPath: await this.files.containingProjectPath?.(sourcePath),
			skipUnsaved: true,
			silent: options.silent,
		});
		if (!opened) {
			return null;
		}
		const filename = this.files.projectChartFilename(sourcePath);
		const target = this.difficulties.find(entry => entry.file.toLowerCase() === filename.toLowerCase());
		if (target) {
			await this.switchDifficulty(target.id, { skipSavePrompt: true });
		}
		return opened;
	}

	async modelFromParsedFile(parsed) {
		if (parsed.lyricaText != null || parsed.document?.lyrica) {
			const lyricaOptions = await this.requestLyricaImportOptions();
			if (lyricaOptions == null) {
				return null;
			}
			const text = parsed.lyricaText ?? parsed.document.lyrica;
			if (!isLyricaChartText(text)) {
				throw new Error("The selected file is not a Lyrica chart.");
			}
			return new ChartModel(importLyricaChart(text, lyricaOptions));
		}
		const importOptions = await this.requestImportOptions(parsed.document);
		if (importOptions == null) {
			return null;
		}
		return ChartModel.import(parsed.document, importOptions);
	}

	async loadParsedMedia(parsed, record) {
		if (parsed.fromLevel) {
			if (parsed.musicFile) {
				await this.loadMusic(parsed.musicFile, record);
			}
			if (parsed.imageFile) {
				await this.loadBackground(parsed.imageFile, record);
			}
			return;
		}
		if (record || this.files.supportsLocalPaths) {
			await this.syncMediaFromModel();
		}
	}

	async installOpenedChartInProject(model, parsed, addToProject, options) {
		if (addToProject && parsed.chartPath) {
			model.music = this.files.resolveChartAssetReference(model.music, parsed.chartPath);
			model.image = this.files.resolveChartAssetReference(model.image, parsed.chartPath);
			await this.copyChartAssetsIntoProject(model);
		}
		const filename =
			this.files.projectChartFilename(parsed.chartPath) ||
			uniqueChartFilename(
				model.metadata.difficultyName,
				this.difficulties.map(entry => entry.file),
			);
		this.activateProjectChart(model, filename, { saved: !addToProject });
		if (addToProject) {
			this.projectDirty = true;
		}
		await this.loadParsedMedia(parsed, true);
		this.updateDirty();
		this.rememberLastOpen("project", this.files.projectPath);
		if (!options.silent) {
			this.toast.show("toast.opened");
		}
		return parsed;
	}

	async installOpenedChartStandalone(model, parsed, options) {
		const importedLevel = Boolean(parsed.fromLevel);
		this.installProject(
			[{ id: "difficulty-0", file: uniqueChartFilename(model.metadata.difficultyName), model }],
			{ activeChart: "difficulty-0", name: model.metadata.title, saved: !importedLevel },
		);
		this.editingProject = false;
		this.files.clearProjectTarget();
		this.files.adoptChartSource(parsed);
		await this.clearRuntimeMedia();
		await this.loadParsedMedia(parsed, false);
		if (!importedLevel) {
			this.markProjectSaved();
		}
		this.rememberLastOpen("chart", this.files.chartPath);
		if (!options.silent) {
			this.toast.show("toast.opened");
		}
		if (this.model.importWarnings.length) {
			this.toast.show(this.model.importWarnings.map(localizedImportWarning).join("\n"), {}, {
				raw: true,
				duration: 6500,
			});
		}
		this.refresh();
		return parsed;
	}

	async openFile(file, options = {}) {
		if (!file) {
			return;
		}
		try {
			const sourcePath = this.files.localPathFor?.(file) || "";
			const projectOpen = Boolean(globalThis.nw && this.editingProject);
			const addToProject = Boolean(projectOpen && (await this.offeredAddToProject(options)));
			if (!options.skipUnsaved && !(await (addToProject ? this.confirmUnsavedChart() : this.confirmUnsaved()))) {
				return;
			}
			const containing = await this.files.containingProjectPath?.(sourcePath);
			if (containing && !projectOpen && !addToProject && !options.forceStandalone) {
				return this.openContainingProjectForChart(sourcePath, options);
			}
			const parsed = await this.files.parseFile(file);
			if (!parsed) {
				return;
			}
			const model = await this.modelFromParsedFile(parsed);
			if (!model) {
				return;
			}
			// The overlay only covers the install phase: modelFromParsedFile may still open
			// the import options dialog, which sits below the loading screen.
			return await this.withLoadingOverlay(async () => {
				const projectFilename = this.files.projectChartFilename(parsed.chartPath);
				const stayInProject = addToProject || (!options.offerAddToProject && projectFilename);
				if (!options.forceStandalone && stayInProject) {
					return this.installOpenedChartInProject(model, parsed, addToProject, options);
				}
				return this.installOpenedChartStandalone(model, parsed, options);
			}, "loading.chart");
		} catch (error) {
			console.error(error);
			if (!options.silent) {
				this.toast.error("toast.openFailed", { message: localizedErrorMessage(error) });
			}
			return null;
		}
	}

	async loadMusic(file, record = true, options = {}) {
		if (!file) {
			return;
		}
		try {
			await this.audio.load(file);
			const copiedReference =
				record && globalThis.nw ? await this.files.copyAssetIntoProject(file, "music") : "";
			const reference = String(options.reference || copiedReference || this.files.assetReference(file));
			this.files.rememberAsset(reference, file, "music");
			this.projectMusic = reference;
			this.syncProjectSharedFields();
			this.syncProjectHistorySharedFields({ metadata: false });
			if (record) {
				this.model.editor.visibleRangeBeginning = Math.min(0, this.model.timing.offset);
				this.model.editor.visibleRangeEnd = Math.min(
					this.audio.duration,
					this.model.editor.visibleRangeBeginning + 10,
				);
			}
			if (record) {
				this.projectDirty = true;
				this.updateDirty();
			}
			this.toast.show("toast.musicLoaded");
			this._refreshLightweight?.({ rebuildIndex: false, skipCommands: true });
		} catch (error) {
			console.error(error);
			this.toast.error("toast.musicLoadFailed", { message: localizedErrorMessage(error) });
		}
	}

	async loadBackground(file, record = true, options = {}) {
		if (!file) {
			return;
		}
		try {
			await this.decodeBackground(file);
			const copiedReference =
				record && globalThis.nw ? await this.files.copyAssetIntoProject(file, "cover") : "";
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
			this._refreshLightweight?.({ rebuildIndex: false, skipCommands: true });
		} catch (error) {
			console.error(error);
			this.toast.error("toast.backgroundLoadFailed", { message: localizedErrorMessage(error) });
		}
	}

	async exportLyrica() {
		try {
			const text = exportLyricaChart(this.model);
			const location = await this.files.saveText(text, {
				filename: `${this.model.metadata.title || "chart"}.txt`,
				description: "Lyrica chart",
			});
			if (!location) {
				return null;
			}
			this.toast.show("toast.lyricaExported");
			return location;
		} catch (error) {
			this.toast.error("toast.lyricaExportFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	rememberOpenAfterSave({ saveAs = false } = {}) {
		if (!saveAs && this.editingProject && this.files?.projectPath) {
			this.rememberLastOpen("project", this.files.projectPath);
			return;
		}
		this.rememberLastOpen("chart", this.files?.chartPath);
	}

	async prepareProjectChartAssets() {
		if (!globalThis.nw || !this.files?.projectPath) {
			return;
		}
		await this.copyChartAssetsIntoProject(this.model);
		this.projectMusic = String(this.model.music || "");
		this.projectImage = String(this.model.image || "");
		this.syncProjectSharedFields();
	}

	async saveChart() {
		try {
			if (this.freeTransform) {
				this.finishFreeTransform();
			}
			await this.prepareProjectChartAssets();
			const location = await this.files.saveChart(this.model, {
				projectFilename: this.activeDifficultyState()?.file,
			});
			if (!location) {
				return null;
			}
			this.markSaved();
			this.history.markCurrent("save");
			this.autosave.markManualSave();
			this.rememberOpenAfterSave();
			this.toast.show("toast.saved");
			this._refreshLightweight?.({ rebuildIndex: false, skipInspector: true, skipCommands: true });
			return location;
		} catch (error) {
			this.toast.error("toast.saveFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async saveProject() {
		if (!globalThis.nw) {
			return null;
		}
		try {
			if (this.freeTransform) {
				this.finishFreeTransform();
			}
			const result = await this.files.saveProject(this.projectSnapshot());
			if (!result) {
				return null;
			}
			for (const saved of result.manifest.charts) {
				const entry = this.difficulties.find(item => item.id === saved.id);
				if (entry) {
					entry.file = saved.file;
				}
			}
			this.projectName = this.files.projectName || this.projectName;
			this.editingProject = true;
			this.difficultyUiSignature = "";
			this.projectMusic = String(this.model.music || "");
			this.projectImage = String(this.model.image || "");
			this.syncProjectSharedFields();
			this.markProjectSaved();
			for (const entry of this.difficulties) {
				entry.history.markCurrent("save");
			}
			this.autosave.markManualSave();
			this.rememberLastOpen("project", this.files.projectPath);
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
			if (this.freeTransform) {
				this.finishFreeTransform();
			}
			await this.prepareProjectChartAssets();
			const location = await this.files.saveChart(this.model, { saveAs: true });
			if (!location) {
				return null;
			}
			this.markSaved();
			this.history.markCurrent("save");
			this.autosave.markManualSave();
			this.rememberOpenAfterSave({ saveAs: true });
			this.toast.show("toast.saved");
			this._refreshLightweight?.({ rebuildIndex: false, skipInspector: true, skipCommands: true });
			return location;
		} catch (error) {
			this.toast.error("toast.saveFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async saveLevel() {
		try {
			if (this.freeTransform) {
				this.finishFreeTransform();
			}
			const project = this.projectSnapshot();
			if (!this.editingProject) {
				project.charts = project.charts.filter(entry => entry.id === this.activeDifficultyId);
			}
			const filename = await this.files.saveLevel(project);
			if (filename) {
				this.toast.show("toast.levelExported");
			}
			return filename;
		} catch (error) {
			this.toast.error("toast.levelExportFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async hostedLevel() {
		if (!this.files.musicFile) {
			return null;
		}
		const project = this.projectSnapshot();
		const blob = await this.files.createLevelArchive(project, {
			sscharterVersion: this.liveHosting.reloadPort > 0 ? SSCHARTER_VERSION : null,
			// The hosted level lives only in memory and is rebuilt on every edit, so it uses
			// level-zero (store) compression to keep rebuilds cheap.
			compression: "STORE",
		});
		const BufferRef = this.liveHosting.Buffer || globalThis.Buffer;
		if (!BufferRef) {
			throw new Error("Node Buffer is unavailable.");
		}
		return BufferRef.from(await blob.arrayBuffer());
	}

	broadcastLiveChartUpdate() {
		if (!this.liveHosting?.server || !(this.liveHosting.reloadPort > 0)) {
			return;
		}
		const entry = this.activeDifficultyState?.();
		if (!entry) {
			return;
		}
		const name = String(entry.file || "chart.json").replace(/\.json$/i, "");
		this.liveHosting.broadcast({
			type: "chartUpdate",
			name,
			chart: entry.model.exportSunniesnow({ includeSchema: true, sscharterVersion: SSCHARTER_VERSION }),
		});
		this.liveHosting.broadcast({ type: "update", onlyCharts: true });
	}

	async setLiveHosting(enabled) {
		if (!globalThis.nw) {
			return false;
		}
		try {
			if (enabled) {
				await this.liveHosting.start();
				const address = this.liveHosting.server?.address?.();
				const reloadPort = this.liveHosting.reloadServer?.address?.()?.port || this.liveHosting.reloadPort;
				const fallback = parseAddress(this.liveHosting.address);
				const url = hostedLevelUrl(
					address?.port ? address : { address: fallback.host, port: fallback.port },
				);
				this.toast.show("toast.liveHostingStarted", { url, port: reloadPort });
			} else {
				this.liveHosting.stop();
				this.toast.show("toast.liveHostingStopped");
			}
			this.requestStatusUpdate();
			return true;
		} catch (error) {
			this.liveHosting.stop();
			this.toast.error("toast.liveHostingFailed", { message: String(error?.message || error) });
			this.requestStatusUpdate();
			return false;
		}
	}

	async showTimingDialog() {
		const values = await this.dialogs.form({
			titleKey: "command.timing.offsetAndBpm",
			values: { offset: this.model.timing.offset, initialBpm: this.model.timing.initialBpm },
			fields: [
				{ id: "offset", type: "number", labelKey: "field.offset", required: true, step: "any" },
				{
					id: "initialBpm",
					type: "number",
					labelKey: "field.initialBpm",
					positive: true,
					min: 0.001,
					step: "any",
				},
			],
		});
		if (!values) {
			return;
		}
		this.commit(i18n.t("history.editTiming"), model => {
			model.timing.setOffset(values.offset);
			model.timing.setInitialBpm(values.initialBpm);
		});
	}
}

export const withOpenSave = composeTraits("OpenSaveLayer", OpenSaveTrait);
