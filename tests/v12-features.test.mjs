import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { encodeWebSocketFrame, parseAddress, SSCHARTER_VERSION } from "../js/live-hosting.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";
import { TimingMap } from "../js/core/timing.js";

test("nested groups keep recursive IDs, bounds, clips, and Sunniesnow export flat", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0, name: "One" }, { id: 1, name: "Two" }],
		events: [{
			id: 4, type: "group", channel: 0, x: 0, y: 0, color: "#ff9d3d", selected: true,
			events: [{ id: 7, type: "tap", channel: 0, time: [1, 0, 1], x: -20, y: 10 }, {
				id: 8, type: "group", channel: 1, x: 0, y: 0, events: [{ id: 9, type: "flick", channel: 1, time: [2, 0, 1], x: 30, y: -10 }],
			}],
		}],
	});
	const ids = model.allEvents().map(event => event.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(model.groupDescendants(4).length, 3);
	assert.deepEqual(model.groupBounds(4), { minX: -20, maxX: 30, minY: -10, maxY: 10 });
	model.addClip({ events: [{ type: "tap", time: [0, 0, 1], channel: 0 }], channels: [], snappees: [] });
	assert.equal(ChartModel.import(JSON.parse(model.serialize())).clips.length, 1);
	const exported = model.exportSunniesnow({ sscharterVersion: SSCHARTER_VERSION });
	assert.equal(exported.sscharter.version, "0.10.1");
	assert.equal(exported.events.filter(event => event.type === "tap").length, 1);
	assert.equal(exported.events.filter(event => event.type === "flick").length, 1);
});

test("live reload uses the sscharter WebSocket handshake contract", async () => {
	assert.deepEqual(parseAddress("127.0.0.1:31108"), { host: "127.0.0.1", port: 31108 });
	const frame = encodeWebSocketFrame("{\"type\":\"update\"}", Buffer);
	assert.equal(frame[0], 0x81);
	assert.equal(frame[1], 17);
	assert.equal(frame.subarray(2).toString(), "{\"type\":\"update\"}");
	const source = await readFile(new URL("../js/live-hosting.js", import.meta.url), "utf8");
	assert.match(source, /Sec-WebSocket-Accept/);
	assert.match(source, /eventInfoTip/);
});

test("nested group selection enters one level at a time", () => {
	const model = ChartModel.createDefault({ events: [{ id: 10, type: "group", channel: 0, x: 0, y: 0, events: [{
		id: 11, type: "group", channel: 0, x: 0, y: 0, events: [{ id: 12, type: "tap", channel: 0, time: [0, 0, 1], x: 1, y: 2 }],
	}] }] });
	const leaf = model.findEvent(12);
	assert.equal(new ChartRenderIndex(model, new TimingMap(), {}).selectionTarget(leaf).id, 11);
	assert.equal(new ChartRenderIndex(model, new TimingMap(), { selectionScope: 10 }).selectionTarget(leaf).id, 11);
	assert.equal(new ChartRenderIndex(model, new TimingMap(), { selectionScope: 11 }).selectionTarget(leaf).id, 12);
	model.findEvent(10).selected = true;
	model.findEvent(11).selected = true;
	model.ungroupSelected();
	assert.equal(model.findEvent(10), null);
	assert.equal(model.findEvent(11), null);
	assert.equal(model.findEvent(12).type, "tap");
});

test("removing a channel prunes empty nested groups", () => {
	const model = ChartModel.createDefault({ channels: [{ id: 0 }, { id: 1 }], events: [{
		id: 4, type: "group", channel: 0, x: 0, y: 0, events: [{ id: 5, type: "tap", channel: 1, time: [0, 0, 1], x: 0, y: 0 }],
	}] });
	model.removeChannel(1);
	assert.equal(model.findEvent(4), null);
});

test("timeline channel offset round-trips and clamps to visible channels", () => {
	const model = ChartModel.createDefault({
		channels: Array.from({ length: 8 }, (_, id) => ({ id, name: `Channel ${id + 1}` })),
		editor: { timelineChannelOffset: 5 },
	});
	assert.equal(model.editor.timelineChannelOffset, 5);
	const reopened = ChartModel.import(model.toJSON());
	assert.equal(reopened.editor.timelineChannelOffset, 5);
	const clamped = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }], editor: { timelineChannelOffset: 5 },
	});
	assert.equal(clamped.editor.timelineChannelOffset, 0);
});
