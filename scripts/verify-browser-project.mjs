import assert from "node:assert/strict";
import path from "node:path";

export async function runProjectChecks(page, outputDirectory) {
	const browserState = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const desktopOnly = ["file.newProject", "file.openProject", "file.openRecent", "file.saveProject", "file.deleteChart"];
		let projectPickerError = "";
		try { await app.files.chooseProjectDirectory(); }
		catch (error) { projectPickerError = String(error?.message || error); }
		return {
			editingProject: app.editingProject,
			difficultyCount: app.difficulties.length,
			desktopCommands: Object.fromEntries(desktopOnly.map(id => [id, app.registry.isEnabled(id, app)])),
			openRecentDesktopOnly: app.registry.get("file.openRecent").definition.desktopOnly,
			projectPickerError,
		};
	});
	assert.equal(browserState.editingProject, false);
	assert.equal(browserState.difficultyCount, 1);
	assert.ok(Object.values(browserState.desktopCommands).every(value => value === false));
	assert.equal(browserState.openRecentDesktopOnly, true);
	assert.match(browserState.projectPickerError, /desktop app/i);

	const newChartState = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const originalForm = app.dialogs.form;
		const originalConfirmUnsaved = app.confirmUnsaved;
		app.dialogs.form = async options => options.titleKey === "dialog.newChart" ? {
			...app.model.metadata,
			title: "Browser standalone",
			difficultyName: "Hard",
			difficultyColor: "#e75e74",
			difficulty: "9",
			difficultySup: "",
			offset: 0,
			initialBpm: 120,
		} : originalForm(options);
		app.confirmUnsaved = async () => true;
		try { await app.newChart(); }
		finally {
			app.dialogs.form = originalForm;
			app.confirmUnsaved = originalConfirmUnsaved;
		}
		return {
			editingProject: app.editingProject,
			difficultyCount: app.difficulties.length,
			title: app.model.metadata.title,
			difficultyName: app.model.metadata.difficultyName,
		};
	});
	assert.deepEqual(newChartState, {
		editingProject: false,
		difficultyCount: 1,
		title: "Browser standalone",
		difficultyName: "Hard",
	});
	await page.screenshot({ path: path.join(outputDirectory, "sviber-browser-chart-only.png"), fullPage: true });
}
