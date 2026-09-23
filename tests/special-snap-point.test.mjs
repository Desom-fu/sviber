import assert from "node:assert/strict";
import test from "node:test";

import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { isSpecialSnapPoint, sampleSnappee, snappeeIndexSpec } from "../js/core/geometry.js";
import { readManual } from "./module-source.mjs";

function polygonModel() {
	const model = ChartModel.createDefault({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [],
		events: [],
	});
	const snappee = model.addSnappee("regularPolygonCurve", {
		centerX: 0,
		centerY: 0,
		radius: 40,
		angle: Math.PI / 2,
		sides: 4,
		segmentsPerSide: 2,
		active: true,
	});
	return { model, snappee };
}

test("regular polygons and circular arcs expose the center as snap point -1", () => {
	const polygon = sampleSnappee({
		type: "regularPolygonCurve",
		centerX: 0,
		centerY: 0,
		radius: 40,
		angle: Math.PI / 2,
		sides: 4,
		segmentsPerSide: 2,
		transformation: [1, 0, 0, 1, 0, 0],
	});
	const center = polygon.find(point => isSpecialSnapPoint(point.snapPoint));
	assert.equal(center.snapPoint, -1);
	assert.ok(Math.hypot(center.x, center.y) < 1e-9);
	assert.equal(polygon.filter(point => !isSpecialSnapPoint(point.snapPoint)).length, 8);
	const polygonSpec = snappeeIndexSpec({
		type: "regularPolygonCurve",
		sides: 4,
		segmentsPerSide: 2,
	});
	assert.deepEqual(polygonSpec.i, [0, 8]);
	assert.equal(polygonSpec.iExcludeEnd, true);
	assert.equal(polygonSpec.hasSpecial, true);
	assert.equal(polygonSpec.specialI, -1);
	assert.equal(polygonSpec.mesh, false);

	const arc = sampleSnappee({
		type: "circularArcCurve",
		centerX: 12,
		centerY: -7,
		radius: 20,
		beginningAngle: 0,
		endAngle: Math.PI,
		clockwise: false,
		closed: false,
		segments: 4,
		transformation: [1, 0, 0, 1, 0, 0],
	});
	const arcCenter = arc.find(point => isSpecialSnapPoint(point.snapPoint));
	assert.equal(arcCenter.snapPoint, -1);
	assert.ok(Math.hypot(arcCenter.x - 12, arcCenter.y + 7) < 1e-9);
	assert.deepEqual(
		arc.filter(point => !isSpecialSnapPoint(point.snapPoint)).map(point => point.snapPoint),
		[0, 1, 2, 3, 4],
	);
	const arcSpec = snappeeIndexSpec({
		type: "circularArcCurve",
		segments: 4,
		closed: true,
	});
	assert.deepEqual(arcSpec.i, [0, 4]);
	assert.equal(arcSpec.iExcludeEnd, true);
	assert.equal(arcSpec.hasSpecial, true);
});

test("events on the special center stay put while the selection slides along the curve", () => {
	const { model, snappee } = polygonModel();
	const points = sampleSnappee(snappee).filter(point => !isSpecialSnapPoint(point.snapPoint));
	const placed = [0, 1, -1].map(snapPoint =>
		model.addEvent("tap", {
			channel: 0,
			time: [0, 0, 1],
			selected: true,
			attached: true,
			snappee: snappee.id,
			snapPoint,
		}),
	);
	const target = points[3];
	const App = withEventEditing(class {});
	new App()._applyPositionMove(model, placed[0].id, { x: target.x, y: target.y });
	assert.equal(placed[0].snapPoint, 3);
	assert.equal(placed[1].snapPoint, 4);
	assert.equal(placed[2].snapPoint, -1);
});

test("help text describes the special center snap point", async () => {
	const manual = await readManual();
	assert.match(manual, /numbered <code>-1<\/code>/);
	assert.match(manual, /编号 <code>-1<\/code>/);
	assert.match(manual, /編號 <code>-1<\/code>/);
	assert.match(manual, /番号 <code>-1<\/code>/);
});
