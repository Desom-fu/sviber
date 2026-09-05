import assert from "node:assert/strict";
import test from "node:test";
import { TimingMap } from "../js/core/timing.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";

test("render index separates inactive gameplay from complete timeline and comments", () => {
	const project = {
		channels: [
			{ id: 0, name: "Active", active: true },
			{ id: 1, name: "Inactive", active: false },
		],
		snappees: [],
		events: [
			{
				id: 1,
				type: "tap",
				channel: 0,
				time: [1, 0, 1],
				x: 0,
				y: 0,
				tipPointSpawnType: "chain",
				tipPointSpawnTime: 1,
			},
			{
				id: 2,
				type: "tap",
				channel: 0,
				time: [2, 0, 1],
				x: 1,
				y: 0,
				tipPointSpawnType: "inherit",
				tipPointSpawnTime: 1,
			},
			{
				id: 3,
				type: "tap",
				channel: 1,
				time: [1, 0, 1],
				x: 0,
				y: 1,
				tipPointSpawnType: "chain",
				tipPointSpawnTime: 1,
			},
			{
				id: 4,
				type: "tap",
				channel: 1,
				time: [2, 0, 1],
				x: 1,
				y: 1,
				tipPointSpawnType: "inherit",
				tipPointSpawnTime: 1,
			},
			{ id: 5, type: "comment", channel: 0, time: [0, 0, 1], duration: [2, 0, 1], text: "active" },
			{ id: 6, type: "comment", channel: 1, time: [0, 0, 1], duration: [2, 0, 1], text: "inactive" },
		],
	};
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 60 }));
	assert.deepEqual(
		index.hitRecords.map(record => record.event.id),
		[1, 2],
	);
	assert.equal(index.tipGuides.length, 1);
	assert.equal(index.allTipGuides.length, 1);
	assert.equal(index.timelineTipGuides(-10, 10).length, 1);
	assert.deepEqual(
		index.activeComments(0.5).map(event => event.text),
		["active", "inactive"],
	);
	assert.equal(index.eventById.get(4), project.events[3]);

	index.setEventSelected(project.events[0], true);
	assert.equal(index.selectedEventIds.has(1), true);
	index.setEventSelected(project.events[0], false);
	assert.equal(index.selectedEventIds.has(1), false);
});
