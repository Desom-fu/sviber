import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { withDocumentLifecycle } from "../js/app/app-document-lifecycle.js";

function createLifecycleHarness(model, { editingProject = true } = {}) {
	const App = withDocumentLifecycle(class {});
	const app = new App();
	app.editingProject = editingProject;
	app.model = model;
	app.dirty = false;
	app.projectDirty = false;
	app.projectMusic = "";
	app.projectImage = "";
	app.nextDifficultyId = 1;
	app.activeDifficultyId = "difficulty-0";
	app.difficulties = [{ id: "difficulty-0", file: "master.sviber", model, history: null, savedSignature: null }];
	app.exitModes = () => {};
	app.lastCharter = () => "Alice";
	app.rememberCharter = () => {};
	app.syncProjectSharedFields = () => {};
	app.syncProjectHistorySharedFields = () => {};
	app.switchDifficulty = async () => true;
	app.installProject = () => {};
	app.files = { clearProjectTarget() {} };
	app.clearRuntimeMedia = async () => {};
	app.updateDirty = () => {};
	app.refresh = () => {};
	const captured = [];
	app.dialogs = {
		async form(options) {
			captured.push(options);
			return null;
		},
	};
	return { app, captured };
}

test("new chart in an open project defaults offset, initial BPM, and title from the currently open chart", async () => {
	const current = ChartModel.createDefault({
		metadata: {
			title: "Starlight",
			artist: "Composer",
			charter: "Old Charter",
			difficultyName: "Master",
			difficulty: "14",
		},
		timing: {
			offset: 1.375,
			initialBpm: 185,
			bpmChanges: [],
			barLines: [],
		},
	});
	const { app, captured } = createLifecycleHarness(current, { editingProject: true });

	await app.newChart();

	assert.equal(captured.length, 1);
	assert.equal(captured[0].titleKey, "dialog.newChart");
	assert.equal(captured[0].values.title, "Starlight");
	assert.equal(captured[0].values.offset, 1.375);
	assert.equal(captured[0].values.initialBpm, 185);
	assert.equal(captured[0].values.difficultyName, "Special");
	assert.equal(captured[0].values.difficulty, "12");
	assert.equal(captured[0].values.charter, "Alice");
});

test("new chart outside a project keeps standard defaults (0, 120, New chart)", async () => {
	const current = ChartModel.createDefault({
		metadata: { title: "Starlight" },
		timing: { offset: 2.5, initialBpm: 200, bpmChanges: [], barLines: [] },
	});
	const { app, captured } = createLifecycleHarness(current, { editingProject: false });

	await app.newChart();

	assert.equal(captured.length, 1);
	assert.equal(captured[0].titleKey, "dialog.newChart");
	assert.equal(captured[0].values.title, "New chart");
	assert.equal(captured[0].values.offset, 0);
	assert.equal(captured[0].values.initialBpm, 120);
	assert.equal(captured[0].values.difficultyName, "Master");
});
