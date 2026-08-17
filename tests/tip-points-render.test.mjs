import assert from "node:assert/strict";
import test from "node:test";

import { TimingMap } from "../js/core/timing.js";
import {
	buildTipPointGuides,
	sampleTipPointPath,
	tipPointPathBetween,
	tipPointTrailEdges,
	tipPointVisualState,
} from "../js/render/stage.js";
import { timelineTipConnector } from "../js/render/timeline.js";

function note(id, beat, tipPointSpawnType, overrides = {}) {
	return {
		id,
		type: "tap",
		channel: "channel-1",
		time: [beat, 0, 1],
		x: beat * 10,
		y: 0,
		tipPointSpawnType,
		tipPointSpawnTime: 1,
		...overrides,
	};
}

test("render guides follow inherit, chain, drop, and none state", () => {
	const modes = ["inherit", "chain", "inherit", "inherit", "drop", "inherit", "inherit", "none", "inherit"];
	const events = modes.map((mode, index) => note(`note-${index + 1}`, index, mode));
	const guides = buildTipPointGuides({ channels: [{ id: "channel-1" }], events }, new TimingMap());

	assert.equal(guides.length, 4);
	assert.deepEqual(guides[0].events.map(event => event.id), ["note-2", "note-3", "note-4"]);
	assert.deepEqual(guides.slice(1).map(guide => guide.events[0].id), ["note-5", "note-6", "note-7"]);
	assert.ok(guides.slice(1).every(guide => guide.mode === "drop"));
	assert.ok(guides.slice(1).every(guide => guide.spawnSettings === events[4]));
});

test("an explicit chain starts a new guide and simultaneous events keep data order", () => {
	const events = [
		note("unrelated", 0, "inherit"),
		note("chain-a", 1, "chain"),
		note("chain-a-next", 1, "inherit"),
		note("chain-b", 1, "chain"),
		note("chain-b-next", 2, "inherit"),
	];
	const guides = buildTipPointGuides({ channels: [{ id: "channel-1" }], events }, new TimingMap());

	assert.deepEqual(guides.map(guide => guide.events.map(event => event.id)), [
		["chain-a", "chain-a-next"],
		["chain-b", "chain-b-next"],
	]);
});

test("spawn time supports seconds and beats across BPM changes", () => {
	const timing = new TimingMap({
		initialBpm: 120,
		bpmChanges: [{ time: [2, 0, 1], bpm: 60 }],
	});
	const events = [
		note("seconds", 3, "drop", { tipPointSpawnTime: 1 }),
		note("beats", 4, "drop", { tipPointSpawnTimeBeats: true, tipPointSpawnTime: [1, 0, 1] }),
	];
	const guides = buildTipPointGuides({ channels: [{ id: "channel-1" }], events }, timing);

	assert.equal(guides[0].eventTimes[0], 2);
	assert.equal(guides[0].spawnTime, 1);
	assert.equal(guides[1].eventTimes[0], 3);
	assert.equal(guides[1].spawnTime, 2);
});

test("tip point sampling interpolates segments and handles zero-time checkpoints", () => {
	const checkpoints = [
		{ time: 0, x: 0, y: 0 },
		{ time: 1, x: 10, y: 0 },
		{ time: 3, x: 10, y: 20 },
	];
	assert.deepEqual(sampleTipPointPath(checkpoints, 0.5), { time: 0.5, x: 5, y: 0, angle: 0 });
	assert.equal(sampleTipPointPath(checkpoints, 1).angle, 0);
	assert.equal(sampleTipPointPath(checkpoints, 2).y, 10);
	assert.equal(sampleTipPointPath(checkpoints, 2).angle, Math.PI / 2);

	const simultaneous = [
		{ time: 0, x: 0, y: 0 },
		{ time: 0, x: 10, y: 0 },
		{ time: 1, x: 20, y: 0 },
	];
	assert.equal(sampleTipPointPath(simultaneous, 0).x, 0);
	const after = sampleTipPointPath(simultaneous, Number.EPSILON);
	assert.ok(Number.isFinite(after.x));
	assert.ok(after.x >= 10);

	const simultaneousTail = [
		{ time: 0, x: 0, y: 0 },
		{ time: 1, x: 10, y: 0 },
		{ time: 1, x: 20, y: 0 },
	];
	assert.equal(sampleTipPointPath(simultaneousTail, 1).x, 10);
	assert.equal(sampleTipPointPath(simultaneousTail, 1 + Number.EPSILON).x, 20);
});

test("a stationary tip point keeps Sunniesnow's upward default direction", () => {
	const point = sampleTipPointPath([
		{ time: 0, x: 12, y: 34 },
		{ time: 1, x: 12, y: 34 },
	], 0.5);
	assert.equal(point.angle, -Math.PI / 2);
	const coincidentSegment = sampleTipPointPath([
		{ time: 0, x: 0, y: 0 },
		{ time: 1, x: 0, y: 0 },
		{ time: 2, x: 10, y: 0 },
	], 0.5);
	assert.equal(coincidentSegment.angle, -Math.PI / 2);
});

test("tip point visual state follows spawn, trail, and fade boundaries", () => {
	const checkpoints = [
		{ time: 0, x: 0, y: 0 },
		{ time: 1, x: 10, y: 0 },
		{ time: 3, x: 10, y: 20 },
	];
	assert.equal(tipPointVisualState(checkpoints, -0.001), null);
	assert.equal(tipPointVisualState(checkpoints, 0).scale, 0);
	assert.equal(tipPointVisualState(checkpoints, 0.15).scale, 0.5);
	const moving = tipPointVisualState(checkpoints, 2);
	assert.equal(moving.head.y, 10);
	assert.equal(moving.trail[0].y, 5);
	assert.equal(moving.trail.at(-1).y, 10);
	const fading = tipPointVisualState(checkpoints, 3.15);
	assert.ok(Math.abs(fading.alpha - 0.5) < 1e-9);
	assert.deepEqual({ x: fading.head.x, y: fading.head.y }, { x: 10, y: 20 });
	assert.equal(tipPointVisualState(checkpoints, 3.301), null);

	const shortGuide = [{ time: 0, x: 0, y: 0 }, { time: 0.1, x: 1, y: 0 }];
	assert.ok(Math.abs(tipPointVisualState(shortGuide, 0.25).scale - 5 / 6) < 1e-9);
	assert.equal(tipPointVisualState(shortGuide, 0.25).alpha, 1);
});

test("tip point trail preserves game-unstable corner winding", () => {
	const edges = tipPointTrailEdges([
		{ time: 0, x: 0, y: 0 },
		{ time: 0.1, x: 10, y: 0 },
		{ time: 0.2, x: 10, y: 10 },
	], 6);
	assert.equal(edges.length, 3);
	assert.deepEqual(edges[0].left, { x: 0, y: 0 });
	assert.ok(Math.abs(edges[1].left.x - 13) < 1e-12);
	assert.ok(Math.abs(edges[1].left.y + 3) < 1e-12);
	assert.ok(Math.abs(edges[1].right.x - 7) < 1e-12);
	assert.ok(Math.abs(edges[1].right.y - 3) < 1e-12);
	assert.deepEqual(edges[2].left, { x: 13, y: 10 });
	assert.deepEqual(edges[2].right, { x: 7, y: 10 });
});

test("tip point trail inserts the unstable tail connector only when crossing its time", () => {
	const trail = tipPointPathBetween([
		{ time: 0, x: 0, y: 0 },
		{ time: 0.05, x: 5, y: 0 },
		{ time: 1, x: 5, y: 10 },
	], 0.02, 0.4);
	assert.deepEqual(trail.map(point => point.index), [0.5, 1, 1.5, 1.5]);
	assert.ok(Math.abs(trail[2].time - 0.12) < 1e-12);
	assert.ok(Math.abs(trail[2].y - 0.736842105263158) < 1e-12);
});

test("timeline tip connectors keep spawn time and clip safely outside the viewport", () => {
	const connector = timelineTipConnector([
		{ time: 4.574774774774775, x: 100, y: 20 },
		{ time: 5.574774774774775, x: 200, y: 20 },
	]);
	assert.equal(connector[0].time, 4.574774774774775);
	assert.equal(Math.hypot(connector[0].x - connector[1].x, connector[0].y - connector[1].y), 18);
	assert.deepEqual(tipPointPathBetween(connector, 5.844540540540349, 18.900119328556773), []);
	assert.deepEqual(tipPointPathBetween(connector, -10, -1), []);
	assert.deepEqual(tipPointPathBetween([{ time: 1, x: 2, y: 3 }], 0, 2), [
		{ time: 1, x: 2, y: 3, index: 0 },
	]);
});

test("tip point corner geometry stays finite across coincident checkpoints", () => {
	const edges = tipPointTrailEdges([
		{ time: 0, x: 0, y: 0 },
		{ time: 0.1, x: 10, y: 0 },
		{ time: 0.2, x: 10, y: 0 },
		{ time: 0.3, x: 10, y: 10 },
	], 6);
	assert.equal(edges.length, 4);
	for (const edge of edges) {
		assert.ok([edge.left.x, edge.left.y, edge.right.x, edge.right.y].every(Number.isFinite));
	}
});
