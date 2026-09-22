import assert from "node:assert/strict";
import test from "node:test";

import { SUNNIESNOW_SKIN } from "../js/render/stage-helpers.js";
import { StagePatternsTrait } from "../js/render/stage-patterns.js";

// The pentagon pattern is drawn with its top vertex at (0, -2*unit), so its geometric
// centre sits at (0, -2*unit + radius) in canvas units — chart coordinates (0,
// 20*sqrt(5) - 50). The centre dot used to be drawn at the playfield origin instead
// (the hexagon's dot has always sat at its own centre).
function fakeContext() {
	const calls = { arcs: [] };
	return {
		calls,
		arc(x, y, radius) {
			calls.arcs.push({ x, y, radius });
		},
		beginPath() {},
		moveTo() {},
		lineTo() {},
		closePath() {},
		fill() {},
		stroke() {},
		save() {},
		restore() {},
		translate() {},
		scale() {},
	};
}

test("the pentagon centre dot sits at the pentagon's geometric centre", () => {
	const context = fakeContext();
	const trait = Object.create(StagePatternsTrait.prototype);
	trait._drawPattern(context, { type: "pentagon" }, { toScreen: () => ({ x: 0, y: 0 }), scale: 1 });
	const unit = SUNNIESNOW_SKIN.noteRadius * 2;
	const radius = (4 * unit) / (1 + Math.cos(Math.PI / 5));
	const expectedY = -2 * unit + radius;
	assert.equal(context.calls.arcs.length, 1, "exactly one centre dot is drawn");
	assert.equal(context.calls.arcs[0].x, 0);
	assert.ok(
		Math.abs(context.calls.arcs[0].y - expectedY) < 1e-9,
		`the dot is at the pentagon centre (${context.calls.arcs[0].y} vs ${expectedY})`,
	);
	// Canvas y grows downward; the playfield scale makes one chart unit equal one canvas
	// unit, so the chart-space position of the dot is exactly (0, 20*sqrt(5) - 50).
	const chartY = -expectedY;
	assert.ok(Math.abs(chartY - (20 * Math.sqrt(5) - 50)) < 1e-9);
});
