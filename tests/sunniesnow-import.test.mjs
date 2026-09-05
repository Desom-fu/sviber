import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";

test("Sunniesnow import filters incompatible chain members and allocates a free channel", () => {
	const model = ChartModel.import(
		{
			events: [
				{ type: "tap", time: 0, properties: { x: 0, y: 0 } },
				{ type: "placeholder", time: 1, properties: { x: -40, y: 20, tipPoint: "guide" } },
				{ type: "tap", time: 2, properties: { x: 0, y: 0, tipPoint: "guide" } },
				{ type: "bgNote", time: 3, properties: { x: 1, y: 1, tipPoint: "guide" } },
				{ type: "hold", time: 4, properties: { x: 20, y: 10, duration: 1, tipPoint: "guide" } },
				{ type: "image", time: 5, properties: { filename: "visual.png", tipPoint: "guide" } },
			],
		},
		{ offset: 0, initialBpm: 60 },
	);
	const notes = model.events.filter(
		event => event.tipPointSpawnType === "chain" || event.tipPointSpawnType === "inherit",
	);
	assert.equal(notes.length, 2);
	assert.equal(notes[0].tipPointSpawnType, "chain");
	assert.equal(notes[1].tipPointSpawnType, "inherit");
	assert.equal(notes[0].channel, notes[1].channel);
	assert.equal(notes[0].tipPointSpawnAbsolutePosition, false);
	assert.equal(notes[0].tipPointSpawnDistance, Math.hypot(-40, 20));
	assert.equal(notes[0].tipPointSpawnTime, 1);
	assert.ok(model.importWarnings.some(warning => warning.includes("unsupported event type image")));
	assert.equal(
		model.events.find(event => event.type === "tap" && event.channel === model.channels[0].id).tipPointSpawnType,
		"none",
	);
});

test("Sunniesnow import keeps overlapping tip-point chains on separate channels", () => {
	const model = ChartModel.import(
		{
			events: [
				{ type: "placeholder", time: 0, properties: { x: -20, y: 0, tipPoint: "first" } },
				{ type: "tap", time: 1, properties: { x: 0, y: 0, tipPoint: "first" } },
				{ type: "tap", time: 4, properties: { x: 20, y: 0, tipPoint: "first" } },
				{ type: "placeholder", time: 0.5, properties: { x: -20, y: 10, tipPoint: "second" } },
				{ type: "tap", time: 2, properties: { x: 0, y: 10, tipPoint: "second" } },
				{ type: "tap", time: 3, properties: { x: 20, y: 10, tipPoint: "second" } },
			],
		},
		{ offset: 0, initialBpm: 60 },
	);
	const chains = [0, 10].map(y =>
		model.events
			.filter(event => event.tipPointSpawnType === "chain" || event.tipPointSpawnType === "inherit")
			.filter(event => event.channel != null)
			.filter(event => event.y === y),
	);
	assert.equal(chains[0].length, 2);
	assert.equal(chains[1].length, 2);
	assert.notEqual(chains[0][0].channel, chains[1][0].channel);
});
