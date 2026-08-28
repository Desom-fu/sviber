import assert from "node:assert/strict";
import test from "node:test";
import { rationalGcd } from "../js/app/app-attachment.js";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";

function attachTimeIndices(times) {
	const values = times.map(time => Rational.from(time));
	const origin = values[0];
	let step = new Rational(0, 1);
	for (const time of values) {
		step = rationalGcd(step, time.sub(origin));
	}
	return values.map(time => {
		if (step.numerator === 0n) {
			return 0;
		}
		return Math.round(time.sub(origin).div(step).toNumber());
	});
}

test("rationalGcd drives attach-by-time indices", () => {
	const half = new Rational(1, 2);
	const third = new Rational(1, 3);
	const gcd = rationalGcd(half, third);
	assert.equal(gcd.numerator, 1n);
	assert.equal(gcd.denominator, 6n);
	assert.equal(rationalGcd(new Rational(0, 1), half).toNumber(), 0.5);
	assert.deepEqual(attachTimeIndices([[0, 0, 1], [0, 1, 2], [1, 0, 1]]), [0, 1, 2]);
	assert.deepEqual(attachTimeIndices([[1, 0, 1], [1, 0, 1]]), [0, 0]);
});

test("a single attached event can be dragged freely in v9", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [
			{
				id: 4,
				type: "rectangularMesh",
				name: "Mesh",
				active: true,
				transformation: [1, 0, 0, 1, 0, 0],
				topLeftX: -50,
				topLeftY: 25,
				bottomRightX: 50,
				bottomRightY: -25,
				horizontalTiles: 2,
				verticalTiles: 2,
			},
		],
		events: [
			{
				id: 8,
				type: "tap",
				channel: 0,
				time: [0, 0, 1],
				selected: true,
				attached: true,
				snappee: 4,
				snapPoint: [0, 0],
			},
		],
	});
	const EditingApp = withEventEditing(class {});
	new EditingApp()._applyPositionMove(model, 8, { x: 25, y: 10 });
	assert.equal(model.events[0].attached, false);
	assert.deepEqual([model.events[0].x, model.events[0].y], [25, 10]);
});
