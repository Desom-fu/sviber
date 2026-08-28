import assert from "node:assert/strict";
import test from "node:test";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { AutosaveManager } from "../js/platform/platform.js";

function memoryStorage() {
	const values = new Map();
	return {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: key => values.delete(key),
	};
}

test("autosaves omit generated top-level events while ordinary saves retain them", () => {
	const storage = memoryStorage();
	const manager = new AutosaveManager({ storage });
	const model = ChartModel.createDefault({
		events: [{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0 }],
	});
	const timestamp = manager.save(model);
	const saved = JSON.parse(storage.getItem(`sviber.autosave.${timestamp}`));
	assert.equal(Object.hasOwn(saved.document, "events"), false);
	assert.equal(saved.document.sviber.events.length, 1);
	assert.equal(Object.hasOwn(JSON.parse(model.serialize()), "events"), true);
});

test("autosave listed entries include older saves", () => {
	const storage = new Map();
	const fake = {
		getItem(key) {
			return storage.has(key) ? storage.get(key) : null;
		},
		setItem(key, value) {
			storage.set(key, String(value));
		},
		removeItem(key) {
			storage.delete(key);
		},
	};
	const manager = new AutosaveManager({ storage: fake, interval: 0 });
	const first = manager.save(ChartModel.createDefault({ metadata: { title: "One" } }));
	manager.markManualSave();
	fake.setItem("sviber.manualSaveTime", first);
	const second = manager.save(ChartModel.createDefault({ metadata: { title: "Two" } }));
	assert.equal(manager.recoverable().length, 1);
	assert.equal(manager.listed().length, 2);
	assert.ok(manager.listed().some(entry => entry.timestamp === first));
	assert.ok(manager.listed().some(entry => entry.timestamp === second));
});

test("File menu autosave availability reads only the lightweight index", () => {
	const definitions = new Map();
	const CommandApp = withHistoryCommands(class {});
	const app = new CommandApp();
	app.registry = {
		register(id, definition) {
			definitions.set(id, definition);
		},
	};
	let indexReads = 0;
	app.autosave = {
		get index() {
			indexReads += 1;
			return [123];
		},
		listed() {
			throw new Error("opening the File menu must not parse recovery documents");
		},
	};
	app.recentOpens = () => [];
	app._registerCommands();
	assert.equal(definitions.get("file.openAutosave").enabled(), true);
	assert.equal(indexReads, 1);
});
