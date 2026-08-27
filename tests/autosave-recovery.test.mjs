import assert from "node:assert/strict";
import test from "node:test";

import { withHistoryCommands } from "../js/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { AutosaveManager } from "../js/platform.js";

class MemoryStorage {
	constructor() {
		this.map = new Map();
	}

	getItem(key) {
		return this.map.has(key) ? this.map.get(key) : null;
	}

	setItem(key, value) {
		this.map.set(key, String(value));
	}

	removeItem(key) {
		this.map.delete(key);
	}
}

test("discarding startup recovery does not mark a manual save", () => {
	const storage = new MemoryStorage();
	const manager = new AutosaveManager({ storage, interval: 0 });
	const model = ChartModel.createDefault({ metadata: { title: "Keep me" } });
	const timestamp = manager.save(model, {});
	assert.equal(manager.recoverable().length, 1);
	assert.equal(
		manager.recoverable().some(entry => entry.timestamp === timestamp),
		true,
	);
	assert.equal(manager.listed().length, 1);
	manager.markManualSave();
	assert.equal(manager.recoverable().length, 0);
	assert.equal(manager.listed().length, 1);
});

test("applyAutosaveRecovery reopens the full project before overlaying the chart", async () => {
	const App = withHistoryCommands(
		class {
			constructor() {
				this.calls = [];
				this.difficulties = [
					{
						id: "difficulty-0",
						file: "easy.json",
						model: ChartModel.createDefault({ metadata: { title: "Easy", difficultyName: "Easy" } }),
					},
					{
						id: "difficulty-1",
						file: "master.json",
						model: ChartModel.createDefault({ metadata: { title: "Master", difficultyName: "Master" } }),
					},
				];
				this.activeDifficultyId = "difficulty-1";
				this.files = {
					supportsLocalPaths: false,
					restoreLocalSourceContext: () => this.calls.push("restoreStandalone"),
				};
				this.editingProject = false;
				this.projectDirty = false;
			}

			async openProject(options) {
				this.calls.push(["openProject", options.directoryPath]);
				this.editingProject = true;
				return { manifest: { activeChart: "difficulty-1" }, charts: this.difficulties };
			}

			activateProjectChart(model, filename, options = {}) {
				this.calls.push(["activate", filename, options.saved, model.metadata.title]);
				this.model = model;
			}

			async clearRuntimeMedia() {
				this.calls.push("clear");
			}

			installProject() {
				this.calls.push("installStandalone");
			}

			async syncMediaFromModel() {}

			refresh() {
				this.calls.push("refresh");
			}
		},
	);

	const previousNw = globalThis.nw;
	globalThis.nw = {};
	try {
		const app = new App();
		const recovered = ChartModel.createDefault({
			metadata: { title: "Recovered Master", difficultyName: "Master" },
		});
		await app.applyAutosaveRecovery({
			model: recovered,
			source: { projectPath: "/tmp/demo-project", chartFilename: "master.json", projectName: "Demo" },
		});
		assert.deepEqual(app.calls[0], ["openProject", "/tmp/demo-project"]);
		assert.deepEqual(app.calls[1], ["activate", "master.json", false, "Recovered Master"]);
		assert.equal(app.calls.includes("installStandalone"), false);
		assert.equal(app.projectDirty, true);
		assert.equal(app.difficulties.length, 2);
	} finally {
		if (previousNw === undefined) {
			delete globalThis.nw;
		} else {
			globalThis.nw = previousNw;
		}
	}
});

test("applyAutosaveRecovery falls back to a standalone chart without nw", async () => {
	const App = withHistoryCommands(
		class {
			constructor() {
				this.calls = [];
				this.files = {
					supportsLocalPaths: false,
					restoreLocalSourceContext: source => this.calls.push(["restore", source.chartFilename]),
				};
				this.editingProject = true;
			}

			async clearRuntimeMedia() {
				this.calls.push("clear");
			}

			installProject(charts, options) {
				this.calls.push(["install", charts[0].file, options.saved, charts[0].model.metadata.title]);
				this.difficulties = charts;
			}

			async syncMediaFromModel() {}

			refresh() {
				this.calls.push("refresh");
			}
		},
	);
	const previousNw = globalThis.nw;
	delete globalThis.nw;
	try {
		const app = new App();
		const recovered = ChartModel.createDefault({ metadata: { title: "Solo", difficultyName: "Master" } });
		await app.applyAutosaveRecovery({
			model: recovered,
			source: { projectPath: "/tmp/ignored", chartFilename: "solo.json" },
		});
		assert.equal(app.editingProject, false);
		assert.ok(app.calls.some(entry => Array.isArray(entry) && entry[0] === "install"));
	} finally {
		if (previousNw === undefined) {
			delete globalThis.nw;
		} else {
			globalThis.nw = previousNw;
		}
	}
});
