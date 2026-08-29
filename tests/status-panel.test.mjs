import assert from "node:assert/strict";
import test from "node:test";
import { formatTime, formatBeat } from "../js/app/app-helpers.js";
import { Rational } from "../js/core/rational.js";

test("Status panel formatTime produces M:SS.mmm with leading zero and sign", () => {
	assert.equal(formatTime(67.814), "1:07.814");
	assert.equal(formatTime(0), "0:00.000");
	assert.equal(formatTime(3.5), "0:03.500");
	assert.equal(formatTime(125.001), "2:05.001");
	assert.equal(formatTime(-67.814), "-1:07.814");
	assert.equal(formatTime(-0.125), "-0:00.125");
});

test("Status panel formatBeat maintains unreduced subdivision denominator", () => {
	// 121 + 0/4 for beat 121 with subdivision 4
	assert.equal(formatBeat(121, 4), "121+0/4");
	// 121 + 2/4 for beat 121.5 with subdivision 4 (not simplified to 1/2)
	assert.equal(formatBeat(121.5, 4), "121+2/4");
	// Subdivision 8: 121.5 -> 121+4/8
	assert.equal(formatBeat(121.5, 8), "121+4/8");
	// Subdivision 3: 5 + 1/3
	assert.equal(formatBeat(new Rational(16, 3), 3), "5+1/3");
});

test("Status panel speed formatting strips trailing zeros and points", () => {
	const formatSpeed = value => Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
	assert.equal(formatSpeed(0.5), "0.5");
	assert.equal(formatSpeed(1), "1");
	assert.equal(formatSpeed(0.25), "0.25");
	assert.equal(formatSpeed(0.1), "0.1");
	assert.equal(formatSpeed(1.5), "1.5");
});
