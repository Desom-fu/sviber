import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { AutosaveManager } from "../js/platform/platform.js";

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

test("startup recovery rejection is recorded without deleting the snapshot", async () => {
	const source = await readFile(
		new URL("../js/app/app-core.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /if \(!values\) \{[\s\S]*?this\.autosave\.markManualSave\(\);/);
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

			refreshNow() {
				this.calls.push("refreshNow");
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
		// The recovered content lands in a chart the manifest already knows, so saving the
		// chart (Ctrl+S) is enough; the project itself did not change.
		assert.equal(app.projectDirty, false);
		assert.equal(app.difficulties.length, 2);
	} finally {
		if (previousNw === undefined) {
			delete globalThis.nw;
		} else {
			globalThis.nw = previousNw;
		}
	}
});

test("applyAutosaveRecovery marks an unknown chart as a project change", async () => {
	const App = withHistoryCommands(
		class {
			constructor() {
				this.difficulties = [
					{
						id: "difficulty-0",
						file: "easy.json",
						model: ChartModel.createDefault({ metadata: { title: "Easy", difficultyName: "Easy" } }),
					},
				];
				this.activeDifficultyId = "difficulty-0";
				this.files = { supportsLocalPaths: false, restoreLocalSourceContext: () => {} };
				this.editingProject = false;
				this.projectDirty = false;
			}

			async openProject() {
				this.editingProject = true;
				return { manifest: { activeChart: "difficulty-0" }, charts: this.difficulties };
			}

			activateProjectChart(model) {
				this.model = model;
			}

			async clearRuntimeMedia() {}

			installProject() {}

			async syncMediaFromModel() {}

			refreshNow() {}
		},
	);
	const previousNw = globalThis.nw;
	globalThis.nw = {};
	try {
		const app = new App();
		await app.applyAutosaveRecovery({
			model: ChartModel.createDefault({ metadata: { title: "New", difficultyName: "Extra" } }),
			source: { projectPath: "/tmp/demo-project", chartFilename: "bonus.json", projectName: "Demo" },
		});
		// "bonus.json" is not part of the manifest yet: only saving the project can persist it.
		assert.equal(app.projectDirty, true);
	} finally {
		if (previousNw === undefined) {
			delete globalThis.nw;
		} else {
			globalThis.nw = previousNw;
		}
	}
});

test("applyAutosaveRecovery still refreshes when media restore fails", async () => {
	const App = withHistoryCommands(
		class {
			constructor() {
				this.calls = [];
				this.difficulties = [];
				this.files = {
					supportsLocalPaths: true,
					restoreLocalSourceContext: () => this.calls.push("restore"),
				};
				this.editingProject = false;
			}

			async clearRuntimeMedia() {
				this.calls.push("clear");
			}

			installProject() {
				this.calls.push("install");
			}

			async syncMediaFromModel() {
				throw new Error("media is gone");
			}

			refreshNow() {
				this.calls.push("refreshNow");
			}
		},
	);
	const app = new App();
	const recovered = ChartModel.createDefault({ metadata: { title: "Solo", difficultyName: "Master" } });
	await app.applyAutosaveRecovery({ model: recovered, source: { chartPath: "", chartFilename: "" } });
	// A media failure must not abort the pipeline: refreshNow installs the recovered chart
	// into the views regardless.
	assert.ok(app.calls.includes("refreshNow"));
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

			refreshNow() {
				this.calls.push("refreshNow");
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

test("startup recovery paints immediately and syncs document title", async () => {
	const [core, history, media] = await Promise.all([
		readFile(new URL("../js/app/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-history-commands.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-preferences-media.js", import.meta.url), "utf8"),
	]);
	const recovery = history.slice(
		history.indexOf("async applyAutosaveRecovery"),
		history.indexOf("async openAutosave"),
	);
	assert.match(recovery, /this\.refreshNow\(\)/);
	assert.doesNotMatch(recovery, /this\.refresh\(\)/);
	// A failed media restore must not skip the refreshNow that installs the chart.
	assert.match(recovery, /syncMediaFromModel[\s\S]{0,400}catch/);
	assert.match(core, /_syncDocumentTitle\(\)/);
	assert.match(core, /nwWindow\.title = next/);
	assert.match(core, /_settleViewsAfterOpen\(\)/);
	assert.match(core, /_forceWorkspaceReflow\(\)/);
	assert.match(core, /_paintOpenViews\(\)/);
	assert.match(core, /Double rAF/);
	// initialize() must survive a failed recovery: the settle step and startAutosave run
	// even when _offerAutosave or the open path rejects.
	const startup = core.slice(core.indexOf("async initialize()"), core.indexOf("readOnlyCommandAllowed"));
	assert.match(startup, /try \{[\s\S]*?await this\._offerAutosave\(\);[\s\S]*?\} catch/);
	assert.match(startup, /await this\.openArgvPath[\s\S]*?\} catch/);
	assert.match(startup, /_settleViewsAfterOpen\(\);/);
	assert.match(startup, /this\.startAutosave\(\);/);
	// localizedErrorMessage is used by the media-restore error paths and must be imported.
	assert.match(media, /import \{[^}]*localizedErrorMessage[^}]*\} from "\.\/app-helpers\.js";/);
	assert.match(media, /localizedErrorMessage\(error\)/);
});
