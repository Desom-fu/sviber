import assert from "node:assert/strict";
import test from "node:test";
import { withCurveDraft } from "../js/app/app-curve-draft.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";

// Transform > Fill curve with drag notes: with a curve selected in the snappees panel,
// one drag is created per snap point, the first at the current time, each next one one
// subdivision later, all attached to their snap point and selected.
function makeApp(model) {
	const App = withCurveDraft(
		class {
			commit(label, mutation) {
				return mutation(this.model);
			}
		},
	);
	const app = new App();
	app.model = model;
	app.currentBeat = () => Rational.from(model.editor.currentTime);
	return app;
}

test("fill curve with drag notes creates one attached drag per snap point", () => {
	const model = new ChartModel({
		editor: { currentTime: [5, 0, 1], subdivision: 2, currentChannel: 0 },
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [
			{
				id: 0,
				type: "bezierCurve",
				name: "curve",
				color: "#ff0000",
				active: true,
				selected: true,
				transformation: [1, 0, 0, 1, 0, 0],
				degree: 1,
				controlPoints: [
					{ x: -50, y: 25 },
					{ x: 50, y: -25 },
				],
				segments: 2,
			},
		],
		events: [{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true }],
	});
	const app = makeApp(model);
	app.fillSelectedCurve();
	const drags = model.events.filter(event => event.type === "drag");
	assert.equal(drags.length, 3);
	assert.deepEqual(drags.map(event => Rational.from(event.time).toNumber()), [5, 5.5, 6]);
	assert.ok(drags.every(event => event.attached && event.snappee === 0));
	assert.deepEqual(drags.map(event => event.snapPoint), [0, 1, 2]);
	assert.ok(drags.every(event => event.selected));
	// The previous selection is replaced by the created drags.
	assert.equal(model.events[0].selected, false);
});

test("fill curve does nothing without a selected curve", () => {
	const model = new ChartModel({
		editor: { currentTime: [0, 0, 1], subdivision: 2, currentChannel: 0 },
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [],
	});
	const app = makeApp(model);
	app.fillSelectedCurve();
	assert.equal(model.events.length, 0);
});
