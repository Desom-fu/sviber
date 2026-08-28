import assert from "node:assert/strict";
import test from "node:test";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";

test("spatial transforms include selected tip-point cursor spawns", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		events: [
			{
				id: 1,
				type: "tap",
				channel: 0,
				time: [1, 0, 1],
				x: 25,
				y: 10,
				selected: true,
				tipPointSpawnType: "drop",
				tipPointSpawnAbsolutePosition: false,
				tipPointSpawnDistance: 40,
				tipPointSpawnAngle: 0,
			},
			{
				id: 2,
				type: "tap",
				channel: 0,
				time: [2, 0, 1],
				x: 30,
				y: -5,
				selected: false,
				tipPointSpawnType: "drop",
				tipPointSpawnAbsolutePosition: true,
				tipPointSpawnAttached: false,
				tipPointSpawnX: 70,
				tipPointSpawnY: 20,
			},
		],
	});
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	assert.equal(app._applyTransformMutation(model, [-1, 0, 0, 1, 0, 0]), true);
	assert.equal(model.events[0].x, -25);
	assert.ok(Math.abs(Math.abs(model.events[0].tipPointSpawnAngle) - Math.PI) < 1e-12);
	assert.equal(model.events[0].tipPointSpawnDistance, 40);
	assert.deepEqual(
		model.events
			.slice(1)
			.map(event => ({ x: event.x, y: event.y, spawnX: event.tipPointSpawnX, spawnY: event.tipPointSpawnY })),
		[{ x: 30, y: -5, spawnX: 70, spawnY: 20 }],
	);
	const placeholder = model.generateSunniesnowEvents().find(event => event.type === "placeholder");
	assert.ok(Math.abs(placeholder.properties.x + 65) < 1e-12);
	assert.ok(Math.abs(placeholder.properties.y - 10) < 1e-12);
});

test("absolute tip-point cursor spawns follow vertical and matrix transforms", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		events: [
			{
				id: 1,
				type: "flick",
				channel: 0,
				time: [1, 0, 1],
				x: 10,
				y: 5,
				selected: true,
				angle: Math.PI / 4,
				tipPointSpawnType: "chain",
				tipPointSpawnAbsolutePosition: true,
				tipPointSpawnAttached: false,
				tipPointSpawnX: 70,
				tipPointSpawnY: 20,
			},
		],
	});
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	assert.equal(app._applyTransformMutation(model, [1, 0, 0, -1, 0, 0]), true);
	assert.deepEqual(
		{
			x: model.events[0].x,
			y: model.events[0].y,
			spawnX: model.events[0].tipPointSpawnX,
			spawnY: model.events[0].tipPointSpawnY,
		},
		{ x: 10, y: -5, spawnX: 70, spawnY: -20 },
	);
	assert.ok(Math.abs(model.events[0].angle + Math.PI / 4) < 1e-12);
	assert.equal(app._applyTransformMutation(model, [1, 0, 0, 1, 5, 7]), true);
	assert.deepEqual(
		{
			x: model.events[0].x,
			y: model.events[0].y,
			spawnX: model.events[0].tipPointSpawnX,
			spawnY: model.events[0].tipPointSpawnY,
		},
		{ x: 15, y: 2, spawnX: 75, spawnY: -13 },
	);
});

test("attached tip-point cursor spawns preserve unrelated snappees", () => {
	const mesh = {
		id: 8,
		type: "rectangularMesh",
		name: "Guide",
		color: "#00e0ad",
		active: true,
		selected: false,
		transformation: [1, 0, 0, 1, 0, 0],
		topLeftX: -50,
		topLeftY: 20,
		bottomRightX: 50,
		bottomRightY: -20,
		horizontalTiles: 2,
		verticalTiles: 2,
	};
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [mesh],
		events: [
			{
				id: 1,
				type: "tap",
				channel: 0,
				time: [1, 0, 1],
				x: 10,
				y: 5,
				selected: true,
				tipPointSpawnType: "drop",
				tipPointSpawnAbsolutePosition: true,
				tipPointSpawnAttached: true,
				tipPointSpawnSnappee: 8,
				tipPointSpawnSnapPoint: [2, 0],
			},
		],
	});
	const EditingApp = withEventEditing(class {});
	assert.equal(new EditingApp()._applyTransformMutation(model, [-1, 0, 0, 1, 0, 0]), true);
	assert.deepEqual(model.snappees[0].transformation, [1, 0, 0, 1, 0, 0]);
	assert.equal(model.events[0].tipPointSpawnAttached, false);
	assert.deepEqual([model.events[0].tipPointSpawnX, model.events[0].tipPointSpawnY], [-50, 20]);
	assert.equal("tipPointSpawnSnappee" in model.events[0], false);
});

test("tip-point cursors retain attachment when their note moves the same snappee", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [
			{
				id: 8,
				type: "rectangularMesh",
				name: "Guide",
				color: "#00e0ad",
				active: true,
				selected: false,
				transformation: [1, 0, 0, 1, 0, 0],
				topLeftX: -50,
				topLeftY: 20,
				bottomRightX: 50,
				bottomRightY: -20,
				horizontalTiles: 2,
				verticalTiles: 2,
			},
		],
		events: [
			{
				id: 1,
				type: "tap",
				channel: 0,
				time: [1, 0, 1],
				selected: true,
				attached: true,
				snappee: 8,
				snapPoint: [2, 0],
				tipPointSpawnType: "drop",
				tipPointSpawnAbsolutePosition: true,
				tipPointSpawnAttached: true,
				tipPointSpawnSnappee: 8,
				tipPointSpawnSnapPoint: [0, 0],
			},
		],
	});
	const EditingApp = withEventEditing(class {});
	assert.equal(new EditingApp()._applyTransformMutation(model, [-1, 0, 0, 1, 0, 0]), true);
	assert.deepEqual(model.snappees[0].transformation, [-1, 0, 0, 1, 0, 0]);
	assert.equal(model.events[0].tipPointSpawnAttached, true);
	assert.equal(model.events[0].tipPointSpawnSnappee, 8);
});
