import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Event traits use perdurant/textable/background; removed names are gone", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		channels: [{ id: 0, name: "Main" }],
		events: [],
		snappees: [],
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
	});
	const tap = new runtime.globals.Tap({ location: new runtime.globals.Location(0, 0) });
	const hold = new runtime.globals.Hold({
		location: new runtime.globals.Location(0, 0),
		duration: [1, 0, 1],
	});
	const grid = new runtime.globals.Grid({ duration: [1, 0, 1] });
	assert.equal(tap.textable, true);
	assert.equal(tap.perdurant, false);
	assert.equal(hold.perdurant, true);
	assert.equal(grid.background, true);
	assert.equal(Object.hasOwn(tap, "haveDuration"), false);
	assert.equal(tap.haveDuration, undefined);
	assert.equal(tap.haveText, undefined);
	tap.lock();
	assert.equal(tap.locked, true);
	tap.unlock();
	assert.equal(tap.locked, false);
	tap.deactivate();
	assert.equal(tap.active, false);
	tap.activate();
	assert.equal(tap.active, true);
	const channel = runtime.globals.Channel.current;
	channel.active = false;
	assert.equal(channel.active, false);
	const ruby = await readFile(new URL("../js/macro/macro-api.rb", import.meta.url), "utf8");
	assert.match(ruby, /def perdurant\?/);
	assert.match(ruby, /def textable\?/);
	assert.match(ruby, /def background\?/);
	assert.doesNotMatch(ruby, /def have_duration\?/);
	assert.doesNotMatch(ruby, /def have_text\?/);
	assert.match(ruby, /alias tp tip_point/);
});

test("event JSON round-trips active", async () => {
	const { ChartModel } = await import("../js/core/chart-model.js");
	const model = ChartModel.createDefault({
		events: [{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, x: 0, y: 0, active: false }],
	});
	assert.equal(model.events[0].active, false);
	const restored = ChartModel.import({ metadata: model.metadata, sviber: model.serializeSviber() });
	assert.equal(restored.events[0].active, false);
});
