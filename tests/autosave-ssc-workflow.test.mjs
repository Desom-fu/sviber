import assert from "node:assert/strict";
import test from "node:test";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { withProjectState } from "../js/app/app-project-state.js";
import { ChartModel } from "../js/core/chart-model.js";
import { History } from "../js/core/history.js";
import { AutosaveManager } from "../js/platform/autosave.js";

function memoryStorage() {
	const values = new Map();
	return {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: key => values.delete(key),
	};
}

function importedSscModel() {
	return ChartModel.import({
		title: "Imported level",
		artist: "Artist",
		charter: "Charter",
		difficultyName: "Master",
		events: [
			{ type: "tap", time: 12, properties: { x: 0, y: 0, text: "A" } },
			{ type: "hold", time: 13, properties: { x: 20, y: 0, duration: 0.5, text: "B" } },
		],
	}, { offset: 0, initialBpm: 120, maxDenominator: 192 });
}

test("SSC-imported charts preserve events in autosave and restore them", () => {
	const model = importedSscModel();
	assert.equal(model.events.length, 2);
	const storage = memoryStorage();
	const manager = new AutosaveManager({ storage, interval: 0 });
	const timestamp = manager.save(model, { chartFilename: "Master.json" });
	const raw = JSON.parse(storage.getItem(`sviber.autosave.${timestamp}`));
	assert.equal(Object.hasOwn(raw.document, "events"), false);
	assert.equal(raw.document.sviber.events.length, 2);
	assert.deepEqual(raw.document.sviber.events.map(event => event.type), ["tap", "hold"]);
	const recovery = manager.listed()[0];
	assert.equal(recovery.model.events.length, 2);
	assert.deepEqual(recovery.model.events.map(event => event.type), ["tap", "hold"]);
});

test("SSC standalone import remains dirty so an unrecorded import can be autosaved", async () => {
	const source = await import("../js/app/app-open-save.js");
	const { withOpenSave } = source;
	const App = withOpenSave(
		class {
			installProject(charts, options) {
					this.difficulties = charts.map(entry => ({
						...entry,
						savedSignature: options.saved === false ? null : "saved",
					}));
				this.activeDifficultyId = options.activeChart;
				this.model = charts[0].model;
				this.projectMusic = this.model.music;
				this.projectImage = this.model.image;
			}

			async clearRuntimeMedia() {}

			async loadParsedMedia(parsed) {
				this.model.music = parsed.musicReference || this.model.music;
				this.model.image = parsed.imageReference || this.model.image;
			}

			markProjectSaved() {
				this.markedSaved = true;
			}

			rememberLastOpen() {}

			refresh() {}
		},
	);
	const app = new App();
	const model = importedSscModel();
	app.files = {
		clearProjectTarget() {},
		adoptChartSource() {},
	};
	app.editingProject = true;
	app.installProject = app.installProject.bind(app);
	await app.installOpenedChartStandalone(model, { fromLevel: true, chartFilename: "master.json" }, { silent: true });
	assert.equal(app.difficulties[0].savedSignature, null);
	assert.equal(app.markedSaved, undefined);
});

test("restoring a moved SSC event keeps imported music and image in history snapshots", () => {
	const model = importedSscModel();
	const initial = model.snapshot();
	const history = new History(initial);
	// SSC media arrives asynchronously after installProject created the initial history
	// entry, which is the ordering that originally made undo unload both assets.
	model.music = "archive-song.ogg";
	model.image = "archive-cover.png";
	const App = withProjectState(class {});
	const app = new App();
	app.model = model;
	app.history = history;
	app.difficulties = [{ id: "difficulty-0", model, history, savedSignature: null }];
	app.activeDifficultyId = "difficulty-0";
	app.projectArtist = "Artist";
	app.projectMusic = model.music;
	app.projectImage = model.image;
	app.syncProjectSharedFields();
	app.syncProjectHistorySharedFields({ metadata: false });
	const moved = model.snapshot();
	moved.events[0].x = 50;
	moved.events[0].y = 25;
	history.push(moved, "Move event");
	app._normalizeGroupSelectionScope = () => {};
	app._invalidatePlaybackSchedule = () => {};
	app.currentSeconds = () => 0;
	app.audio = { playing: false, seek() {} };
	app.restoreHistorySnapshot(history.undo());
	assert.equal(app.model.music, "archive-song.ogg");
	assert.equal(app.model.image, "archive-cover.png");
	assert.equal(app.history.current.music, "archive-song.ogg");
	assert.equal(app.history.current.image, "archive-cover.png");
});

test("restoring an old SSC snapshot never clears currently loaded media", () => {
	const model = importedSscModel();
	const history = new History(model.snapshot());
	model.music = "archive-song.ogg";
	model.image = "archive-cover.png";
	const App = withProjectState(class {});
	const app = new App();
	app.model = model;
	app.history = history;
	app.difficulties = [{ id: "difficulty-0", model, history, savedSignature: null }];
	app.activeDifficultyId = "difficulty-0";
	app.projectArtist = "Artist";
	app.projectMusic = model.music;
	app.projectImage = model.image;
	app._normalizeGroupSelectionScope = () => {};
	app._invalidatePlaybackSchedule = () => {};
	app.currentSeconds = () => 0;
	app.audio = { playing: false, seek() {} };
	app.restoreHistorySnapshot(history.current);
	assert.equal(app.model.music, "archive-song.ogg");
	assert.equal(app.model.image, "archive-cover.png");
});
