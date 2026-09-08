import assert from "node:assert/strict";
import test from "node:test";

import { quantizeBeat, quantizeEventTimes, QUANTIZE_TIE_MODES } from "../js/core/quantize.js";
import { Rational } from "../js/core/rational.js";

function beat(whole, numerator, denominator) {
	return [whole, numerator, denominator];
}

test("quantizeBeat rounds to the nearest subdivision", () => {
	assert.deepEqual(quantizeBeat(beat(1, 1, 16), 4), beat(1, 0, 1), "1+1/16 rounds to 1");
	assert.deepEqual(quantizeBeat(beat(1, 3, 16), 4), beat(1, 1, 4), "1+3/16 rounds to 1+1/4");
	assert.deepEqual(quantizeBeat(beat(2, 0, 1), 4), beat(2, 0, 1), "integers are already on the grid");
});

test("quantizeBeat honours the three tie-break modes", () => {
	// 1+1/8 with denominator 4 sits exactly halfway between 1 and 1+1/4.
	assert.deepEqual(quantizeBeat(beat(1, 1, 8), 4, "floor"), beat(1, 0, 1));
	assert.deepEqual(quantizeBeat(beat(1, 1, 8), 4, "ceil"), beat(1, 1, 4));
	// 1 + 1/8 with denominator 4: floor is 1 (even), ceil is 1+1/4 (odd) -> even picks 1.
	assert.deepEqual(quantizeBeat(beat(1, 1, 8), 4, "even"), beat(1, 0, 1));
	// 1 + 3/8 with denominator 4: floor is 1 (odd), ceil is 1+1/2 (even) -> even picks 1+1/2.
	assert.deepEqual(quantizeBeat(beat(1, 3, 8), 4, "even"), beat(1, 1, 2));
});

test("quantizeBeat works for negative values and rejects unknown tie modes", () => {
	// -1-1/8 is halfway between -1.25 and -1.
	assert.equal(Rational.from(quantizeBeat(beat(-1, -1, 8), 4, "floor")).toNumber(), -1.25);
	assert.equal(Rational.from(quantizeBeat(beat(-1, -1, 8), 4, "ceil")).toNumber(), -1);
	assert.throws(() => quantizeBeat(0, 4, "random"), TypeError);
	assert.deepEqual(QUANTIZE_TIE_MODES, ["floor", "ceil", "even"]);
});

test("quantizeEventTimes rounds times and end times of perdurant events", () => {
	const hold = { type: "hold", time: beat(1, 1, 8), duration: beat(0, 5, 8) };
	const changes = quantizeEventTimes(hold, 4, "ceil");
	// start 1+1/8 -> 1+1/4; end 1+6/8=1+3/4 stays; duration becomes 1/2.
	assert.deepEqual(changes.time, beat(1, 1, 4));
	assert.deepEqual(changes.duration, beat(0, 1, 2));

	const tap = { type: "tap", time: beat(3, 1, 7) };
	const tapChanges = quantizeEventTimes(tap, 4, "floor");
	// 3+1/7 = 3.1428... is nearer to 3.25 than to 3; floor only wins at exact ties.
	assert.deepEqual(tapChanges.time, beat(3, 1, 4));
	assert.equal("duration" in tapChanges, false, "non-perdurant events have no duration to round");
});

test("quantizeEventTimes keeps the end time at or after the start time", () => {
	const hold = { type: "hold", time: beat(1, 1, 8), duration: beat(0, 1, 8) };
	const changes = quantizeEventTimes(hold, 4, "ceil");
	const duration = Rational.from(changes.duration);
	assert.ok(duration.compare(0) >= 0);
});
