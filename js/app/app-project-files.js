// Project-level file workflows introduced in v17.
//
// Only the currently open chart can have unsaved changes; everything that belongs to
// the project itself (its chart list, its active chart and its macros) is written to
// the filesystem as soon as it changes.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { ChartModel } from "../core/chart-model.js";
import {
	LEGACY_PROJECT_FILENAME,
	PROJECT_FILENAME,
	createProjectManifest,
	sanitizeFileStem,
} from "../core/project.js";
import { localizedErrorMessage } from "./app-helpers.js";

function chartFileStem(filename) {
	return String(filename || "").replace(/\.json$/i, "");
}

class ProjectFilesTrait {
	// v17: a path in argv opens or imports a chart, level or project folder on startup.
	async openArgvPath() {
		if (!globalThis.nw) {
			return false;
		}
		let pathname = String(globalThis.sviberOpenPath || "");
		if (!pathname) {
			const argv = Array.from(globalThis.nw.App?.argv || []);
			pathname = argv.find(entry => !String(entry).startsWith("-")) || "";
		}
		if (!pathname) {
			return false;
		}
		globalThis.sviberOpenPath = "";
		try {
			if (await this.files.isProjectDirectory?.(pathname)) {
				return Boolean(await this.openProject({ directoryPath: pathname, skipUnsaved: true }));
			}
			const file = await this.files.fileFromLocalPath(pathname, "application/octet-stream");
			if (!file) {
				return false;
			}
			return Boolean(await this.openFile(file, { skipUnsaved: true }));
		} catch (error) {
			this.toast.error("toast.openFailed", { message: localizedErrorMessage(error) });
			return false;
		}
	}

	async projectMacroEntries() {
		if (!globalThis.nw || !this.files.projectPath) {
			return [];
		}
		try {
			const files = [
				...(await this.files.listProjectFiles(".js")),
				...(await this.files.listProjectFiles(".rb")),
			];
			return files.map(file => ({ file, name: String(file).replace(/\.[^.]+$/, "") }));
		} catch {
			return [];
		}
	}

	// Immediately persists everything the manifest describes. Called whenever the
	// project (not the chart) changes.
	async persistProjectManifest() {
		if (!globalThis.nw || !this.editingProject || !this.files.projectPath) {
			return false;
		}
		try {
			this.syncActiveDifficultyState();
			const manifest = createProjectManifest({
				charts: this.difficulties.map(entry => ({ id: entry.id, file: entry.file })),
				activeChart: this.activeDifficultyId,
				macros: await this.projectMacroEntries(),
			});
			await this.files.writeProjectText(PROJECT_FILENAME, `${JSON.stringify(manifest, null, 2)}\n`);
			if (this.files.projectManifestFilename === LEGACY_PROJECT_FILENAME) {
				await this.files.removeProjectText(LEGACY_PROJECT_FILENAME);
				this.files.projectManifestFilename = PROJECT_FILENAME;
			}
			return true;
		} catch (error) {
			this.toast.error("toast.projectManifestFailed", { message: localizedErrorMessage(error) });
			return false;
		}
	}

	canReloadChartFromDisk() {
		if (!globalThis.nw) {
			return false;
		}
		if (this.editingProject) {
			return Boolean(this.files.projectPath && this.activeDifficultyState()?.file);
		}
		return Boolean(this.files.chartPath);
	}

	async reloadChartFromDisk() {
		if (!this.canReloadChartFromDisk()) {
			return false;
		}
		if (this.dirty) {
			const proceed = await this.dialogs.confirm({
				titleKey: "command.file.reloadChart",
				messageKey: "dialog.reloadChartMessage",
			});
			if (!proceed) {
				return false;
			}
		}
		this.exitModes();
		try {
			if (!this.editingProject) {
				const file = await this.files.fileFromLocalPath(this.files.chartPath);
				if (!file) {
					throw new Error("The chart file is unavailable.");
				}
				await this.openFile(file, { skipUnsaved: true, silent: true });
				this.toast.show("toast.chartReloaded");
				return true;
			}
			const entry = this.activeDifficultyState();
			const text = await this.files.readProjectText(entry.file);
			if (text == null) {
				throw new Error("The chart file is unavailable.");
			}
			const model = ChartModel.import(JSON.parse(text));
			this.activateProjectChart(model, entry.file, { saved: true });
			await this.syncMediaFromModel();
			this.toast.show("toast.chartReloaded");
			return true;
		} catch (error) {
			this.toast.error("toast.openFailed", { message: localizedErrorMessage(error) });
			return false;
		}
	}

	projectChartFilenames() {
		return this.difficulties.map(entry => entry.file);
	}

	async renameChartTo(filename) {
		const entry = this.activeDifficultyState();
		if (!entry || filename.toLowerCase() === entry.file.toLowerCase()) {
			return false;
		}
		try {
			await this.files.renameProjectText(entry.file, filename);
			entry.file = filename;
			this.difficultyUiSignature = "";
			await this.persistProjectManifest();
			this.toast.show("toast.chartRenamed");
			this.refresh();
			return true;
		} catch (error) {
			this.toast.error("toast.chartRenameFailed", { message: localizedErrorMessage(error) });
			return false;
		}
	}

	async renameChartDialog() {
		if (!globalThis.nw || !this.editingProject) {
			return null;
		}
		const entry = this.activeDifficultyState();
		const taken = new Set(
			this.difficulties
				.filter(candidate => candidate !== entry)
				.map(candidate => candidate.file.toLowerCase()),
		);
		const values = await this.dialogs.form({
			titleKey: "command.file.renameChart",
			values: { stem: chartFileStem(entry.file) },
			fields: [
				{
					id: "stem",
					type: "text",
					labelKey: "field.chartFilename",
					helpKey: "field.chartFilename.help",
					required: true,
					validate: value => {
						const stem = sanitizeFileStem(String(value || ""), "");
						if (!stem) {
							return "validation.required";
						}
						return taken.has(`${stem.toLowerCase()}.json`) ? "validation.filenameTaken" : "";
					},
				},
			],
		});
		if (!values) {
			return null;
		}
		const filename = `${sanitizeFileStem(values.stem, "chart")}.json`;
		await this.renameChartTo(filename);
		return filename;
	}

	// v17 pseudocode for "Open recent...". The prompts decide whether the selected
	// chart is opened standalone, inside its own project, or added to the open project.
	async recentChartPlan(entry) {
		const currentPath = this.editingProject ? "" : String(this.files.chartPath || "");
		if (currentPath && currentPath === entry.path) {
			return { action: "none" };
		}
		const containing = await this.files.containingProjectPath?.(entry.path);
		const openProjectPath = this.editingProject ? String(this.files.projectPath || "") : "";
		if (containing && openProjectPath && containing === openProjectPath) {
			return { action: "activate", filename: this.files.projectChartFilename(entry.path) };
		}
		if (containing) {
			const inProject = await this.dialogs.confirm({
				titleKey: "dialog.openRecent",
				messageKey: "dialog.openRecentInProject",
			});
			if (inProject) {
				return { action: "openProject", directoryPath: containing, chartPath: entry.path };
			}
		}
		if (this.editingProject) {
			const add = await this.confirmAddToProject();
			return add ? { action: "addToProject" } : { action: "openChart" };
		}
		return { action: "openChart" };
	}

	async runRecentChartPlan(plan, entry) {
		if (plan.action === "none") {
			return true;
		}
		if (!(await this.confirmUnsaved())) {
			return false;
		}
		if (plan.action === "activate") {
			const target = this.difficulties.find(item => item.file.toLowerCase() === plan.filename?.toLowerCase());
			return target ? this.switchDifficulty(target.id, { skipSavePrompt: true }) : false;
		}
		if (plan.action === "openProject") {
			const opened = await this.openProject({ directoryPath: plan.directoryPath, skipUnsaved: true });
			if (!opened) {
				return false;
			}
			const filename = this.files.projectChartFilename(plan.chartPath);
			const target = this.difficulties.find(item => item.file.toLowerCase() === filename.toLowerCase());
			if (target) {
				await this.switchDifficulty(target.id, { skipSavePrompt: true });
			}
			return true;
		}
		const file = await this.files.fileFromLocalPath(entry.path);
		if (!file) {
			return false;
		}
		return Boolean(
			await this.openFile(file, {
				skipUnsaved: true,
				forceAddToProject: plan.action === "addToProject",
				forceStandalone: plan.action === "openChart",
			}),
		);
	}

	async openRecent() {
		this.exitModes();
		const entry = await this.chooseRecentEntry();
		if (!entry) {
			return;
		}
		if (entry.kind === "project") {
			const openProjectPath = this.editingProject ? String(this.files.projectPath || "") : "";
			if (openProjectPath && openProjectPath === entry.path) {
				return;
			}
			if (!(await this.confirmUnsaved())) {
				return;
			}
			const opened = await this.openProject({ directoryPath: entry.path, skipUnsaved: true });
			if (!opened) {
				this.toast?.error("toast.openFailed", { message: i18n.t("toast.recentUnavailable") });
			}
			return;
		}
		const plan = await this.recentChartPlan(entry);
		const done = await this.runRecentChartPlan(plan, entry);
		if (!done) {
			this.toast?.error("toast.openFailed", { message: i18n.t("toast.recentUnavailable") });
		}
	}

}

const withProjectFilesBase = composeTraits("ProjectFilesBase", ProjectFilesTrait);

async function persistIfDone(app, result) {
	if (result) {
		await app.persistProjectManifest();
	}
	return result;
}

async function offerRenameAfterProperties(app, previousName, values) {
	if (!values || !globalThis.nw || !app.editingProject) {
		return values;
	}
	if (String(values.difficultyName) === String(previousName)) {
		return values;
	}
	const filename = `${sanitizeFileStem(values.difficultyName, "chart")}.json`;
	const taken = app.difficulties
		.filter(entry => entry.id !== app.activeDifficultyId)
		.some(entry => entry.file.toLowerCase() === filename.toLowerCase());
	if (taken || filename.toLowerCase() === app.activeDifficultyState()?.file.toLowerCase()) {
		return values;
	}
	const rename = await app.dialogs.confirm({
		titleKey: "command.file.renameChart",
		messageKey: "dialog.renameChartAfterProperties",
		params: { filename },
	});
	if (rename) {
		await app.renameChartTo(filename);
	}
	return values;
}

async function newProjectAbsorbingChart(app, options) {
	if (options.chartOnly || !globalThis.nw || app.editingProject) {
		return null;
	}
	const keep = await app.dialogs.confirm({
		titleKey: "dialog.newProject",
		messageKey: "dialog.newProjectKeepChart",
	});
	if (!keep) {
		return null;
	}
	app.exitModes();
	app.editingProject = true;
	app.files.clearProjectTarget();
	app.difficultyUiSignature = "";
	app.projectDirty = true;
	app.updateDirty();
	app.refresh();
	return app.saveProject();
}

export const withProjectFiles = Base =>
	class extends withProjectFilesBase(Base) {
		async switchDifficulty(id, options = {}) {
			return persistIfDone(this, await super.switchDifficulty(id, options));
		}

		async deleteDifficulty() {
			return persistIfDone(this, await super.deleteDifficulty());
		}

		activateProjectChart(model, filename, options = {}) {
			const target = super.activateProjectChart(model, filename, options);
			void this.persistProjectManifest();
			return target;
		}

		async showChartProperties(newChart = false) {
			const previousName = this.model.metadata.difficultyName;
			return offerRenameAfterProperties(this, previousName, await super.showChartProperties(newChart));
		}

		async newProject(options = {}) {
			return (await newProjectAbsorbingChart(this, options)) ?? super.newProject(options);
		}

		async saveChart() {
			const location = await super.saveChart();
			if (location && this.editingProject) {
				await this.persistProjectManifest();
			}
			return location;
		}
	};
