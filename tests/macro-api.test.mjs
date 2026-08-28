import assert from "node:assert/strict";
import test from "node:test";

test("JavaScript macro API exposes the PROMPT v13 top-level surface", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		metadata: { title: "Macro" },
		editor: { currentChannel: 0, currentTime: [2, 0, 1] },
		channels: [{ id: 0, name: "Main" }],
		events: [],
		snappees: [],
	});
	assert.deepEqual(
		Object.keys(runtime.globals).sort(),
		[
			"AffineMatrix2D",
			"BarLine",
			"BezierCurve",
			"BgNote",
			"BigText",
			"BpmChange",
			"Channel",
			"Chart",
			"Checkerboard",
			"Clip",
			"Comment",
			"DiamondGrid",
			"Drag",
			"Event",
			"Flick",
			"Grid",
			"Group",
			"Hexagon",
			"Hexagram",
			"Hold",
			"Location",
			"ParametricCurve",
			"ParametricMesh",
			"PenCurve",
			"Pentagon",
			"RadialMesh",
			"RectangularMesh",
			"RegularPolygonCurve",
			"Snappee",
			"Tap",
			"TipPoint",
			"Turntable",
			"Vector2D",
			"b",
			"bBang",
			"bgNote",
			"bigText",
			"bpm",
			"c",
			"checkerboard",
			"copy",
			"d",
			"diamondGrid",
			"f",
			"g",
			"grid",
			"h",
			"hexagon",
			"hexagram",
			"l",
			"pentagon",
			"s",
			"t",
			"tpc",
			"tpd",
			"transform",
			"turntable",
		].sort(),
	);
	assert.deepEqual(Object.keys(runtime).sort(), ["globals", "state"]);
});

test("macro wrappers expose timing, location, grouping, channels, and clips", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
		channels: [{ id: 0, name: "Main", color: "#ffffff", active: true }],
		events: [],
		snappees: [],
		clips: [],
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
	});
	const api = runtime.globals;
	assert.throws(() => new api.Event({ type: "bg_note", location: new api.Location(0, 0) }), /Unsupported event type/);
	assert.throws(() => new api.AffineMatrix2D([1, 0, 0, 1, 4, 5]), /matrix elements must be finite numbers/);
	const partialMatrix = new api.AffineMatrix2D(2);
	assert.deepEqual(Object.fromEntries(["a", "b", "c", "d", "tx", "ty"].map(key => [key, partialMatrix[key]])), {
		a: 2,
		b: 0,
		c: 0,
		d: 1,
		tx: 0,
		ty: 0,
	});
	const channel = api.Channel.current;
	assert.equal(channel.name, "Main");
	channel.name = "Edited";
	const note = new api.Event({ type: "tap", location: new api.Location(2, 3), time: [1, 1, 2] });
	assert.deepEqual(note.time, [1, 1, 2]);
	assert.equal(note.type, "tap");
	const group = api.g([note], 0xff0000);
	assert.equal(group.group, true);
	group.location = new api.Location(5, 6);
	assert.equal(group.events[0].location.x, 7);
	const bar = new api.BarLine([1, 1, 2]);
	assert.equal(api.Chart.barLines.length, 1);
	bar.delete();
	const clip = new api.Clip(group.events, "test");
	assert.equal(api.Chart.clips[0].name, "test");
	assert.ok(clip.paste([2, 0, 1], channel)[0] instanceof api.Tap);
	assert.equal(Object.hasOwn(note, "raw"), false);
	assert.equal(runtime.state.channels[0].name, "Edited");
});

test("macro geometry, tip-point serialization, relative copy, and deletion are enforced", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		editor: { currentChannel: 30, currentTime: [3, 0, 1] },
		channels: [
			{ id: 10, name: "First", color: "#ffffff", active: true },
			{ id: 30, name: "Main", color: "#ffffff", active: true },
		],
		events: [],
		snappees: [],
		clips: [],
		timing: { bpmChanges: [], barLines: [] },
	});
	const api = runtime.globals;
	const mesh = new api.RectangularMesh(-10, 10, 10, -10, 2, 2);
	assert.deepEqual([mesh.pos(2, 2).x, mesh.pos(2, 2).y], [10, -10]);
	assert.ok(api.Snappee.list[0] instanceof api.RectangularMesh);
	const radial = new api.RadialMesh(0, 0, 10, 4, 1, "up");
	assert.ok(Math.abs(radial.pos(0, 1).x) < 1e-12);
	assert.equal(radial.pos(0, 1).y, 10);
	const polygon = new api.RegularPolygonCurve(0, 0, 10, "up", 4, 1);
	assert.ok(Math.abs(polygon.pos(0).x) < 1e-12);
	assert.equal(polygon.pos(0).y, 10);
	const previousMath = globalThis.math;
	globalThis.math = await import("mathjs");
	const parametric = new api.ParametricMesh([0, 2], [0, 2], "i * 10 + j", "j - i");
	assert.deepEqual([parametric.pos(2, 1).x, parametric.pos(2, 1).y], [21, -1]);
	globalThis.math = previousMath;
	const attached = new api.Location(mesh, 1, 1);
	assert.throws(() => new api.Location(mesh, [1, 1]), /one curve index or two mesh indices/);
	const reassigned = new api.Location(9, -9);
	reassigned.snappee = mesh;
	assert.deepEqual([reassigned.x, reassigned.y], [10, -10], "assigning snappee must attach to its nearest point");
	const note = new api.Tap({ location: attached, time: [1, 1, 2], channel: api.Channel.getById(10) });
	assert.equal(note.location.attached, true);
	const tip = api.TipPoint.chain({ location: new api.Location(4, 5), timeBeats: [1, 1, 2] });
	note.tipPoint = tip;
	assert.equal(runtime.state.events[0].tipPointSpawnAbsolutePosition, true);
	const matrix = new api.AffineMatrix2D().translate(2, 3).rotate(Math.PI / 2);
	assert.ok(Math.abs(matrix.a) < 1e-12);
	api.transform(note, function () {
		this.translate(1, 2);
	});
	assert.deepEqual([note.tipPoint.location.x, note.tipPoint.location.y], [5, 7]);
	assert.throws(() => api.transform(note, [1, 0, 0, 1, 0, 0]), /AffineMatrix2D or a callback/);
	assert.throws(() => api.transform(note), /AffineMatrix2D or a callback/);
	const copies = api.copy([note]);
	assert.equal(copies.length, 1);
	assert.deepEqual(copies[0].time, [3, 0, 1]);
	assert.equal(copies[0].channel.id, 30, "copy must use channel order rather than ID arithmetic");
	assert.throws(() => api.copy(), /array of events/);
	const directChild = new api.Tap({ text: "direct child" });
	const directGroup = new api.Group({ events: [directChild] });
	assert.equal(
		api.Channel.current.events.some(event => event.text === "direct child"),
		false,
	);
	assert.equal(directGroup.events[0].text, "direct child");
	assert.throws(() => new api.Tap({ time: { numerator: 1, denominator: 2 } }), /beat/);
	assert.throws(() => api.b(null), /beat/);
	assert.throws(() => new api.Event({ location: new api.Location(0, 0) }), /type is required/);
	assert.throws(() => api.TipPoint.chain(10, "up", 1), /options object/);
	const flick = new api.Flick({ location: new api.Location(0, 0), angle: "up" });
	const flickRecord = runtime.state.events.at(-1);
	assert.equal(flick.angle, Math.PI / 2);
	assert.equal(new api.Flick({ angle: "upLeft" }).angle, (3 * Math.PI) / 4);
	assert.equal(new api.Flick({ angle: "leftUp" }).angle, (3 * Math.PI) / 4);
	assert.throws(() => new api.Flick({ angle: "up_left" }), /direction name/);
	flick.type = "hold";
	assert.equal(flick.type, "hold");
	assert.equal(Object.hasOwn(flickRecord, "angle"), false);
	const channel = new api.Channel({ name: "Temporary" });
	channel.delete();
	for (const operation of [() => channel.select(), () => channel.name, () => channel.toJSON()]) {
		assert.throws(operation, /deleted/);
	}
	const clip = new api.Clip([note], "Relative");
	const serializedClip = clip.toJSON();
	assert.equal(serializedClip.data.version, 1);
	assert.deepEqual(serializedClip.data.events[0].time, [0, 0, 1]);
	assert.equal(serializedClip.data.events[0].channel, 0);
});
