import assert from "node:assert/strict";
import test from "node:test";
import {
	scrollbarHeatmapColors,
	scrollbarNoteDensity,
	scrollbarRecordsForProject,
} from "../js/render/timeline-helpers.js";
import { ChartModel } from "../js/core/chart-model.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";

test("scrollbar heatmap maps note density from dark gray to bright red", () => {
	const records = [
		{ event: { type: "tap" }, start: 0.1 },
		{ event: { type: "hold" }, start: 0.1 },
		{ event: { type: "comment" }, start: 0.1 },
	];
	const density = scrollbarNoteDensity(records, [0, 1], 2);
	assert.deepEqual(density, [4, 0]);
	assert.deepEqual(scrollbarHeatmapColors(density), ["#7f1f1f", "#1f1f1f"]);
});

test("scrollbar heatmap drops notes whose channel was deleted", () => {
	const records = [
		{ event: { type: "tap", channel: 0 }, start: 0.1 },
		{ event: { type: "tap", channel: 1 }, start: 0.1 },
		{ event: { type: "hold", channel: 1 }, start: 0.6 },
	];
	const filtered = scrollbarRecordsForProject(records, { channels: [{ id: 0 }] });
	assert.deepEqual(
		filtered.map(record => record.event.channel),
		[0],
	);
	assert.deepEqual(scrollbarNoteDensity(filtered, [0, 1], 2), [2, 0]);
	assert.deepEqual(scrollbarNoteDensity(records, [0, 1], 2), [4, 2]);
});

test("removing a channel strips its notes from the render index even if event objects were copied", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }],
		events: [
			{ id: 1, type: "tap", time: [1, 0, 1], channel: 0, x: 0, y: 0 },
			{ id: 2, type: "tap", time: [2, 0, 1], channel: 1, x: 10, y: 0 },
			{ id: 3, type: "hold", time: [3, 0, 1], duration: [1, 0, 1], channel: 1, x: 20, y: 0 },
		],
	});
	const index = new ChartRenderIndex(model, model.timing);
	const copies = model.events.filter(event => event.channel === 1).map(event => ({ ...event }));
	model.removeChannel(1);
	assert.equal(index.removeChannel(1, copies), true);
	assert.deepEqual(
		index.eventRecords.map(record => record.event.id),
		[1],
	);
	const heatmap = scrollbarRecordsForProject(index.eventRecords, model);
	assert.deepEqual(
		heatmap.map(record => record.event.id),
		[1],
	);
});
