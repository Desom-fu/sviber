import assert from "node:assert/strict";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";

function makeProject(eventOverrides = {}) {
	const events = [
		{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, ...eventOverrides },
		{ id: 2, type: "tap", channel: 1, time: [1, 0, 1], x: 10, y: 0, ...eventOverrides },
	];
	return {
		channels: [
			{ id: 0, name: "A" },
			{ id: 1, name: "B" },
		],
		editor: { currentChannel: 0 },
		events,
		snappees: [],
	};
}

test("an inactive event leaves the main field and the scroll view but stays in the timeline", () => {
	const project = makeProject({ active: false });
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 120 }));
	assert.equal(index.eventRecords.length, 2, "the timeline index keeps every event");
	assert.equal(index.activeEventRecords.length, 0, "the stage drops inactive events");
	assert.equal(index.movableRecords.length, 0, "the scroll view drops inactive events");
	assert.equal(index.isEventActive(project.events[0]), false);
	assert.equal(index.isEventActive({ type: "tap", channel: 0 }), true, "events are active by default");
});

test("an inactive event is excluded from tip point guides", () => {
	const project = makeProject({ active: false });
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 120 }));
	assert.equal(index.allTipGuides.length, 0, "inactive events cannot be connected by a tip point");
});

test("group events carry the active flag too", () => {
	const project = {
		channels: [{ id: 0, name: "A" }],
		editor: { currentChannel: 0 },
		events: [
			{
				id: 3,
				type: "group",
				active: false,
				x: 0,
				y: 0,
				events: [{ id: 4, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0 }],
			},
		],
		snappees: [],
	};
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 120 }));
	assert.equal(index.isEventActive(project.events[0]), false);
});

test("the active flag survives a save/load round trip", () => {
	const model = new ChartModel(makeProject({ active: false }));
	assert.equal(model.events[0].active, false, "the inactive flag is normalized on import");
	const restored = ChartModel.import(model.toJSON());
	assert.equal(restored.events[0].active, false);
	assert.equal(restored.events[1].active, false);
});

test("deactivating a channel member hides only that event, not the whole channel", () => {
	const project = makeProject();
	project.events[0].active = false;
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 120 }));
	assert.equal(index.activeEventRecords.length, 1);
	assert.equal(index.eventRecords.length, 2, "the timeline still shows the inactive event");
});
