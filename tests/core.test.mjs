// Core numeric behaviour: exact rational tuples and the beat/second timing map they drive.
import test from "node:test";
import assert from "node:assert/strict";

import { Rational, add, compare, fromNumber, snap, sub } from "../js/core/rational.js";
import { TimingMap } from "../js/core/timing.js";
import { assertClose } from "./assert-close.mjs";

test("Rational canonicalizes mixed tuples and round-trips negative decimals", () => {
	assert.deepEqual(Rational.from([0, -3, 6]).toJSON(), [0, -1, 2]);
	assert.deepEqual(Rational.from([-2, 1, 2]).toJSON(), [-1, -1, 2]);

	const negativeDecimal = Rational.from("-1.5");
	assert.deepEqual(negativeDecimal.toJSON(), [-1, -1, 2]);
	assert.equal(Rational.from(negativeDecimal.toString()).toNumber(), -1.5);
	assert.equal(Rational.from(String(negativeDecimal.toNumber())).toNumber(), -1.5);
});

test("Rational arithmetic, comparison, and snapping remain exact", () => {
	assert.deepEqual(add([0, 1, 3], [0, 1, 6]).toJSON(), [0, 1, 2]);
	assert.deepEqual(sub([1, 0, 1], [0, 3, 4]).toJSON(), [0, 1, 4]);
	assert.equal(compare([0, -1, 2], [0, -2, 3]), 1);

	assert.deepEqual(snap([0, 1, 4], 2).toJSON(), [0, 1, 2]);
	assert.deepEqual(snap([0, -1, 4], 2).toJSON(), [0, -1, 2]);
	assert.deepEqual(snap([0, 1, 5], 2).toJSON(), [0, 0, 1]);
	assert.deepEqual(snap([0, -1, 5], 2).toJSON(), [0, 0, 1]);
});

test("Rational.fromNumber honors the maximum denominator", () => {
	const limited = fromNumber(Math.PI, 16);
	assert.ok(limited.denominator <= 16n);
	assert.deepEqual(limited.toJSON(), [3, 1, 7]);
});

function createTimingFixture() {
	return new TimingMap({
		offset: 0.25,
		initialBpm: 120,
		bpmChanges: [
			{ time: [-2, 0, 1], bpm: 60 },
			{ time: [2, 0, 1], bpm: 180 },
		],
	});
}

test("TimingMap round-trips beats on both sides of zero and BPM changes", () => {
	const timing = createTimingFixture();
	const beats = [
		[-4, 0, 1],
		[-3, 0, 1],
		[-2, 0, 1],
		[-1, 0, 1],
		[0, 0, 1],
		[0, 1, 2],
		[2, 0, 1],
		[3, 1, 2],
		[5, 0, 1],
	];

	assertClose(timing.beatToSeconds(-3), -2.25);
	assertClose(timing.beatToSeconds(-2), -1.75);
	assertClose(timing.beatToSeconds(0), 0.25);
	assertClose(timing.beatToSeconds(2), 2.25);
	assertClose(timing.beatToSeconds(4), 2.25 + 2 / 3);

	for (const beat of beats) {
		const seconds = timing.beatToSeconds(beat);
		assert.ok(
			timing.secondsToBeat(seconds).equals(beat),
			`failed beat/seconds round-trip for ${Rational.from(beat)}`,
		);
	}
});

test("TimingMap keeps the latter duplicate BPM change", () => {
	const timing = new TimingMap({
		initialBpm: 120,
		bpmChanges: [
			{ time: [1, 0, 1], bpm: 150 },
			{ time: [1, 0, 1], bpm: 90 },
		],
	});

	assert.equal(timing.bpmChanges.length, 1);
	assert.deepEqual(timing.bpmChanges[0].time.toJSON(), [1, 0, 1]);
	assert.equal(timing.bpmChanges[0].bpm, 90);
	assertClose(timing.beatToSeconds(2), 0.5 + 2 / 3);
});

test("TimingMap duration integration crosses negative and positive BPM regions", () => {
	const timing = createTimingFixture();
	assertClose(timing.durationToSeconds(-3, 7), 5.166666666666667);
});
