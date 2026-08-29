import assert from "node:assert/strict";
import test from "node:test";
import { BEAT_LINE_COLORS, beatColor, beatDenominator, relativeBeatColor } from "../js/render/timeline-helpers.js";

test("Beat lines color table matches PROMPT specifications", () => {
	assert.equal(BEAT_LINE_COLORS[1], "#ff2e59"); // red
	assert.equal(BEAT_LINE_COLORS[2], "#3086ff"); // blue
	assert.equal(BEAT_LINE_COLORS[3], "#50a226"); // green
	assert.equal(BEAT_LINE_COLORS[4], "#ff9d3d"); // yellow
	assert.equal(BEAT_LINE_COLORS[8], "#d567ff"); // purple
	assert.equal(BEAT_LINE_COLORS.other, "#00e0ad"); // cyan
});

test("beatDenominator simplifies rational subdivisions to lowest terms denominator", () => {
	// Step 0 on subdivision 4 -> 4 / gcd(0, 4) = 4 / 4 = 1 (whole beat)
	assert.equal(beatDenominator(0, 4), 1);
	// Step 2 on subdivision 4 (2/4 = 1/2) -> denominator 2
	assert.equal(beatDenominator(2, 4), 2);
	// Step 1 on subdivision 4 (1/4) -> denominator 4
	assert.equal(beatDenominator(1, 4), 4);
	// Step 3 on subdivision 4 (3/4) -> denominator 4
	assert.equal(beatDenominator(3, 4), 4);
	// Step 1 on subdivision 3 (1/3) -> denominator 3
	assert.equal(beatDenominator(1, 3), 3);
	// Step 2 on subdivision 3 (2/3) -> denominator 3
	assert.equal(beatDenominator(2, 3), 3);
	// Step 1 on subdivision 8 (1/8) -> denominator 8
	assert.equal(beatDenominator(1, 8), 8);
	// Step 1 on subdivision 6 (1/6) -> denominator 6 -> mapped to 'other' color
	assert.equal(beatDenominator(1, 6), 6);
});

test("beatColor maps step and subdivision to the documented colors", () => {
	assert.equal(beatColor(0, 4), "#ff2e59"); // 0/4 -> whole beat (red)
	assert.equal(beatColor(2, 4), "#3086ff"); // 2/4 = 1/2 beat (blue)
	assert.equal(beatColor(1, 3), "#50a226"); // 1/3 beat (green)
	assert.equal(beatColor(1, 4), "#ff9d3d"); // 1/4 beat (yellow)
	assert.equal(beatColor(1, 8), "#d567ff"); // 1/8 beat (purple)
	assert.equal(beatColor(1, 6), "#00e0ad"); // 1/6 beat (cyan, other)
	assert.equal(beatColor(1, 5), "#00e0ad"); // 1/5 beat (cyan, other)
	assert.equal(beatColor(1, 7), "#00e0ad"); // 1/7 beat (cyan, other)
});

test("relativeBeatColor accurately colors relative rational positions", () => {
	assert.equal(relativeBeatColor({ denominator: 1 }), "#ff2e59");
	assert.equal(relativeBeatColor({ denominator: 2 }), "#3086ff");
	assert.equal(relativeBeatColor({ denominator: 3 }), "#50a226");
	assert.equal(relativeBeatColor({ denominator: 4 }), "#ff9d3d");
	assert.equal(relativeBeatColor({ denominator: 8 }), "#d567ff");
	assert.equal(relativeBeatColor({ denominator: 12 }), "#00e0ad");
});
