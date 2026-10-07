import assert from "node:assert/strict";
import test from "node:test";

import { createSnappee } from "../js/core/chart-model.js";
import { isSpecialSnapPoint, sampleSnappee, snappeeOutlineParts } from "../js/core/geometry.js";

test("a regular polygon outline is a closed ring plus a spoke to the first vertex", () => {
	const snappee = createSnappee("regularPolygonCurve", {
		centerX: 0,
		centerY: 0,
		radius: 40,
		angle: 0,
		sides: 4,
		segmentsPerSide: 1,
		transformation: [1, 0, 0, 1, 0, 0],
	});
	const points = sampleSnappee(snappee);
	const outline = snappeeOutlineParts(snappee, points);
	assert.equal(outline.curve.length, 4);
	assert.equal(outline.closed, true);
	assert.ok(outline.spoke);
	assert.equal(outline.spoke[0].snapPoint, -1);
	assert.equal(outline.spoke[1].snapPoint, 0);
	assert.ok(outline.curve.every(point => !isSpecialSnapPoint(point.snapPoint)));
	assert.ok(Math.hypot(outline.spoke[0].x, outline.spoke[0].y) < 1e-9);
	assert.equal(outline.spoke[1], outline.curve[0]);
	assert.notEqual(outline.curve.at(-1), outline.spoke[0]);
});

test("a closed circular arc outline is a complete ring plus a spoke to the first vertex", () => {
	const snappee = createSnappee("circularArcCurve", {
		centerX: 5,
		centerY: -3,
		radius: 20,
		beginningAngle: 0,
		closed: true,
		segments: 8,
		transformation: [1, 0, 0, 1, 0, 0],
	});
	const outline = snappeeOutlineParts(snappee, sampleSnappee(snappee));
	assert.equal(outline.curve.length, 8);
	assert.equal(outline.closed, true);
	assert.equal(outline.spoke[0].snapPoint, -1);
	assert.equal(outline.spoke[1].snapPoint, 0);
	assert.equal(outline.curve.at(-1).snapPoint, 7);
});

test("an open circular arc keeps the arc open and still draws one spoke to the start", () => {
	const snappee = createSnappee("circularArcCurve", {
		centerX: 0,
		centerY: 0,
		radius: 10,
		beginningAngle: 0,
		endAngle: Math.PI,
		closed: false,
		segments: 4,
		transformation: [1, 0, 0, 1, 0, 0],
	});
	const outline = snappeeOutlineParts(snappee, sampleSnappee(snappee));
	assert.equal(outline.curve.length, 5);
	assert.equal(outline.closed, false);
	assert.equal(outline.spoke[1].snapPoint, 0);
	assert.equal(outline.curve.at(-1).snapPoint, 4);
});
