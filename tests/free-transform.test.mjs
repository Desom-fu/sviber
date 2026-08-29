import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readManual } from "./module-source.mjs";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { applyTransform, clampAffineToChartBounds, isPointWithinChartBounds } from "../js/core/geometry.js";
import { flickAngleChanges } from "../js/render/flick-angle.js";
import { withStageInteractions } from "../js/render/stage-interactions.js";

test("selected Flick handles preserve angle differences during multi-selection rotation", () => {
	const flicks = [
		{ id: 1, angle: 0.1 },
		{ id: 2, angle: 1.2 },
		{ id: 3, angle: -2.4 },
	];
	const changes = flickAngleChanges(flicks, 1, 0.1 + Math.PI / 2);
	assert.equal(changes.size, flicks.length);
	assert.ok(Math.abs(changes.get(1) - (0.1 + Math.PI / 2)) < 1e-12);
	assert.ok(Math.abs(changes.get(2) - changes.get(1) - (flicks[1].angle - flicks[0].angle)) < 1e-12);
	assert.ok(Math.abs(changes.get(3) - changes.get(1) - (flicks[2].angle - flicks[0].angle)) < 1e-12);
	const single = flickAngleChanges([{ id: 4, angle: 0.2 }], 4, 0.3);
	assert.equal(single.get(4), 0);
});

test("free transform follows v12 degenerate-box and modifier rules", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.exitModes = () => {};
	app.refresh = () => {};
	app.model = ChartModel.createDefault({ events: [{ id: 1, type: "tap", selected: true, x: 0, y: 0 }] });
	assert.equal(app.startFreeTransform(), false);
	app.model = ChartModel.createDefault({
		events: [
			{ id: 1, type: "tap", selected: true, x: 0, y: -10 },
			{ id: 2, type: "tap", selected: true, x: 0, y: 10 },
		],
	});
	assert.equal(app.startFreeTransform(), true);
	assert.deepEqual(app.freeTransform.bounds, { minX: -0.5, maxX: 0.5, minY: -10, maxY: 10 });
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({
		events: [
			{ id: 1, type: "tap", selected: true, x: -10, y: -10 },
			{ id: 2, type: "tap", selected: true, x: 10, y: 10 },
		],
	});
	assert.equal(app.startFreeTransform(), true);
	assert.deepEqual(app.freeTransform.anchor, { x: 0, y: 0 });
	const InteractionApp = withStageInteractions(class {});
	const interactions = new InteractionApp();
	interactions.callbacks = {
		getFreeTransform: () => ({
			bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
			matrix: [1, 0, 0, 1, 0, 0],
			anchor: { x: 0, y: 0 },
			anchorLocal: { x: 0, y: 0 },
			anchorFollows: true,
		}),
	};
	const rotate = interactions._freeTransformMatrix(
		{
			type: "free-rotate",
			startChart: { x: 10, y: 0 },
			bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
			matrix: [1, 0, 0, 1, 0, 0],
		},
		{ x: 0, y: 10 },
		{ ctrlKey: true },
	);
	assert.ok(Math.abs(rotate[0]) < 1e-10 && Math.abs(rotate[1] - 1) < 1e-10);
	const scale = interactions._freeTransformMatrix(
		{
			type: "free-scale",
			hit: { index: 0 },
			startLocal: { x: -10, y: 10 },
			bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
			matrix: [1, 0, 0, 1, 0, 0],
		},
		{ x: -20, y: 20 },
		{ ctrlKey: true },
	);
	assert.equal(scale[0], 1.5);
	assert.equal(scale[3], 1.5);
});

test("free transform recursively includes attached descendants of a selected group", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.refresh = () => {};
	app.exitModes = () => {};
	app.model = ChartModel.createDefault({
		snappees: [
			{
				id: 0,
				type: "rectangularMesh",
				name: "Attached group mesh",
				color: "#00e0ad",
				transformation: [1, 0, 0, 1, 0, 0],
				active: true,
				topLeftX: -20,
				topLeftY: 20,
				bottomRightX: 20,
				bottomRightY: -20,
				horizontalTiles: 2,
				verticalTiles: 2,
			},
		],
		events: [
			{
				id: 10,
				type: "group",
				channel: 0,
				time: [0, 0, 1],
				x: 0,
				y: 0,
				selected: true,
				events: [
					{ id: 11, type: "tap", channel: 0, time: [0, 0, 1], attached: true, snappee: 0, snapPoint: [0, 0] },
					{ id: 12, type: "tap", channel: 0, time: [1, 0, 1], x: 10, y: -10 },
				],
			},
		],
	});
	assert.deepEqual([...app.attachedSnappeeIds()], [0]);
	assert.equal(app.transformationAvailable(), true);
	assert.equal(app.startFreeTransform(), true);
	const before = app.model.snappees[0].transformation;
	assert.equal(app._applyTransformMutation(app.model, [1, 0, 0, 1, 5, 7]), true);
	assert.deepEqual(app.model.snappees[0].transformation, [1, 0, 0, 1, 5, 7]);
	assert.equal(app.model.findEvent(10).x, 5);
	assert.equal(app.model.findEvent(10).y, 7);
	assert.deepEqual(app.model.findEvent(11).snapPoint, [0, 0]);
	assert.equal(app.model.findEvent(12).x, 15);
	assert.equal(app.model.findEvent(12).y, -3);
	assert.notDeepEqual(app.model.snappees[0].transformation, before);
});

test("line-shaped note selections and groups can free-transform while a single note stays blocked", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.refresh = () => {};
	app.exitModes = () => {};
	app.commit = (_label, mutation) => mutation(app.model);
	app.model = ChartModel.createDefault({
		events: [
			{
				id: 10,
				type: "group",
				channel: 0,
				time: [0, 0, 1],
				x: 0,
				y: 0,
				selected: true,
				events: [
					{ id: 11, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: -20 },
					{ id: 12, type: "tap", channel: 0, time: [1, 0, 1], x: 0, y: 20 },
				],
			},
		],
	});
	assert.equal(app.startFreeTransform(), true);
	assert.deepEqual(app.freeTransform.bounds, { minX: -0.5, maxX: 0.5, minY: -20, maxY: 20 });
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({
		events: [
			{ id: 20, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: -20, selected: true },
			{ id: 21, type: "tap", channel: 0, time: [1, 0, 1], x: 0, y: 20, selected: true },
		],
	});
	assert.equal(app.startFreeTransform(), true);
	assert.deepEqual(app.freeTransform.bounds, { minX: -0.5, maxX: 0.5, minY: -20, maxY: 20 });
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({
		events: [{ id: 30, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true }],
	});
	assert.equal(app.startFreeTransform(), false);
});

test("detached collinear notes can still free-transform", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.refresh = () => {};
	app.exitModes = () => {};
	app.commit = (_label, mutation) => mutation(app.model);
	app.model = ChartModel.createDefault({
		snappees: [
			{
				id: 0,
				type: "rectangularMesh",
				name: "Playfield",
				color: "#00e0ad",
				transformation: [1, 0, 0, 1, 0, 0],
				active: true,
				topLeftX: -20,
				topLeftY: 20,
				bottomRightX: 20,
				bottomRightY: -20,
				horizontalTiles: 4,
				verticalTiles: 2,
			},
		],
		events: [
			{
				id: 1,
				type: "tap",
				selected: true,
				attached: true,
				snappee: 0,
				snapPoint: [0, 0],
				channel: 0,
				time: [0, 0, 1],
			},
			{
				id: 2,
				type: "tap",
				selected: true,
				attached: true,
				snappee: 0,
				snapPoint: [1, 0],
				channel: 0,
				time: [1, 0, 1],
			},
			{
				id: 3,
				type: "tap",
				selected: true,
				attached: true,
				snappee: 0,
				snapPoint: [2, 0],
				channel: 0,
				time: [2, 0, 1],
			},
			{
				id: 4,
				type: "tap",
				selected: true,
				attached: true,
				snappee: 0,
				snapPoint: [3, 0],
				channel: 0,
				time: [3, 0, 1],
			},
		],
	});
	assert.equal(app.startFreeTransform(), true);
	app.cancelFreeTransform();
	app.detachSelected();
	for (const event of app.model.allEvents()) {
		assert.equal(event.attached, false);
		assert.equal(event.y, 20);
	}
	assert.equal(new Set(app.model.allEvents().map(event => event.x)).size, 4);
	assert.equal(app.startFreeTransform(), true);
	assert.equal(app.freeTransform.bounds.minY, 19.5);
	assert.equal(app.freeTransform.bounds.maxY, 20.5);
});

test("free transform translate and scale clamp to the chart boundary", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.exitModes = () => {};
	app.refresh = () => {};
	app.refreshInteractionPreview = () => {};
	app.model = ChartModel.createDefault({
		events: [
			{ id: 1, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 90, y: 0 },
			{ id: 2, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 80, y: 10 },
		],
	});
	assert.equal(app.startFreeTransform(), true);
	assert.equal(app.previewFreeTransform([1, 0, 0, 1, 50, 0]), true);
	assert.equal(app.model.findEvent(1).x, 100);
	assert.equal(app.model.findEvent(2).x, 90);
	assert.deepEqual(app.freeTransform.matrix, [1, 0, 0, 1, 10, 0]);
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({
		events: [
			{ id: 1, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: -10, y: -10 },
			{ id: 2, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 10, y: 10 },
		],
	});
	assert.equal(app.startFreeTransform(), true);
	assert.equal(app.previewFreeTransform([20, 0, 0, 20, 0, 0]), true);
	assert.ok(Math.abs(app.model.findEvent(2).y - 50) < 1e-9);
	assert.ok(Math.abs(app.model.findEvent(2).x - 50) < 1e-9);
	assert.ok(Math.abs(app.freeTransform.matrix[0] - 5) < 1e-9);
	assert.ok(Math.abs(app.freeTransform.matrix[3] - 5) < 1e-9);
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({
		events: [
			{ id: 1, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 90, y: 10 },
			{ id: 2, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 70, y: -10 },
		],
	});
	assert.equal(app.startFreeTransform(), true);
	assert.equal(app.previewFreeTransform([0, 1, -1, 0, 0, 0]), true);
	assert.equal(isPointWithinChartBounds(app.model.findEvent(1)), true);
	assert.equal(isPointWithinChartBounds(app.model.findEvent(2)), true);
});

test("clamps free-transform translate/scale and keeps inspector Enter from finishing", async () => {
	const [shortcuts, transform, geometry, panels, manual] = await Promise.all([
		readFile(new URL("../js/app/app-global-shortcuts.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-free-transform.js", import.meta.url), "utf8"),
		readFile(new URL("../js/core/geometry.js", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/panels.js", import.meta.url), "utf8"),
		readManual(),
	]);
	assert.match(geometry, /export function clampAffineToChartBounds/);
	// The clamp call and its anchor points may be spelled across statements after the
	// lint-driven refactor, so both halves are asserted independently of formatting.
	assert.match(transform, /clampAffineToChartBounds\(/);
	assert.match(transform, /_freeTransformAnchorPoints\(this\.model\)/);
	assert.match(shortcuts, /isEditableTarget\(event\.target\)/);
	assert.match(panels, /onTransformChange\(index, next\)/);
	assert.match(manual, /submits that element/);
	assert.match(manual, /只提交该矩阵元素/);
});

test("free-transform rotation clamps a point onto the chart rectangle", () => {
	const matrix = clampAffineToChartBounds([{ x: 90, y: 0 }], [0, 1, -1, 0, 0, 0], [1, 0, 0, 1, 0, 0]);
	const point = applyTransform({ x: 90, y: 0 }, matrix);
	assert.equal(isPointWithinChartBounds(point), true);
	assert.ok(
		Math.abs(point.x - 100) < 1e-6 ||
			Math.abs(point.x + 100) < 1e-6 ||
			Math.abs(point.y - 50) < 1e-6 ||
			Math.abs(point.y + 50) < 1e-6,
		`rotated point ${JSON.stringify(point)} should land on a boundary`,
	);
});
