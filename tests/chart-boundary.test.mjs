import assert from "node:assert/strict";
import test from "node:test";
import {
	CHART_BOUNDS,
	clampPointToChartBounds,
	isPointWithinChartBounds,
} from "../js/core/geometry.js";
import {
	allowsOutOfBounds,
	pointAllowed,
} from "../js/app/app-helpers.js";

test("Chart bounds match the documented (-100, 50) to (100, -50) rectangle", () => {
	assert.equal(CHART_BOUNDS.minX, -100);
	assert.equal(CHART_BOUNDS.maxX, 100);
	assert.equal(CHART_BOUNDS.minY, -50);
	assert.equal(CHART_BOUNDS.maxY, 50);
});

test("isPointWithinChartBounds checks whether a coordinate is inside the boundary", () => {
	assert.equal(isPointWithinChartBounds({ x: 0, y: 0 }), true);
	assert.equal(isPointWithinChartBounds({ x: -100, y: 50 }), true);
	assert.equal(isPointWithinChartBounds({ x: 100, y: -50 }), true);
	assert.equal(isPointWithinChartBounds({ x: -101, y: 0 }), false);
	assert.equal(isPointWithinChartBounds({ x: 0, y: 51 }), false);
	assert.equal(isPointWithinChartBounds({ x: 105, y: -55 }), false);
});

test("clampPointToChartBounds clamps out-of-boundary points to the edges", () => {
	assert.deepEqual(clampPointToChartBounds({ x: -120, y: 70 }), { x: -100, y: 50 });
	assert.deepEqual(clampPointToChartBounds({ x: 150, y: -80 }), { x: 100, y: -50 });
	assert.deepEqual(clampPointToChartBounds({ x: 20, y: -10 }), { x: 20, y: -10 });
});

test("allowsOutOfBounds and pointAllowed honor the editor preference", () => {
	const normalModel = { editor: { allowOutOfBound: false } };
	const outOfBoundsModel = { editor: { allowOutOfBound: true } };

	assert.equal(allowsOutOfBounds(normalModel), false);
	assert.equal(allowsOutOfBounds(outOfBoundsModel), true);

	assert.equal(pointAllowed(normalModel, { x: 120, y: 0 }), false);
	assert.equal(pointAllowed(outOfBoundsModel, { x: 120, y: 0 }), true);
});
