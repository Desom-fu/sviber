import assert from "node:assert/strict";
import test from "node:test";

import { collectIndexedHitSchedule } from "../js/audio/scheduler.js";
import { ChartModel, createEvent } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";
import { StageViewCore } from "../js/render/stage-core.js";
import { withStageNotes } from "../js/render/stage-notes.js";
import { eventDrawLayer, timelineTipCheckpointSignature } from "../js/render/timeline-helpers.js";

function largeProject(eventCount = 10_000) {
	const channels = Array.from({ length: 4 }, (_, id) => ({ id }));
	const events = Array.from({ length: eventCount }, (_, id) => ({
		id,
		type: "tap",
		channel: id % channels.length,
		time: [Math.floor(id / 16), id % 16, 16],
		x: (id % 200) - 100,
		y: (id % 100) - 50,
		text: "",
		tipPointSpawnType: id < channels.length ? "chain" : "inherit",
		tipPointSpawnTime: 1,
	}));
	return { channels, events, snappees: [] };
}

test("ordinary notes draw above bg notes, background patterns, and big text", () => {
	for (const type of ["bgNote", "grid", "bigText"]) {
		assert.equal(eventDrawLayer({ type }), 0);
	}
	for (const type of ["tap", "hold", "drag", "flick"]) {
		assert.equal(eventDrawLayer({ type }), 1);
	}
});

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

	assert.deepEqual(
		index.selectedEvents.map(event => event.id),
		[1],
	);
	assert.equal(index.eventLaneOffsets.get(1), -3.5);
	assert.equal(index.eventLaneOffsets.get(2), 3.5);
	assert.deepEqual(
		index.timelineRecords(3, 3).map(record => record.event.id),
		[1],
	);
	assert.equal(index.hudHitCount(1), 1);
	assert.equal(index.hudHitCount(5), 2);
});

test("render index incrementally appends a created root note", () => {
	const model = ChartModel.createDefault({
		snappees: [],
		events: [{ id: 1, type: "tap", time: [1, 0, 1], channel: 0, x: -10, y: 0, selected: true }],
		nextIds: { event: 2 },
	});
	const index = new ChartRenderIndex(model, model.timing);
	model.events[0].selected = false;
	const created = model.addEvent("tap", { time: [1, 0, 1], channel: 0, x: 10, y: 0, selected: true });
	assert.equal(index.appendRootEvent(created), true);
	index.replaceSelection([created]);
	assert.deepEqual(
		index.timelineRecords(0, 2).map(record => record.event.id),
		[1, 2],
	);
	assert.deepEqual(
		index.selectedEvents.map(event => event.id),
		[2],
	);
	assert.equal(index.doubleTapPairs.length, 1);
	assert.equal(index.eventLaneOffsets.get(1), -3.5);
	assert.equal(index.eventLaneOffsets.get(2), 3.5);
});

test("incremental selection expands groups without directly selecting descendants", () => {
	const model = ChartModel.createDefault({
		events: [
			{
				id: 1,
				type: "group",
				selected: true,
				events: [{ id: 2, type: "tap", time: [0, 0, 1], channel: 0, x: 0, y: 0, selected: false }],
			},
		],
	});
	const index = new ChartRenderIndex(model, model.timing);
	index.replaceSelection([model.events[0]]);
	assert.deepEqual(
		index.selectedEvents.map(event => event.id),
		[1, 2],
	);
	assert.equal(model.events[0].events[0].selected, false);
});

test("render index incrementally moves notes between channels", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }],
		events: [
			{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, x: 0, y: 0, tipPointSpawnType: "chain" },
			{
				id: 2,
				type: "tap",
				time: [1, 0, 1],
				channel: 0,
				x: 10,
				y: 0,
				tipPointSpawnType: "inherit",
				selected: true,
			},
		],
	});
	const index = new ChartRenderIndex(model, model.timing);
	const layout = { channels: { width: 800, y: 40 }, channelHeight: 48 };
	const initialSignature = timelineTipCheckpointSignature(layout, 0, model.channels, index.timelineTipRevision);
	const moved = model.events[1];
	moved.channel = 1;
	assert.equal(index.moveEventsToChannels([{ event: moved, from: 0, to: 1 }]), true);
	assert.deepEqual(
		index.noteEventRecordsByChannel.get(0).map(record => record.event.id),
		[1],
	);
	assert.deepEqual(
		index.noteEventRecordsByChannel.get(1).map(record => record.event.id),
		[2],
	);
	assert.deepEqual(
		index.tipGuidesByChannel.get(0)[0].events.map(event => event.id),
		[1],
	);
	assert.equal(index.tipGuidesByChannel.get(1).length, 0);
	assert.deepEqual(
		index.timelineTipGuides(-10, 10)[0].events.map(event => event.id),
		[1],
	);
	assert.equal(index.eventLaneOffsets.get(1), 0);
	assert.equal(index.eventLaneOffsets.get(2), 0);
	const movedDownSignature = timelineTipCheckpointSignature(layout, 0, model.channels, index.timelineTipRevision);
	assert.notEqual(movedDownSignature, initialSignature);
	moved.channel = 0;
	assert.equal(index.moveEventsToChannels([{ event: moved, from: 1, to: 0 }]), true);
	assert.deepEqual(
		index.timelineTipGuides(-10, 10)[0].events.map(event => event.id),
		[1, 2],
	);
	assert.notEqual(
		timelineTipCheckpointSignature(layout, 0, model.channels, index.timelineTipRevision),
		movedDownSignature,
	);
});

test("render index removes nested events without rebuilding event records", () => {
	const model = ChartModel.createDefault({
		events: [
			{
				id: 1,
				type: "group",
				events: [
					{ id: 2, type: "tap", time: [1, 0, 1], channel: 0, x: 0, y: 0, selected: true },
					{ id: 3, type: "hold", time: [2, 0, 1], duration: [2, 0, 1], channel: 0, x: 10, y: 0 },
				],
			},
			{ id: 4, type: "tap", time: [2, 0, 1], channel: 0, x: 20, y: 0 },
		],
	});
	const index = new ChartRenderIndex(model, model.timing);
	const recordsBefore = new Map(index.eventRecords.map(record => [record.event.id, record]));
	model.events[0].events.splice(0, 1);
	assert.equal(index.removeEvents([recordsBefore.get(2).event]), true);
	assert.deepEqual(
		index.eventRecords.map(record => record.event.id),
		[1, 3, 4],
	);
	assert.equal(index.recordFor(recordsBefore.get(2).event), undefined);
	assert.deepEqual(
		index.hitRecords.map(record => record.event.id),
		[3, 4],
	);
	assert.deepEqual(
		index.timelineRecords(0, 10).map(record => record.event.id),
		[3, 4],
	);
	assert.equal(index.eventLaneOffsets.get(3), -3.5);
	assert.equal(index.eventLaneOffsets.get(4), 3.5);
});

test("render index toggles active channels without rebuilding event records", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }],
		events: [
			{ id: 1, type: "tap", time: [1, 0, 1], channel: 0, x: 0, y: 0 },
			{ id: 2, type: "tap", time: [1, 0, 1], channel: 1, x: 10, y: 0 },
		],
	});
	const index = new ChartRenderIndex(model, model.timing);
	const firstRecord = index.recordFor(model.events[0]);
	model.channels[1].active = false;
	assert.equal(index.setActiveChannels(model.channels), true);
	assert.equal(index.recordFor(model.events[0]), firstRecord);
	assert.deepEqual(
		index.hitRecords.map(record => record.event.id),
		[1],
	);
	assert.deepEqual(index.activeTipGuides(0), []);
	model.channels[1].active = true;
	assert.equal(index.setActiveChannels(model.channels), true);
	assert.deepEqual(
		index.hitRecords.map(record => record.event.id),
		[1, 2],
	);
});

test("render index replaces a note type without rebuilding the event source", () => {
	const model = ChartModel.createDefault({
		events: [
			{ id: 1, type: "tap", time: [1, 0, 1], channel: 0, x: 0, y: 0, selected: true },
			{ id: 2, type: "tap", time: [1, 0, 1], channel: 0, x: 10, y: 0 },
		],
	});
	const index = new ChartRenderIndex(model, model.timing);
	const oldEvent = model.events[0];
	const newEvent = createEvent("hold", { ...oldEvent, id: oldEvent.id, duration: [2, 0, 1], selected: true });
	model.replaceEvent(oldEvent.id, newEvent);
	assert.equal(index.replaceEvents([{ oldEvent, newEvent }]), true);
	assert.equal(index.recordFor(newEvent).event.type, "hold");
	assert.equal(index.holdReleaseRecords[0].event, newEvent);
	assert.equal(index.selectedEvents[0], newEvent);
	assert.equal(index.doubleTapPairs.length, 0);
	assert.equal(index.doubleTapIds.has(2), false);
	const restored = createEvent("tap", { ...newEvent, id: newEvent.id, selected: true });
	model.replaceEvent(restored.id, restored);
	assert.equal(index.replaceEvents([{ oldEvent: newEvent, newEvent: restored }]), true);
	assert.equal(index.doubleTapPairs.length, 1);
	assert.equal(index.doubleTapIds.has(1), true);
	assert.equal(index.doubleTapIds.has(2), true);
});

test("double-tap lines use positions updated during a lightweight drag", () => {
	const event1 = { id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: -20, y: 0 };
	const event2 = { id: 2, type: "tap", channel: 0, time: [1, 0, 1], x: 20, y: 0 };
	const project = { channels: [{ id: 0 }], snappees: [], events: [event1, event2] };
	const timing = new TimingMap({ initialBpm: 60 });
	const renderIndex = new ChartRenderIndex(project, timing);
	const context = {
		moves: [],
		save() {},
		restore() {},
		beginPath() {},
		stroke() {},
		setLineDash() {},
		moveTo(x, y) {
			this.moves.push([x, y]);
		},
		lineTo(x, y) {
			this.moves.push([x, y]);
		},
	};
	const view = {
		renderIndex,
		state: { preferences: { noteSpeed: 4 } },
		timing,
	};
	StageViewCore.prototype._drawDoubleLines.call(view, context, project, { scale: 1, toScreen: point => point }, 1.1);
	assert.deepEqual(context.moves, [
		[-20, 0],
		[20, 0],
	]);
	event1.x = -5;
	event2.x = 35;
	renderIndex.refreshPositions([event1, event2]);
	context.moves.length = 0;
	StageViewCore.prototype._drawDoubleLines.call(view, context, project, { scale: 1, toScreen: point => point }, 1.1);
	assert.deepEqual(context.moves, [
		[-5, 0],
		[35, 0],
	]);
});

test("main-field tip points follow notes after a lightweight position refresh", () => {
	const event1 = {
		id: 1,
		type: "tap",
		channel: 0,
		time: [1, 0, 1],
		x: 0,
		y: 0,
		tipPointSpawnType: "chain",
		tipPointSpawnTime: 1,
		tipPointSpawnDistance: 0,
		tipPointSpawnAngle: 0,
	};
	const event2 = {
		id: 2,
		type: "tap",
		channel: 0,
		time: [2, 0, 1],
		x: 20,
		y: 0,
		tipPointSpawnType: "inherit",
		tipPointSpawnTime: 1,
	};
	const project = { channels: [{ id: 0 }], snappees: [], events: [event1, event2], editor: { showTipPoints: true } };
	const renderIndex = new ChartRenderIndex(project, new TimingMap({ initialBpm: 60 }));
	const NotesStage = withStageNotes(class {});
	const view = new NotesStage();
	view.renderIndex = renderIndex;
	const mapping = { originX: 0, originY: 0, scale: 1, toScreen: point => ({ x: point.x, y: point.y }) };
	const guide = renderIndex.tipGuides[0];
	const before = view._tipPointCheckpoints(guide, project, mapping);
	assert.equal(before.at(-1).x, 20);
	event2.x = 55;
	event2.y = 12;
	renderIndex.refreshPositions([event2]);
	const after = view._tipPointCheckpoints(guide, project, mapping);
	assert.equal(after.at(-1).x, 55);
	assert.equal(after.at(-1).y, 12);
});

test("timeline tip checkpoint cache signature changes with channel order", () => {
	const layout = { channels: { width: 800, y: 40 }, channelHeight: 48 };
	const first = timelineTipCheckpointSignature(layout, 0, [{ id: 0 }, { id: 1 }]);
	const reordered = timelineTipCheckpointSignature(layout, 0, [{ id: 1 }, { id: 0 }]);
	assert.notEqual(first, reordered);
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
	assert.deepEqual(
		index.creationEchoRecords(2.1).map(record => record.event.id),
		[1],
	);
	assert.deepEqual(
		index.creationEchoRecords(3.1).map(record => record.event.id),
		[2],
	);
	assert.equal(index.creationEchoRecords(3.3).length, 0);
});
