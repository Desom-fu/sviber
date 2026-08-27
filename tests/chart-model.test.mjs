// Chart model behaviour: converting an event between types, the default snappee set, and how
// identifiers survive deletion, serialization and reopening.
import test from "node:test";
import assert from "node:assert/strict";

import { ChartModel, createDefaultSnappees, createEvent } from "../js/core/chart-model.js";

test("event type conversion removes fields that the destination type cannot use", () => {
	const source = {
		id: 7,
		time: [2, 0, 1],
		channel: 0,
		selected: true,
		attached: false,
		x: 12,
		y: 34,
		duration: [3, 0, 1],
		text: "legacy",
		angle: Math.PI / 4,
		tipPointSpawnType: "chain",
		tipPointSpawnAbsolutePosition: false,
		tipPointSpawnDistance: 100,
		tipPointSpawnAngle: Math.PI / 2,
		tipPointSpawnTimeBeats: false,
		tipPointSpawnTime: 1,
	};
	const pattern = createEvent("grid", source);
	for (const field of [
		"attached",
		"x",
		"y",
		"snappee",
		"snapPoint",
		"text",
		"angle",
		"tipPointSpawnType",
		"tipPointSpawnDistance",
		"tipPointSpawnTime",
	]) {
		assert.equal(Object.hasOwn(pattern, field), false, `${field} leaked into a grid event`);
	}
	assert.deepEqual(pattern.duration, [3, 0, 1]);

	const drag = createEvent("drag", source);
	assert.equal(Object.hasOwn(drag, "duration"), false);
	assert.equal(Object.hasOwn(drag, "text"), false);
	assert.equal(Object.hasOwn(drag, "angle"), false);
	assert.equal(drag.tipPointSpawnType, "chain");
	assert.equal(drag.x, 12);
	assert.equal(drag.y, 34);

	assert.deepEqual(createEvent("bgNote", { ...source, duration: 0 }).duration, [0, 0, 1]);
	assert.deepEqual(createEvent("hold", { ...source, duration: 0 }).duration, [1, 0, 1]);
});

test("new charts create and activate only the rectangular default snappee", () => {
	const snappees = createDefaultSnappees();
	assert.equal(snappees.length, 1);
	assert.deepEqual(
		snappees.map(item => item.type),
		["rectangularMesh"],
	);
	assert.deepEqual(
		snappees.map(item => item.active),
		[true],
	);
	assert.deepEqual([snappees[0].horizontalTiles, snappees[0].verticalTiles], [16, 8]);
});

test("ChartModel deletions do not renumber surviving IDs and saved IDs round-trip", () => {
	const model = ChartModel.createDefault();
	const defaultSnappeeIds = model.snappees.map(({ id }) => id);
	const removedChannel = model.addChannel(model.channels.length, { name: "Removed" });
	const survivingChannel = model.addChannel(model.channels.length, { name: "Surviving" });
	const removedEvent = model.addEvent("tap", { channel: 0, x: 1, y: 2 });
	const survivingEvent = model.addEvent("tap", { channel: survivingChannel.id, x: 3, y: 4 });
	const removedSnappee = model.addSnappee("rectangularMesh");
	const survivingSnappee = model.addSnappee("radialMesh");

	model.removeChannel(removedChannel.id);
	model.removeEvent(removedEvent.id);
	model.removeSnappee(removedSnappee.id);

	assert.deepEqual(
		model.channels.map(({ id }) => id),
		[0, survivingChannel.id],
	);
	assert.deepEqual(
		model.events.map(({ id }) => id),
		[survivingEvent.id],
	);
	assert.deepEqual(
		model.snappees.map(({ id }) => id),
		[...defaultSnappeeIds, survivingSnappee.id],
	);

	const reopened = ChartModel.import(JSON.stringify(model.toJSON()));
	assert.deepEqual(
		reopened.channels.map(({ id }) => id),
		[0, survivingChannel.id],
	);
	assert.deepEqual(
		reopened.events.map(({ id }) => id),
		[survivingEvent.id],
	);
	assert.deepEqual(
		reopened.snappees.map(({ id }) => id),
		[...defaultSnappeeIds, survivingSnappee.id],
	);
});

test("ChartModel persists nextIds so reopened charts never reuse deleted IDs", () => {
	const model = ChartModel.createDefault();
	const oldChannel = model.addChannel();
	const oldEvent = model.addEvent("tap", { channel: 0 });
	const oldSnappee = model.addSnappee("rectangularMesh");
	model.removeChannel(oldChannel.id);
	model.removeEvent(oldEvent.id);
	model.removeSnappee(oldSnappee.id);

	const reopened = ChartModel.import(model.toJSON());
	assert.equal(reopened.addChannel().id, oldChannel.id + 1);
	assert.equal(reopened.addEvent("tap", { channel: 0 }).id, oldEvent.id + 1);
	assert.equal(reopened.addSnappee("rectangularMesh").id, oldSnappee.id + 1);
});

test("ChartModel defaults and round-trips the out-of-bounds editor setting", () => {
	const model = ChartModel.createDefault();
	assert.equal(model.editor.allowOutOfBound, false);
	model.editor.allowOutOfBound = true;
	const reopened = ChartModel.import(model.toJSON());
	assert.equal(reopened.editor.allowOutOfBound, true);
	assert.equal(reopened.toJSON().sviber.editor.allowOutOfBound, true);
	assert.equal(Object.hasOwn(reopened.toJSON().sviber.editor, "allowOutOfBounds"), false);
});

test("ChartModel prefers embedded sviber state over top-level generated events", () => {
	const model = ChartModel.import({
		title: "Embedded state",
		events: [
			{
				type: "hold",
				time: 0,
				properties: { x: 99, y: 99, duration: 2 },
			},
		],
		sviber: {
			timing: { offset: 0, initialBpm: 120, bpmChanges: [] },
			channels: [{ id: 3 }],
			events: [{ id: 7, type: "tap", time: [2, 0, 1], channel: 3, x: 4, y: 5 }],
			snappees: [],
			nextIds: { channel: 4, event: 8, snappee: 0 },
		},
	});

	assert.equal(model.metadata.title, "Embedded state");
	assert.equal(model.events.length, 1);
	assert.equal(model.events[0].id, 7);
	assert.equal(model.events[0].type, "tap");
	assert.deepEqual(model.events[0].time, [2, 0, 1]);
});
