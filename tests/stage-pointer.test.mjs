import assert from "node:assert/strict";
import test from "node:test";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { EVENT_EDITING_MODULES, STAGE_INTERACTION_MODULES, readSources } from "./module-source.mjs";
import { withStageInteractions } from "../js/render/stage-interactions.js";
import { StageViewCore as StageView } from "../js/render/stage-core.js";

test("shift-dragging the stage never retargets another event", async () => {
	const interactions = await readSources(STAGE_INTERACTION_MODULES);
	// v17: the governing event is the selected event closest to the pointer, and Shift
	// suppresses every other mouse interaction in the main field.
	assert.match(interactions, /_shiftDragTargets\(event, context\)[\s\S]*?_closestSelectedMovable\(/);
	assert.match(interactions, /event\.shiftKey && !freeTransform \? null : hit/);
	assert.match(interactions, /_closestSelectedMovable\(project, mapping, point, activeChannels\) \{/);
});

test("event-editing layer defines applyFlickAngles for main-field flick drags", async () => {
	const [editing, interactions] = await Promise.all([
		readSources(EVENT_EDITING_MODULES),
		readSources(STAGE_INTERACTION_MODULES),
	]);
	assert.match(editing, /function applyFlickAngles\(/);
	assert.match(editing, /onPreviewFlickAngle[\s\S]*applyFlickAngles/);
	assert.match(editing, /onFlickAngle[\s\S]*applyFlickAngles/);
	assert.match(interactions, /target\?\.type === "flick-handle"[\s\S]*?_flickPressDrag/);
	assert.match(interactions, /flick: "_moveFlick"/);
	assert.match(interactions, /flick: "_commitFlick"/);
});

test("main editor flick-handle drag previews and commits snapped angles", () => {
	const InteractionApp = withStageInteractions(class {});
	const stage = new InteractionApp();
	const flick = { id: 1, type: "flick", selected: true, angle: Math.PI / 2 };
	const tap = { id: 2, type: "tap", selected: true };
	const previewed = [];
	const committed = [];
	stage.callbacks = {
		getFreeTransform: () => null,
		onPreviewFlickAngle: (id, angle, changes) => previewed.push({ id, angle, changes }),
		onFlickAngle: (id, angle, changes) => committed.push({ id, angle, changes }),
		onPreviewPosition: () => {
			throw new Error("flick-handle drag must not move the note");
		},
		onMovePosition: () => {
			throw new Error("flick-handle drag must not move the note");
		},
	};
	stage.renderIndex = {
		stageSelectedEvents: [flick],
		positionFor: () => ({ x: 0, y: 0 }),
		isEventSelected: event => Boolean(event.selected),
		selectionTarget: event => event,
	};
	const context = { point: { x: 40, y: 10 }, project: { events: [flick] } };
	const eventHit = { type: "event", event: tap, position: { x: 0, y: 0 } };
	const eventDrag = stage._selectionDrag({ shiftKey: false }, context, eventHit);
	assert.equal(eventDrag.type, "event");
	const drag = stage._selectionDrag({ shiftKey: false }, context, { type: "flick-handle", event: flick });
	assert.equal(drag.type, "flick");
	assert.equal(drag.primaryId, 1);
	stage._moveFlick({ chart: { x: 10, y: 0 }, drag });
	stage._commitFlick({ chart: { x: 10, y: 0 }, drag });
	assert.equal(previewed.length, 1);
	assert.equal(committed.length, 1);
	assert.equal(previewed[0].id, 1);
	assert.equal(previewed[0].angle, 0);
	assert.equal(committed[0].angle, 0);
	assert.equal(committed[0].changes.get(1), 0);
});

test("main-field flick-angle callbacks write angles without touching other notes", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.lastFlickAngle = Math.PI / 2;
	app.preview = (_label, mutation) => mutation(app.model);
	app.commit = (_label, mutation) => mutation(app.model);
	app.model = ChartModel.createDefault({
		events: [
			{ id: 1, type: "flick", selected: true, channel: 0, time: [0, 0, 1], x: 0, y: 0, angle: Math.PI / 2 },
			{ id: 2, type: "flick", selected: true, channel: 0, time: [1, 0, 1], x: 10, y: 0, angle: Math.PI },
			{ id: 3, type: "tap", selected: true, channel: 0, time: [2, 0, 1], x: 20, y: 0 },
		],
	});
	const callbacks = app._stageCallbacks();
	const changes = new Map([
		[1, 0],
		[2, Math.PI / 2],
	]);
	callbacks.onPreviewFlickAngle(1, 0, changes);
	assert.equal(app.model.findEvent(1).angle, 0);
	assert.equal(app.model.findEvent(2).angle, Math.PI / 2);
	assert.equal(Object.hasOwn(app.model.findEvent(3), "angle"), false);
	callbacks.onFlickAngle(1, 0, changes);
	assert.equal(app.lastFlickAngle, 0);
	assert.equal(app.model.findEvent(1).angle, 0);
	assert.equal(app.model.findEvent(3).type, "tap");
});

test("shift-drag can target selected group events via group-anchor", async () => {
	const interactions = await readSources(STAGE_INTERACTION_MODULES);
	assert.match(interactions, /candidate\.type === "group"/);
	assert.match(
		interactions,
		/_emptyAreaDrag\(event, context, shift\)[\s\S]*?shift\.primary\.type === "group"[\s\S]*?type: "group-anchor"/,
	);
	assert.equal(interactions.includes('candidate.type !== "group"'), false);
});

test("Alt+Shift drag moves the selection exactly like Shift", () => {
	const InteractionApp = withStageInteractions(class {});
	const stage = new InteractionApp();
	const near = { id: 1, type: "tap", selected: true, channel: 0 };
	const far = { id: 2, type: "tap", selected: true, channel: 0 };
	stage.renderIndex = {
		selectedEvents: [near, far],
		activeChannelIds: new Set([0]),
		positionFor: event => (event.id === 1 ? { x: 10, y: 10 } : { x: 300, y: 300 }),
		isEventSelected: event => Boolean(event.selected),
		selectionTarget: event => event,
	};
	stage.callbacks = {};
	const context = {
		point: { x: 12, y: 12 },
		project: { channels: [{ id: 0, active: true }], events: [near, far] },
		mapping: { scale: 1, toScreen: point => point },
	};
	const drag = stage._selectionDrag({ shiftKey: true, altKey: true }, context, null);
	assert.equal(drag.type, "event");
	assert.equal(drag.hit.event.id, 1);
});

test("simultaneous notes stack by channel order with the lower channel on top", () => {
	const stage = Object.create(StageView.prototype);
	stage.renderIndex = { channelOrder: new Map([[0, 0], [1, 1]]) };
	const make = (id, channel, sequence) => ({ event: { id, channel }, start: 1, sequence });
	// Same time, different channels: the channel lower in the timeline (id 1) is painted
	// last and therefore covers the upper channel's note.
	const records = [make(1, 1, 2), make(2, 0, 1)];
	stage._sortNoteRecordsForStacking(records, { channels: [] });
	assert.deepEqual(records.map(record => record.event.id), [2, 1]);
	// Same time on the same channel: the later-added note stays on top.
	const sameChannel = [make(5, 0, 1), make(4, 0, 2)];
	stage._sortNoteRecordsForStacking(sameChannel, { channels: [] });
	assert.deepEqual(sameChannel.map(record => record.event.id), [5, 4]);
	// Different times paint in time order.
	const timed = [make(7, 0, 3), make(6, 1, 4)];
	timed[0].start = 2;
	timed[1].start = 1;
	stage._sortNoteRecordsForStacking(timed, { channels: [] });
	assert.deepEqual(timed.map(record => record.event.id), [6, 7]);
});
