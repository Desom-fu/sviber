import assert from "node:assert/strict";
import test from "node:test";
import { withAttachment } from "../js/app/app-attachment.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";

// Snappee > Attach to curve by order / by time. By order walks the events in export
// order (time, then channel, then timeline stacking) assigning snap points 0, 1, 2...
// By time uses i = (t - t0) / gcd of the time offsets. Both attach to a selected curve,
// or to the only active curve when nothing is selected.
function makeApp(model) {
	const App = withAttachment(
		class {
			commit(label, mutation) {
				return mutation(this.model);
			}
		},
	);
	const app = new App();
	app.model = model;
	return app;
}

function curveModel(events, selected = true) {
	return new ChartModel({
		editor: { currentChannel: 0 },
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [
			{
				id: 3,
				type: "bezierCurve",
				name: "curve",
				color: "#ff0000",
				active: true,
				selected,
				transformation: [1, 0, 0, 1, 0, 0],
				degree: 1,
				controlPoints: [
					{ x: -50, y: 0 },
					{ x: 50, y: 0 },
				],
				segments: 8,
			},
		],
		events,
	});
}

test("attach to curve by order follows export order starting at snap point zero", () => {
	const model = curveModel([
		{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: -80, y: 0, selected: true },
		{ id: 2, type: "tap", channel: 0, time: [1, 1, 2], x: -60, y: 0, selected: true },
		{ id: 3, type: "tap", channel: 0, time: [3, 0, 1], x: -40, y: 0, selected: true },
		{ id: 4, type: "tap", channel: 0, time: [3, 0, 1], x: -40, y: 0, selected: true },
		{ id: 5, type: "tap", channel: 0, time: [4, 0, 1], x: -20, y: 0, selected: true },
	]);
	const app = makeApp(model);
	assert.ok(app.attachSelectedToCurveByOrder());
	const byId = new Map(model.events.map(event => [event.id, event]));
	assert.deepEqual(
		[1, 2, 3, 4, 5].map(id => byId.get(id).snapPoint),
		[0, 1, 2, 3, 4],
	);
	assert.ok(model.events.every(event => event.attached && event.snappee === 3));
});

test("attach to curve by time uses gcd-scaled indices", () => {
	const model = curveModel([
		{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: -80, y: 0, selected: true },
		{ id: 2, type: "tap", channel: 0, time: [1, 1, 2], x: -60, y: 0, selected: true },
		{ id: 3, type: "tap", channel: 0, time: [3, 0, 1], x: -40, y: 0, selected: true },
		{ id: 4, type: "tap", channel: 0, time: [4, 0, 1], x: -20, y: 0, selected: true },
	]);
	const app = makeApp(model);
	assert.ok(app.attachSelectedToCurveByTime());
	const byId = new Map(model.events.map(event => [event.id, event]));
	// Times 1, 1.5, 3, 4 with origin 1 and gcd 1/2 give indices 0, 1, 4, 6.
	assert.deepEqual(
		[1, 2, 3, 4].map(id => byId.get(id).snapPoint),
		[0, 1, 4, 6],
	);
});

test("attach to curve falls back to the only active curve without a selection", () => {
	const model = curveModel(
		[{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: -80, y: 0, selected: true }],
		false,
	);
	const app = makeApp(model);
	assert.ok(app.attachSelectedToCurveByOrder());
	assert.equal(model.events[0].snappee, 3);
	assert.equal(model.events[0].snapPoint, 0);
});

test("attach to curve clamps overflow onto the last snap point", () => {
	const model = curveModel(
		Array.from({ length: 11 }, (_, index) => ({
			id: index + 1,
			type: "tap",
			channel: 0,
			time: [0, index, 1],
			x: -80 + index * 10,
			y: 0,
			selected: true,
		})),
	);
	const app = makeApp(model);
	// Eleven events on a nine-segment curve clamp the overflow onto the last point.
	assert.ok(app.attachSelectedToCurveByOrder());
	const points = model.events.map(event => event.snapPoint);
	assert.deepEqual(points.slice(0, 9), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
	assert.ok(points.slice(9).every(point => point === 8));
});
