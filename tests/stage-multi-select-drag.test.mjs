import assert from "node:assert/strict";
import test from "node:test";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { CHART_BOUNDS, findNearestSnapPoint } from "../js/core/geometry.js";
import { withStageInteractions } from "../js/render/stage-interactions.js";

test("multi-note stage drags stay detached when the grab lands on a grid snap", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.model = ChartModel.createDefault({
		events: [
			{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true },
			{ id: 2, type: "tap", channel: 0, time: [1, 0, 1], x: 20, y: 0, selected: true },
		],
	});
	const snap = findNearestSnapPoint({ x: 12.5, y: 0 }, app.model.snappees, {
		activeOnly: true,
		maxDistance: 9,
		bounds: CHART_BOUNDS,
	});
	assert.ok(snap?.snappeeId != null, "playfield grid should snap near the origin");
	app._applyPositionMove(app.model, 1, snap);
	const primary = app.model.findEvent(1);
	const other = app.model.findEvent(2);
	assert.equal(primary.attached, false);
	assert.equal(other.attached, false);
	assert.equal(Number.isFinite(primary.x), true);
	assert.equal(Number.isFinite(other.x), true);
	const dx = Number(other.x) - Number(primary.x);
	assert.ok(Math.abs(dx - 20) < 1e-6, "the pair must keep its rigid spacing");
});

test("a throwing stage commit still clears the drag so the editor can be used", () => {
	const previousDocument = globalThis.document;
	globalThis.document = { addEventListener() {}, removeEventListener() {} };
	try {
		const InteractionApp = withStageInteractions(class {});
		const stage = new InteractionApp();
		let ended = false;
		stage.pointerMoved = true;
		stage.drag = { type: "event", hit: { event: { id: 1 } }, start: { x: 0, y: 0 } };
		stage.requestRender = () => {};
		stage._pointerContextFor = () => ({
			event: {},
			point: { x: 10, y: 10 },
			project: { editor: {}, snappees: [] },
			mapping: { scale: 1 },
			chart: { x: 10, y: 10 },
			drag: stage.drag,
		});
		stage._positionSnapTarget = () => ({ x: 10, y: 10 });
		stage.callbacks = {
			onMovePosition: () => {
				throw new Error("commit failed");
			},
			onEndPreview: () => {
				ended = true;
			},
		};
		assert.throws(() => stage._pointerUp({}), /commit failed/);
		assert.equal(stage.drag, null);
		assert.equal(ended, true);
	} finally {
		globalThis.document = previousDocument;
	}
});
