import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readManual } from "./module-source.mjs";

test("snappee macros expose index ranges, active assignment, and subclass properties", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		channels: [{ id: 0, name: "Main", active: true }],
		events: [],
		snappees: [
			{
				id: 4,
				type: "circularArcCurve",
				name: "Arc",
				active: true,
				centerX: 3,
				centerY: 4,
				radius: 10,
				beginningAngle: 0,
				endAngle: Math.PI,
				clockwise: false,
				closed: false,
				segments: 8,
				transformation: [1, 0, 0, 1, 0, 0],
			},
		],
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
	});
	const { RectangularMesh, RadialMesh, ParametricMesh, RegularPolygonCurve, BezierCurve } = runtime.globals;

	const mesh = new RectangularMesh(-100, 50, 100, -50, 16, 8);
	assert.deepEqual(mesh.iRange, [0, 16]);
	assert.equal(mesh.iExcludeEnd, false);
	assert.deepEqual(mesh.jRange, [0, 8]);
	assert.equal(mesh.jExcludeEnd, false);
	assert.equal(mesh.hasSpecial, false);
	assert.equal(mesh.specialI, null);
	mesh.horizontalTiles = 4;
	mesh.topLeftX = -80;
	assert.equal(mesh.horizontalTiles, 4);
	assert.equal(mesh.topLeftX, -80);
	assert.deepEqual(mesh.iRange, [0, 4]);
	mesh.select();
	mesh.active = false;
	assert.equal(mesh.active, false);
	assert.equal(mesh.selected, false);
	mesh.active = true;
	assert.equal(mesh.active, true);

	const radial = new RadialMesh(0, 0, 50, 8, 4, "right");
	assert.deepEqual(radial.iRange, [0, 8]);
	assert.equal(radial.iExcludeEnd, true);
	assert.deepEqual(radial.jRange, [0, 4]);
	assert.equal(radial.jExcludeEnd, false);
	assert.equal(radial.startingAngle, 0);
	assert.throws(() => new BezierCurve(1, [], 4).jRange, /only valid for meshes/);

	const parametric = new ParametricMesh([-2, 2], [-1, 1], "i", "j");
	assert.deepEqual(parametric.iRange, [-2, 2]);
	assert.equal(parametric.iExcludeEnd, false);
	parametric.iRange = [0, 5];
	parametric.iRangeExclusive = true;
	parametric.xExpression = "i * 2";
	assert.deepEqual(parametric.iRange, [0, 5]);
	assert.equal(parametric.iExcludeEnd, true);
	assert.equal(parametric.xExpression, "i * 2");

	const polygon = new RegularPolygonCurve(0, 0, 40, Math.PI / 2, 5, 4);
	assert.deepEqual(polygon.iRange, [0, 20]);
	assert.equal(polygon.iExcludeEnd, true);
	assert.equal(polygon.hasSpecial, true);
	assert.equal(polygon.specialI, -1);
	assert.throws(() => polygon.jRange, /only valid for meshes/);
	const center = polygon.pos(-1);
	assert.ok(Math.hypot(center.x, center.y) < 1e-6);
	polygon.sides = 6;
	assert.equal(polygon.sides, 6);
	assert.deepEqual(polygon.iRange, [0, 24]);
});

test("curve subclasses and circular arcs expose their own fields and the center", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		channels: [{ id: 0, name: "Main", active: true }],
		events: [],
		snappees: [
			{
				id: 4,
				type: "circularArcCurve",
				name: "Arc",
				active: true,
				centerX: 3,
				centerY: 4,
				radius: 10,
				beginningAngle: 0,
				endAngle: Math.PI,
				clockwise: false,
				closed: false,
				segments: 8,
				transformation: [1, 0, 0, 1, 0, 0],
			},
		],
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
	});
	const { BezierCurve, PenCurve, Snappee } = runtime.globals;
	const curve = new BezierCurve(1, [{ x: -10, y: 0 }, { x: 10, y: 0 }], 4);
	assert.deepEqual(curve.iRange, [0, 4]);
	assert.equal(curve.iExcludeEnd, false);
	curve.closed = true;
	assert.equal(curve.closed, true);
	assert.equal(curve.iExcludeEnd, true);
	curve.controlPoints = [[0, 1], { x: 2, y: 3 }];
	assert.deepEqual(curve.controlPoints, [{ x: 0, y: 1 }, { x: 2, y: 3 }]);

	const pen = new PenCurve([{ type: "M", x: 0, y: 0 }, { type: "L", x: 5, y: 0 }], 4, false);
	assert.equal(pen.commands[1].type, "L");
	pen.segments = 6;
	assert.equal(pen.segments, 6);

	const arc = Snappee.getById(4);
	assert.equal(arc.hasSpecial, true);
	assert.equal(arc.specialI, -1);
	assert.deepEqual(arc.iRange, [0, 8]);
	assert.equal(arc.iExcludeEnd, false);
	const arcCenter = arc.pos(-1);
	assert.equal(arcCenter.x, 3);
	assert.equal(arcCenter.y, 4);
	const arcStart = arc.pos(0);
	assert.ok(Math.hypot(arcStart.x - 13, arcStart.y - 4) < 1e-6);

	const ruby = await readFile(new URL("../js/macro/macro-api.rb", import.meta.url), "utf8");
	assert.match(ruby, /def i_range/);
	assert.match(ruby, /def j_range/);
	assert.match(ruby, /def i_exclude_end\?/);
	assert.match(ruby, /def j_exclude_end\?/);
	assert.match(ruby, /def has_special\?/);
	assert.match(ruby, /def special_i/);
	assert.match(ruby, /def active=/);
	assert.match(ruby, /number_field :center_x, "centerX"/);
	assert.match(ruby, /integer_field :horizontal_tiles, "horizontalTiles"/);

	const manual = await readManual();
	assert.match(manual, /i_range/);
	assert.match(manual, /has_special\?/);
	assert.match(manual, /horizontal_tiles/);
});
