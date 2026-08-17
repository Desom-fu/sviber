import assert from "node:assert/strict";
import test from "node:test";

import { collectIndexedHitSchedule } from "../js/audio/scheduler.js";
import { TimingMap } from "../js/core/timing.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";

function largeProject(eventCount = 10_000) {
	const channels = Array.from({ length: 4 }, (_, id) => ({ id }));
	const events = Array.from({ length: eventCount }, (_, id) => ({
		id,
		type: "tap",
		channel: id % channels.length,
		time: [Math.floor(id / 16), id % 16, 16],
		x: id % 200 - 100,
		y: id % 100 - 50,
		text: "",
		tipPointSpawnType: id < channels.length ? "chain" : "inherit",
		tipPointSpawnTime: 1,
	}));
	return { channels, events, snappees: [] };
}

test("render index limits 10k-event playback work to active time windows", () => {
	const project = largeProject();
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 120 }));

	assert.equal(index.eventRecords.length, 10_000);
	assert.equal(index.tipGuides.length, 4);
	assert.ok(index.visibleMovableRecords(100).length < 64);
	assert.ok(index.timelineRecords(100, 110).length < 400);
	assert.equal(index.activeTipGuides(100).length, 4);

	const schedule = collectIndexedHitSchedule(index.hitRecords, 100, 1, new Set());
	assert.equal(schedule.length, 4);
	assert.ok(schedule.every(record => record.hitTime >= 100 && record.hitTime <= 100.1));
});

test("render index caches selection, lane offsets, and duration overlap", () => {
	const project = {
		channels: [{ id: 0 }],
		snappees: [],
		events: [
			{ id: 1, type: "hold", channel: 0, time: [1, 0, 1], duration: [4, 0, 1], x: 0, y: 0, selected: true },
			{ id: 2, type: "tap", channel: 0, time: [1, 0, 1], x: 10, y: 0 },
		],
	};
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 60 }));

	assert.deepEqual(index.selectedEvents.map(event => event.id), [1]);
	assert.equal(index.eventLaneOffsets.get(1), -3.5);
	assert.equal(index.eventLaneOffsets.get(2), 3.5);
	assert.deepEqual(index.timelineRecords(3, 3).map(record => record.event.id), [1]);
	assert.equal(index.hudHitCount(1), 1);
	assert.equal(index.hudHitCount(5), 2);
});

test("creation echoes use an indexed one-over-speed interval after event end", () => {
	const project = {
		channels: [{ id: 0 }],
		snappees: [],
		events: [
			{ id: 1, type: "tap", channel: 0, time: [2, 0, 1], x: 0, y: 0 },
			{ id: 2, type: "hold", channel: 0, time: [1, 0, 1], duration: [2, 0, 1], x: 0, y: 0 },
		],
	};
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 60 }), { noteSpeed: 4 });
	assert.deepEqual(index.creationEchoRecords(2.1).map(record => record.event.id), [1]);
	assert.deepEqual(index.creationEchoRecords(3.1).map(record => record.event.id), [2]);
	assert.equal(index.creationEchoRecords(3.3).length, 0);
});
