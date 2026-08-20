import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AutosaveManager } from "../js/platform.js";
import { ChartModel } from "../js/core/chart-model.js";
import { SNAPPEE_PRESETS, createPresetSnappee } from "../js/core/snappee-presets.js";

function memoryStorage() {
	const values = new Map();
	return {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: key => values.delete(key),
	};
}

test("v10 preset snappees keep documented geometry and localized-ready ids", () => {
	assert.deepEqual(SNAPPEE_PRESETS.map(item => item.id), [
		"playfieldGrid", "turntable", "hexagon1", "hexagon2", "hexagon3", "hexagon4", "pentagon",
	]);
	const grid = createPresetSnappee("playfieldGrid", "Grid");
	assert.equal(grid.type, "rectangularMesh");
	assert.deepEqual([
		grid.topLeftX, grid.topLeftY, grid.bottomRightX, grid.bottomRightY,
		grid.horizontalTiles, grid.verticalTiles,
	], [-100, 50, 100, -50, 16, 8]);
});

test("JavaScript macro API exposes live chart collections and mutation helpers", async () => {
	await import("../js/macro-api.js");
	const api = globalThis.createSviberMacroApi({
		metadata: { title: "Macro" }, editor: { currentChannel: 0, currentTime: [2, 0, 1] },
		channels: [{ id: 0, name: "Main" }], events: [], snappees: [],
	});
	const event = api.tap({ x: 3, y: 4 });
	assert.equal(api.events[0], event);
	assert.equal(api.findEvent(event), event);
	api.updateEvent(event, { x: 8 });
	assert.equal(event.x, 8);
	api.select(event);
	assert.equal(api.events[0].selected, true);
	api.removeEvent(event);
	assert.equal(api.events.length, 0);
});

test("autosaves omit generated top-level events while ordinary saves retain them", () => {
	const storage = memoryStorage();
	const manager = new AutosaveManager({ storage });
	const model = ChartModel.createDefault({
		events: [{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0 }],
	});
	const timestamp = manager.save(model);
	const saved = JSON.parse(storage.getItem(`sviber.autosave.${timestamp}`));
	assert.equal(Object.hasOwn(saved, "events"), false);
	assert.equal(saved.sviber.events.length, 1);
	assert.equal(Object.hasOwn(JSON.parse(model.serialize()), "events"), true);
});

test("documentation and release metadata describe the current v10 behavior", async () => {
	const [manual, readme, readmeZh, rubyApi, sandbox, packageJson, serviceWorker] = await Promise.all([
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
		readFile(new URL("../README.md", import.meta.url), "utf8"),
		readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8"),
		readFile(new URL("../js/macro-api.rb", import.meta.url), "utf8"),
		readFile(new URL("../js/macro-sandbox.js", import.meta.url), "utf8"),
		readFile(new URL("../package.json", import.meta.url), "utf8"),
		readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
	]);
	assert.match(manual, /same sound and level; there is no strong-beat\/weak-beat accent/);
	assert.match(manual, /每拍使用相同的声音和响度，不区分强拍与弱拍/);
	assert.match(readme, /every 120 seconds/);
	assert.match(readmeZh, /每 120 秒/);
	assert.match(rubyApi, /\$stdout = SviberMacroOutput/);
	assert.match(rubyApi, /def puts\(\*values\)/);
	assert.match(sandbox, /consolePrint: false/);
	assert.equal(JSON.parse(packageJson).version, "0.2.3");
	assert.match(serviceWorker, /CACHE_VERSION = "sviber-v33"/);
});
