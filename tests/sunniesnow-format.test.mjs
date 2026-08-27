// Sunniesnow interchange behaviour: importing a chart back into the editor model and exporting
// tip-point guides, chains and attached coordinates the way the game expects them.
import test from "node:test";
import assert from "node:assert/strict";

import { ChartModel, connectSelectedTipPointChain } from "../js/core/chart-model.js";
import { assertClose } from "./assert-close.mjs";

test("Sunniesnow import rebuilds guide modes, BPM-spanning holds, and warnings", () => {
	const model = ChartModel.import(
		{
			title: "Imported",
			events: [
				{ type: "placeholder", time: -0.5, properties: { x: -20, y: 30, tipPoint: "guide-a" } },
				{ type: "tap", time: 0, properties: { x: 1, y: 2, tipPoint: "guide-a" } },
				{ type: "hold", time: 0.5, properties: { x: 3, y: 4, duration: 1.5, tipPoint: "guide-a" } },
				{ type: "image", time: 0.25, properties: { filename: "story.png", duration: 1 } },
				{ type: "flick", time: 3, properties: { x: 5, y: 6, angle: [0.25, 1.5] } },
			],
		},
		{
			offset: 0,
			initialBpm: 120,
			bpmChanges: [{ time: [2, 0, 1], bpm: 60 }],
		},
	);

	assert.deepEqual(
		model.events.map(({ type }) => type),
		["tap", "hold", "flick"],
	);
	const [tap, hold, flick] = model.events;
	assert.equal(tap.tipPointSpawnType, "chain");
	assert.equal(hold.tipPointSpawnType, "inherit");
	assert.equal(tap.tipPointSpawnAbsolutePosition, false);
	assert.equal(tap.tipPointSpawnDistance, 35);
	assert.ok(Math.abs(tap.tipPointSpawnAngle - Math.atan2(28, -21)) < 1e-12);
	assert.equal(tap.tipPointSpawnTime, 0.5);
	assert.deepEqual(hold.duration, [2, 0, 1]);
	assert.equal(flick.angle, 0.25);
	assert.ok(model.importWarnings.some(warning => warning.includes("unsupported event type image")));
	assert.ok(model.importWarnings.some(warning => warning.includes("Only the first flick angle")));
});

test("tip-point export implements inherit, chain, drop, and none sequences", () => {
	const model = ChartModel.createDefault();
	const modes = ["inherit", "chain", "inherit", "inherit", "drop", "inherit", "inherit", "none", "inherit"];
	for (let index = 0; index < modes.length; index += 1) {
		model.addEvent("tap", {
			time: [index, 0, 1],
			x: index * 10,
			y: 0,
			tipPointSpawnType: modes[index],
		});
	}

	const exported = model.generateSunniesnowEvents();
	const notes = exported.filter(({ type }) => type === "tap");
	const placeholders = exported.filter(({ type }) => type === "placeholder");
	const guide = index => notes[index].properties.tipPoint;

	assert.equal(notes.length, modes.length);
	assert.equal(guide(0), undefined);
	assert.equal(guide(7), undefined);
	assert.equal(guide(8), undefined);
	assert.equal(guide(1), guide(2));
	assert.equal(guide(2), guide(3));
	assert.equal(typeof guide(1), "string");
	assert.equal(new Set([guide(4), guide(5), guide(6)]).size, 3);

	const noteGuideIds = new Set(notes.map(({ properties }) => properties.tipPoint).filter(Boolean));
	const placeholderGuideIds = new Set(placeholders.map(({ properties }) => properties.tipPoint));
	assert.equal(placeholders.length, 4);
	assert.equal(placeholderGuideIds.size, 4);
	assert.deepEqual(placeholderGuideIds, noteGuideIds);
	for (const placeholder of placeholders) {
		assert.ok(notes.some(({ properties }) => properties.tipPoint === placeholder.properties.tipPoint));
	}
});

test("batch chain connects every selected note once and stops before the next note", () => {
	const model = ChartModel.createDefault();
	for (let index = 0; index < 4; index += 1) {
		model.addEvent("tap", {
			time: [index, 0, 1],
			selected: index < 3,
			tipPointSpawnType: index < 3 ? "chain" : "inherit",
		});
	}

	const result = connectSelectedTipPointChain(model.events);
	assert.equal(result.ok, true);
	assert.deepEqual(
		model.events.map(event => event.tipPointSpawnType),
		["chain", "inherit", "inherit", "none"],
	);
	const notes = model.generateSunniesnowEvents().filter(event => event.type === "tap");
	assert.equal(notes[0].properties.tipPoint, notes[1].properties.tipPoint);
	assert.equal(notes[1].properties.tipPoint, notes[2].properties.tipPoint);
	assert.equal(notes[3].properties.tipPoint, undefined);
});

test("batch chain rejects gaps and cross-channel selections without mutation", () => {
	const model = ChartModel.createDefault();
	const first = model.addEvent("tap", { time: [0, 0, 1], selected: true, tipPointSpawnType: "drop" });
	model.addEvent("tap", { time: [1, 0, 1], selected: false, tipPointSpawnType: "none" });
	const third = model.addEvent("tap", { time: [2, 0, 1], selected: true, tipPointSpawnType: "drop" });
	const beforeGap = structuredClone(model.events);
	assert.deepEqual(connectSelectedTipPointChain(model.events), { ok: false, reason: "contiguous" });
	assert.deepEqual(model.events, beforeGap);

	const secondChannel = model.addChannel();
	third.channel = secondChannel.id;
	const beforeChannels = structuredClone(model.events);
	assert.deepEqual(connectSelectedTipPointChain(model.events), { ok: false, reason: "channel" });
	assert.deepEqual(model.events, beforeChannels);
	assert.equal(first.channel, model.channels[0].id);
});

test("attached notes and absolute attached tip spawns export transformed coordinates", () => {
	const model = ChartModel.createDefault();
	const snappee = model.addSnappee("rectangularMesh", {
		topLeftX: 0,
		topLeftY: 0,
		bottomRightX: 10,
		bottomRightY: 20,
		horizontalTiles: 1,
		verticalTiles: 1,
		transformation: [0, 1, -1, 0, 5, 6],
	});
	model.addEvent("tap", {
		time: [2, 0, 1],
		attached: true,
		snappee: snappee.id,
		snapPoint: [1, 0],
		tipPointSpawnType: "chain",
		tipPointSpawnAbsolutePosition: true,
		tipPointSpawnAttached: true,
		tipPointSpawnSnappee: snappee.id,
		tipPointSpawnSnapPoint: [0, 1],
		tipPointSpawnTimeBeats: true,
		tipPointSpawnTime: [1, 0, 1],
	});

	const exported = model.generateSunniesnowEvents();
	const note = exported.find(({ type }) => type === "tap");
	const placeholder = exported.find(({ type }) => type === "placeholder");
	assertClose(note.properties.x, 5);
	assertClose(note.properties.y, 16);
	assertClose(placeholder.properties.x, -15);
	assertClose(placeholder.properties.y, 6);
	assert.equal(placeholder.properties.tipPoint, note.properties.tipPoint);
});
