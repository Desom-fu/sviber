// Geometry behaviour: the chart boundary, snappee sampling and snapping, pen node conversion,
// and the transforms that attachment resolution depends on.
import test from "node:test";
import assert from "node:assert/strict";
import * as math from "mathjs";

import {
	CHART_BOUNDS,
	SNAPPEE_TYPES,
	applyTransform,
	clampAffineToChartBounds,
	clampPointToChartBounds,
	findNearestSnapPoint,
	isPointWithinChartBounds,
	penCommandsFromNodes,
	resolveAttachedPosition,
	sampleSnappee,
	sampleSnappeePath,
	snapSnappeeTranslation,
} from "../js/core/geometry.js";
import { createSnappee } from "../js/core/chart-model.js";
import { assertClose } from "./assert-close.mjs";

globalThis.math = math;

test("chart-boundary helpers use the editor's documented note area", () => {
	assert.deepEqual(CHART_BOUNDS, { minX: -100, maxX: 100, minY: -50, maxY: 50 });
	assert.equal(isPointWithinChartBounds({ x: -100, y: 50 }), true);
	assert.equal(isPointWithinChartBounds({ x: 100, y: -50 }), true);
	assert.equal(isPointWithinChartBounds({ x: 100.001, y: 0 }), false);
	assert.equal(isPointWithinChartBounds({ x: 0, y: -50.001 }), false);
	assert.deepEqual(clampPointToChartBounds({ x: 125, y: -75 }), { x: 100, y: -50 });
	const points = [
		{ x: 90, y: 0 },
		{ x: 80, y: 10 },
	];
	const translated = clampAffineToChartBounds(points, [1, 0, 0, 1, 50, 0], [1, 0, 0, 1, 0, 0]);
	assert.deepEqual(translated, [1, 0, 0, 1, 10, 0]);
	const scaled = clampAffineToChartBounds(
		[
			{ x: -10, y: -10 },
			{ x: 10, y: 10 },
		],
		[20, 0, 0, 20, 0, 0],
		[1, 0, 0, 1, 0, 0],
	);
	assert.ok(Math.abs(scaled[0] - 5) < 1e-12);
	assert.ok(Math.abs(scaled[3] - 5) < 1e-12);
	const scaledPoint = applyTransform({ x: 10, y: 10 }, scaled);
	assert.ok(Math.abs(scaledPoint.x - 50) < 1e-12);
	assert.ok(Math.abs(scaledPoint.y - 50) < 1e-12);
	const rotated = clampAffineToChartBounds([{ x: 90, y: 0 }], [0, 1, -1, 0, 0, 0], [1, 0, 0, 1, 0, 0]);
	const rotatedPoint = applyTransform({ x: 90, y: 0 }, rotated);
	assert.ok(isPointWithinChartBounds(rotatedPoint));
	assert.ok(
		Math.abs(rotatedPoint.x - 50) < 1e-6 ||
			Math.abs(rotatedPoint.y - 50) < 1e-6 ||
			Math.abs(rotatedPoint.x + 100) < 1e-6 ||
			Math.abs(rotatedPoint.y + 50) < 1e-6,
	);
	assert.notDeepEqual(rotated, [0, 1, -1, 0, 0, 0]);
});

test("all default snappee types produce finite sample points", () => {
	const expectedTypes = [
		"rectangularMesh",
		"radialMesh",
		"parametricMesh",
		"regularPolygonCurve",
		"bezierCurve",
		"circularArcCurve",
		"penCurve",
		"parametricCurve",
	];
	assert.deepEqual([...SNAPPEE_TYPES], expectedTypes);

	for (const type of expectedTypes) {
		const points = sampleSnappee(createSnappee(type));
		assert.ok(points.length > 0, `${type} should have sample points`);
		for (const point of points) {
			assert.ok(Number.isFinite(point.x), `${type} produced a non-finite x`);
			assert.ok(Number.isFinite(point.y), `${type} produced a non-finite y`);
			assert.ok(Number.isFinite(point.localX), `${type} produced a non-finite localX`);
			assert.ok(Number.isFinite(point.localY), `${type} produced a non-finite localY`);
		}
	}

	assert.equal(sampleSnappee(createSnappee("regularPolygonCurve")).length, 20);
});

test("chart-boundary snappee points use only the documented tiny tolerance", () => {
	const polygons = [
		createSnappee("regularPolygonCurve", {
			name: "Outer hexagon",
			centerX: 0,
			centerY: 0,
			radius: 100 / Math.sqrt(3),
			angle: 0,
			sides: 6,
			segmentsPerSide: 4,
		}),
	];
	assert.ok(
		polygons.some(snappee =>
			sampleSnappee(snappee).some(
				point =>
					point.x < CHART_BOUNDS.minX ||
					point.x > CHART_BOUNDS.maxX ||
					point.y < CHART_BOUNDS.minY ||
					point.y > CHART_BOUNDS.maxY,
			),
		),
	);
	for (const snappee of polygons) {
		for (const point of sampleSnappee(snappee)) {
			const nearest = findNearestSnapPoint(point, [snappee], {
				activeOnly: false,
				bounds: CHART_BOUNDS,
				maxDistance: 1e-6,
			});
			assert.ok(nearest, `${snappee.name} point ${JSON.stringify(point.snapPoint)} should remain attachable`);
			assert.deepEqual(nearest.snapPoint, point.snapPoint);
		}
	}
	assert.equal(isPointWithinChartBounds({ x: 0, y: CHART_BOUNDS.maxY + 1e-10 }), false);
});

test("pen nodes preserve straight segments, dragged Bezier handles, and curved closure", () => {
	const nodes = [
		{ x: 0, y: 0, incoming: { x: -2, y: 0 }, outgoing: { x: 2, y: 0 } },
		{ x: 10, y: 10, incoming: { x: 8, y: 10 }, outgoing: null },
		{ x: 20, y: 0, incoming: null, outgoing: { x: 22, y: 0 } },
	];
	assert.deepEqual(penCommandsFromNodes(nodes, true), [
		{ type: "M", x: 0, y: 0 },
		{ type: "C", x1: 2, y1: 0, x2: 8, y2: 10, x: 10, y: 10 },
		{ type: "L", x: 20, y: 0 },
		{ type: "C", x1: 22, y1: 0, x2: -2, y2: 0, x: 0, y: 0 },
	]);
	const sampled = sampleSnappee({
		type: "penCurve",
		commands: penCommandsFromNodes(nodes, true),
		segments: 12,
		closed: true,
		transformation: [1, 0, 0, 1, 0, 0],
	});
	assert.equal(sampled.length, 12);
	assert.ok(sampled.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("open pen segment count uses one more vertex and whole-curve movement snaps to a mesh", () => {
	const mesh = createSnappee("rectangularMesh", {
		id: 1,
		topLeftX: 0,
		topLeftY: 0,
		bottomRightX: 20,
		bottomRightY: 20,
		horizontalTiles: 1,
		verticalTiles: 1,
	});
	const pen = createSnappee("penCurve", {
		id: 2,
		commands: [
			{ type: "M", x: -10, y: -1 },
			{ type: "L", x: 20, y: -1 },
		],
		segments: 3,
		closed: false,
	});
	assert.equal(sampleSnappee(pen).length, 4);
	assert.deepEqual(
		snapSnappeeTranslation(pen, { x: 9.25, y: 0.5 }, [mesh, pen], {
			activeOnly: true,
			maxDistance: 2,
		}),
		{ x: 10, y: 1 },
	);
	assert.deepEqual(
		snapSnappeeTranslation(pen, { x: 4, y: 4 }, [mesh, pen], {
			activeOnly: true,
			maxDistance: 0.1,
		}),
		{ x: 4, y: 4 },
	);
});

test("Bezier and pen display paths retain smooth points between snap points", () => {
	const bezier = createSnappee("bezierCurve", {
		controlPoints: [
			{ x: 0, y: 0 },
			{ x: 50, y: 100 },
			{ x: 100, y: 0 },
		],
		segments: 2,
	});
	const pen = createSnappee("penCurve", {
		commands: [
			{ type: "M", x: 0, y: 0 },
			{ type: "C", x1: 25, y1: 100, x2: 75, y2: -100, x: 100, y: 0 },
		],
		segments: 2,
	});
	assert.ok(sampleSnappeePath(bezier).length > sampleSnappee(bezier).length * 20);
	assert.ok(sampleSnappeePath(pen).length > sampleSnappee(pen).length * 10);
});

test("geometry transforms, nearest-point lookup, and attachment resolution agree", () => {
	assert.deepEqual(applyTransform({ x: 0, y: 0 }, [0, 1, -1, 0, 5, 6]), { x: 5, y: 6 });

	const mesh = createSnappee("rectangularMesh", {
		id: 42,
		topLeftX: 0,
		topLeftY: 0,
		bottomRightX: 10,
		bottomRightY: 10,
		horizontalTiles: 1,
		verticalTiles: 1,
		transformation: [1, 0, 0, 1, 5, -2],
	});
	const nearest = findNearestSnapPoint({ x: 14.8, y: 8.1 }, [mesh]);
	assert.equal(nearest.snappeeId, 42);
	assert.deepEqual(nearest.snapPoint, [1, 1]);
	assertClose(nearest.x, 15);
	assertClose(nearest.y, 8);

	const attached = resolveAttachedPosition(
		{
			attached: true,
			snappee: 42,
			snapPoint: [0, 1],
		},
		[mesh],
	);
	assert.equal(attached.attached, true);
	assertClose(attached.x, 5);
	assertClose(attached.y, 8);

	assert.deepEqual(resolveAttachedPosition({ attached: false, x: 3, y: 4 }, [mesh]), { x: 3, y: 4, attached: false });
});
