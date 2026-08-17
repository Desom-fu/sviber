import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as math from "mathjs";
import JSZip from "jszip";

import {
	Rational,
	add,
	compare,
	fromNumber,
	snap,
	sub,
} from "../js/core/rational.js";
import { TimingMap } from "../js/core/timing.js";
import {
	CHART_BOUNDS,
	SNAPPEE_TYPES,
	applyTransform,
	clampPointToChartBounds,
	findNearestSnapPoint,
	isPointWithinChartBounds,
	penCommandsFromNodes,
	resolveAttachedPosition,
	sampleSnappee,
	sampleSnappeePath,
} from "../js/core/geometry.js";
import { History } from "../js/core/history.js";
import {
	ChartModel,
	connectSelectedTipPointChain,
	createDefaultSnappees,
	createEvent,
	createSnappee,
} from "../js/core/chart-model.js";
import {
	PROJECT_FILENAME,
	createProjectManifest,
	exportSunniesnowChartDocument,
	normalizeProjectManifest,
	projectManagedFiles,
} from "../js/core/project.js";
import { FileManager } from "../js/platform.js";

globalThis.math = math;

test("chart-boundary helpers use the editor's documented note area", () => {
	assert.deepEqual(CHART_BOUNDS, { minX: -100, maxX: 100, minY: -50, maxY: 50 });
	assert.equal(isPointWithinChartBounds({ x: -100, y: 50 }), true);
	assert.equal(isPointWithinChartBounds({ x: 100, y: -50 }), true);
	assert.equal(isPointWithinChartBounds({ x: 100.001, y: 0 }), false);
	assert.equal(isPointWithinChartBounds({ x: 0, y: -50.001 }), false);
	assert.deepEqual(clampPointToChartBounds({ x: 125, y: -75 }), { x: 100, y: -50 });
});

function assertClose(actual, expected, epsilon = 1e-10) {
	assert.ok(
		Math.abs(actual - expected) <= epsilon,
		`expected ${actual} to be within ${epsilon} of ${expected}`,
	);
}

test("Rational canonicalizes mixed tuples and round-trips negative decimals", () => {
	assert.deepEqual(Rational.from([0, -3, 6]).toJSON(), [0, -1, 2]);
	assert.deepEqual(Rational.from([-2, 1, 2]).toJSON(), [-1, -1, 2]);

	const negativeDecimal = Rational.from("-1.5");
	assert.deepEqual(negativeDecimal.toJSON(), [-1, -1, 2]);
	assert.equal(Rational.from(negativeDecimal.toString()).toNumber(), -1.5);
	assert.equal(Rational.from(String(negativeDecimal.toNumber())).toNumber(), -1.5);
});

test("Rational arithmetic, comparison, and snapping remain exact", () => {
	assert.deepEqual(add([0, 1, 3], [0, 1, 6]).toJSON(), [0, 1, 2]);
	assert.deepEqual(sub([1, 0, 1], [0, 3, 4]).toJSON(), [0, 1, 4]);
	assert.equal(compare([0, -1, 2], [0, -2, 3]), 1);

	assert.deepEqual(snap([0, 1, 4], 2).toJSON(), [0, 1, 2]);
	assert.deepEqual(snap([0, -1, 4], 2).toJSON(), [0, -1, 2]);
	assert.deepEqual(snap([0, 1, 5], 2).toJSON(), [0, 0, 1]);
	assert.deepEqual(snap([0, -1, 5], 2).toJSON(), [0, 0, 1]);
});

test("Rational.fromNumber honors the maximum denominator", () => {
	const limited = fromNumber(Math.PI, 16);
	assert.ok(limited.denominator <= 16n);
	assert.deepEqual(limited.toJSON(), [3, 1, 7]);
});

function createTimingFixture() {
	return new TimingMap({
		offset: 0.25,
		initialBpm: 120,
		bpmChanges: [
			{ time: [-2, 0, 1], bpm: 60 },
			{ time: [2, 0, 1], bpm: 180 },
		],
	});
}

test("TimingMap round-trips beats on both sides of zero and BPM changes", () => {
	const timing = createTimingFixture();
	const beats = [
		[-4, 0, 1],
		[-3, 0, 1],
		[-2, 0, 1],
		[-1, 0, 1],
		[0, 0, 1],
		[0, 1, 2],
		[2, 0, 1],
		[3, 1, 2],
		[5, 0, 1],
	];

	assertClose(timing.beatToSeconds(-3), -2.25);
	assertClose(timing.beatToSeconds(-2), -1.75);
	assertClose(timing.beatToSeconds(0), 0.25);
	assertClose(timing.beatToSeconds(2), 2.25);
	assertClose(timing.beatToSeconds(4), 2.25 + 2 / 3);

	for (const beat of beats) {
		const seconds = timing.beatToSeconds(beat);
		assert.ok(
			timing.secondsToBeat(seconds).equals(beat),
			`failed beat/seconds round-trip for ${Rational.from(beat)}`,
		);
	}
});

test("TimingMap keeps the latter duplicate BPM change", () => {
	const timing = new TimingMap({
		initialBpm: 120,
		bpmChanges: [
			{ time: [1, 0, 1], bpm: 150 },
			{ time: [1, 0, 1], bpm: 90 },
		],
	});

	assert.equal(timing.bpmChanges.length, 1);
	assert.deepEqual(timing.bpmChanges[0].time.toJSON(), [1, 0, 1]);
	assert.equal(timing.bpmChanges[0].bpm, 90);
	assertClose(timing.beatToSeconds(2), 0.5 + 2 / 3);
});

test("TimingMap duration integration crosses negative and positive BPM regions", () => {
	const timing = createTimingFixture();
	assertClose(timing.durationToSeconds(-3, 7), 5.166666666666667);
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

test("Bezier and pen display paths retain smooth points between snap points", () => {
	const bezier = createSnappee("bezierCurve", {
		controlPoints: [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }],
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

	const attached = resolveAttachedPosition({
		attached: true,
		snappee: 42,
		snapPoint: [0, 1],
	}, [mesh]);
	assert.equal(attached.attached, true);
	assertClose(attached.x, 5);
	assertClose(attached.y, 8);

	assert.deepEqual(
		resolveAttachedPosition({ attached: false, x: 3, y: 4 }, [mesh]),
		{ x: 3, y: 4, attached: false },
	);
});

test("event type conversion removes fields that the destination type cannot use", () => {
	const source = {
		id: 7,
		time: [2, 0, 1],
		channel: 0,
		selected: true,
		attached: false,
		x: 12,
		y: 34,
		duration: [3, 0, 1],
		text: "legacy",
		angle: Math.PI / 4,
		tipPointSpawnType: "chain",
		tipPointSpawnAbsolutePosition: false,
		tipPointSpawnDistance: 100,
		tipPointSpawnAngle: Math.PI / 2,
		tipPointSpawnTimeBeats: false,
		tipPointSpawnTime: 1,
	};
	const pattern = createEvent("grid", source);
	for (const field of [
		"attached", "x", "y", "snappee", "snapPoint", "text", "angle",
		"tipPointSpawnType", "tipPointSpawnDistance", "tipPointSpawnTime",
	]) assert.equal(Object.hasOwn(pattern, field), false, `${field} leaked into a grid event`);
	assert.deepEqual(pattern.duration, [3, 0, 1]);

	const drag = createEvent("drag", source);
	assert.equal(Object.hasOwn(drag, "duration"), false);
	assert.equal(Object.hasOwn(drag, "text"), false);
	assert.equal(Object.hasOwn(drag, "angle"), false);
	assert.equal(drag.tipPointSpawnType, "chain");
	assert.equal(drag.x, 12);
	assert.equal(drag.y, 34);

	assert.deepEqual(createEvent("bgNote", { ...source, duration: 0 }).duration, [0, 0, 1]);
	assert.deepEqual(createEvent("hold", { ...source, duration: 0 }).duration, [1, 0, 1]);
});

test("History ignores no-op records and truncates redo branches", () => {
	const history = new History({ value: 0 });
	assert.equal(history.record({ value: 0 }, "No-op"), false);
	assert.equal(history.length, 1);

	assert.equal(history.push({ value: 1 }, "One"), true);
	assert.equal(history.record({ value: 2 }, "Two"), true);
	assert.deepEqual(history.undo(), { value: 1 });
	assert.equal(history.canRedo, true);
	assert.equal(history.record({ value: 3 }, "Three"), true);
	assert.equal(history.length, 3);
	assert.equal(history.canRedo, false);
	assert.deepEqual(history.current, { value: 3 });
	assert.deepEqual(history.entries.map(({ label }) => label), ["Initial state", "One", "Three"]);
});

test("History transforms every snapshot without moving its cursor", () => {
	const history = new History({ value: 0, shared: "old" });
	history.record({ value: 1, shared: "old" }, "One");
	history.record({ value: 2, shared: "old" }, "Two");
	history.undo();
	const cursor = history.cursor;
	history.transformStates(state => ({ ...state, shared: "new" }));

	assert.equal(history.cursor, cursor);
	assert.deepEqual(history.getSnapshot(0), { value: 0, shared: "new" });
	assert.deepEqual(history.current, { value: 1, shared: "new" });
	assert.deepEqual(history.redo(), { value: 2, shared: "new" });
});

test("History retains only the latest 1000 snapshots", () => {
	const history = new History({ value: 0 });
	for (let value = 1; value <= 1100; value += 1) {
		history.record({ value }, `Commit ${value}`);
	}

	assert.equal(history.length, 1000);
	assert.deepEqual(history.getSnapshot(0), { value: 101 });
	assert.deepEqual(history.current, { value: 1100 });
	assert.equal(history.entries.at(-1).label, "Commit 1100");
});

test("History records manual and automatic save markers on the current entry", () => {
	const history = new History({ value: 0 });
	history.record({ value: 1 }, "Edit");
	history.markCurrent("autosave", 100);
	history.markCurrent("save", 200);
	assert.deepEqual(history.currentEntry.metadata.historyMarkers, { autosave: 100, save: 200 });
});

test("new charts activate only the rectangular default snappee", () => {
	const snappees = createDefaultSnappees();
	assert.equal(snappees.length, 6);
	assert.deepEqual(snappees.map(item => item.type), [
		"rectangularMesh", "radialMesh", "regularPolygonCurve",
		"regularPolygonCurve", "regularPolygonCurve", "regularPolygonCurve",
	]);
	assert.deepEqual(snappees.map(item => item.active), [true, false, false, false, false, false]);
	assert.deepEqual([snappees[0].horizontalTiles, snappees[0].verticalTiles], [16, 8]);
	assert.deepEqual([snappees[1].azimuthalTiles, snappees[1].radialTiles], [16, 4]);
	assert.deepEqual(snappees.slice(2).map(item => [item.sides, item.segmentsPerSide]), [[6, 4], [6, 4], [6, 2], [5, 4]]);
	assert.ok(Math.abs(snappees[2].radius - 100 / Math.sqrt(3)) < 1e-12);
	assert.ok(Math.abs(snappees[5].centerY - (20 * Math.sqrt(5) - 50)) < 1e-12);
});

test("ChartModel deletions do not renumber surviving IDs and saved IDs round-trip", () => {
	const model = ChartModel.createDefault();
	const defaultSnappeeIds = model.snappees.map(({ id }) => id);
	const removedChannel = model.addChannel(model.channels.length, { name: "Removed" });
	const survivingChannel = model.addChannel(model.channels.length, { name: "Surviving" });
	const removedEvent = model.addEvent("tap", { channel: 0, x: 1, y: 2 });
	const survivingEvent = model.addEvent("tap", { channel: survivingChannel.id, x: 3, y: 4 });
	const removedSnappee = model.addSnappee("rectangularMesh");
	const survivingSnappee = model.addSnappee("radialMesh");

	model.removeChannel(removedChannel.id);
	model.removeEvent(removedEvent.id);
	model.removeSnappee(removedSnappee.id);

	assert.deepEqual(model.channels.map(({ id }) => id), [0, survivingChannel.id]);
	assert.deepEqual(model.events.map(({ id }) => id), [survivingEvent.id]);
	assert.deepEqual(model.snappees.map(({ id }) => id), [...defaultSnappeeIds, survivingSnappee.id]);

	const reopened = ChartModel.import(JSON.stringify(model.toJSON()));
	assert.deepEqual(reopened.channels.map(({ id }) => id), [0, survivingChannel.id]);
	assert.deepEqual(reopened.events.map(({ id }) => id), [survivingEvent.id]);
	assert.deepEqual(reopened.snappees.map(({ id }) => id), [...defaultSnappeeIds, survivingSnappee.id]);
});

test("ChartModel persists nextIds so reopened charts never reuse deleted IDs", () => {
	const model = ChartModel.createDefault();
	const oldChannel = model.addChannel();
	const oldEvent = model.addEvent("tap", { channel: 0 });
	const oldSnappee = model.addSnappee("rectangularMesh");
	model.removeChannel(oldChannel.id);
	model.removeEvent(oldEvent.id);
	model.removeSnappee(oldSnappee.id);

	const reopened = ChartModel.import(model.toJSON());
	assert.equal(reopened.addChannel().id, oldChannel.id + 1);
	assert.equal(reopened.addEvent("tap", { channel: 0 }).id, oldEvent.id + 1);
	assert.equal(reopened.addSnappee("rectangularMesh").id, oldSnappee.id + 1);
});

test("ChartModel defaults and round-trips the out-of-bounds editor setting", () => {
	const model = ChartModel.createDefault();
	assert.equal(model.editor.allowOutOfBounds, false);
	model.editor.allowOutOfBounds = true;
	const reopened = ChartModel.import(model.toJSON());
	assert.equal(reopened.editor.allowOutOfBounds, true);
	assert.equal(reopened.toJSON().sviber.editor.allowOutOfBounds, true);
});

test("ChartModel prefers embedded sviber state over top-level generated events", () => {
	const model = ChartModel.import({
		title: "Embedded state",
		events: [{
			type: "hold",
			time: 0,
			properties: { x: 99, y: 99, duration: 2 },
		}],
		sviber: {
			timing: { offset: 0, initialBpm: 120, bpmChanges: [] },
			channels: [{ id: 3 }],
			events: [{ id: 7, type: "tap", time: [2, 0, 1], channel: 3, x: 4, y: 5 }],
			snappees: [],
			nextIds: { channel: 4, event: 8, snappee: 0 },
		},
	});

	assert.equal(model.metadata.title, "Embedded state");
	assert.equal(model.events.length, 1);
	assert.equal(model.events[0].id, 7);
	assert.equal(model.events[0].type, "tap");
	assert.deepEqual(model.events[0].time, [2, 0, 1]);
});

test("Sunniesnow import rebuilds guide modes, BPM-spanning holds, and warnings", () => {
	const model = ChartModel.import({
		title: "Imported",
		events: [
			{ type: "placeholder", time: -0.5, properties: { x: -20, y: 30, tipPoint: "guide-a" } },
			{ type: "tap", time: 0, properties: { x: 1, y: 2, tipPoint: "guide-a" } },
			{ type: "hold", time: 0.5, properties: { x: 3, y: 4, duration: 1.5, tipPoint: "guide-a" } },
			{ type: "image", time: 0.25, properties: { filename: "story.png", duration: 1 } },
			{ type: "flick", time: 3, properties: { x: 5, y: 6, angle: [0.25, 1.5] } },
		],
	}, {
		offset: 0,
		initialBpm: 120,
		bpmChanges: [{ time: [2, 0, 1], bpm: 60 }],
	});

	assert.deepEqual(model.events.map(({ type }) => type), ["tap", "hold", "flick"]);
	const [tap, hold, flick] = model.events;
	assert.equal(tap.tipPointSpawnType, "chain");
	assert.equal(hold.tipPointSpawnType, "inherit");
	assert.equal(tap.tipPointSpawnAbsolutePosition, true);
	assert.equal(tap.tipPointSpawnX, -20);
	assert.equal(tap.tipPointSpawnY, 30);
	assert.equal(tap.tipPointSpawnTime, 0.5);
	assert.deepEqual(hold.duration, [2, 0, 1]);
	assert.equal(flick.angle, 0.25);
	assert.ok(model.importWarnings.some((warning) => warning.includes("unsupported event type image")));
	assert.ok(model.importWarnings.some((warning) => warning.includes("Only the first flick angle")));
});

test("tip-point export implements inherit, chain, drop, and none sequences", () => {
	const model = ChartModel.createDefault();
	const modes = ["inherit", "chain", "inherit", "inherit", "drop", "inherit", "inherit", "none", "inherit"];
	for (let index = 0; index < modes.length; index += 1) {
		model.addEvent("tap", {
			time: [index, 0, 1],
			x: index * 10,
			y: 0,
			tipPointSpawnType: modes[index],
		});
	}

	const exported = model.generateSunniesnowEvents();
	const notes = exported.filter(({ type }) => type === "tap");
	const placeholders = exported.filter(({ type }) => type === "placeholder");
	const guide = (index) => notes[index].properties.tipPoint;

	assert.equal(notes.length, modes.length);
	assert.equal(guide(0), undefined);
	assert.equal(guide(7), undefined);
	assert.equal(guide(8), undefined);
	assert.equal(guide(1), guide(2));
	assert.equal(guide(2), guide(3));
	assert.equal(typeof guide(1), "string");
	assert.equal(new Set([guide(4), guide(5), guide(6)]).size, 3);

	const noteGuideIds = new Set(notes.map(({ properties }) => properties.tipPoint).filter(Boolean));
	const placeholderGuideIds = new Set(placeholders.map(({ properties }) => properties.tipPoint));
	assert.equal(placeholders.length, 4);
	assert.equal(placeholderGuideIds.size, 4);
	assert.deepEqual(placeholderGuideIds, noteGuideIds);
	for (const placeholder of placeholders) {
		assert.ok(notes.some(({ properties }) => properties.tipPoint === placeholder.properties.tipPoint));
	}
});

test("batch chain connects every selected note once and stops before the next note", () => {
	const model = ChartModel.createDefault();
	for (let index = 0; index < 4; index += 1) {
		model.addEvent("tap", {
			time: [index, 0, 1],
			selected: index < 3,
			tipPointSpawnType: index < 3 ? "chain" : "inherit",
		});
	}

	const result = connectSelectedTipPointChain(model.events);
	assert.equal(result.ok, true);
	assert.deepEqual(model.events.map(event => event.tipPointSpawnType), ["chain", "inherit", "inherit", "none"]);
	const notes = model.generateSunniesnowEvents().filter(event => event.type === "tap");
	assert.equal(notes[0].properties.tipPoint, notes[1].properties.tipPoint);
	assert.equal(notes[1].properties.tipPoint, notes[2].properties.tipPoint);
	assert.equal(notes[3].properties.tipPoint, undefined);
});

test("batch chain rejects gaps and cross-channel selections without mutation", () => {
	const model = ChartModel.createDefault();
	const first = model.addEvent("tap", { time: [0, 0, 1], selected: true, tipPointSpawnType: "drop" });
	model.addEvent("tap", { time: [1, 0, 1], selected: false, tipPointSpawnType: "none" });
	const third = model.addEvent("tap", { time: [2, 0, 1], selected: true, tipPointSpawnType: "drop" });
	const beforeGap = structuredClone(model.events);
	assert.deepEqual(connectSelectedTipPointChain(model.events), { ok: false, reason: "contiguous" });
	assert.deepEqual(model.events, beforeGap);

	const secondChannel = model.addChannel();
	third.channel = secondChannel.id;
	const beforeChannels = structuredClone(model.events);
	assert.deepEqual(connectSelectedTipPointChain(model.events), { ok: false, reason: "channel" });
	assert.deepEqual(model.events, beforeChannels);
	assert.equal(first.channel, model.channels[0].id);
});

test("attached notes and absolute attached tip spawns export transformed coordinates", () => {
	const model = ChartModel.createDefault();
	const snappee = model.addSnappee("rectangularMesh", {
		topLeftX: 0,
		topLeftY: 0,
		bottomRightX: 10,
		bottomRightY: 20,
		horizontalTiles: 1,
		verticalTiles: 1,
		transformation: [0, 1, -1, 0, 5, 6],
	});
	model.addEvent("tap", {
		time: [2, 0, 1],
		attached: true,
		snappee: snappee.id,
		snapPoint: [1, 0],
		tipPointSpawnType: "chain",
		tipPointSpawnAbsolutePosition: true,
		tipPointSpawnAttached: true,
		tipPointSpawnSnappee: snappee.id,
		tipPointSpawnSnapPoint: [0, 1],
		tipPointSpawnTimeBeats: true,
		tipPointSpawnTime: [1, 0, 1],
	});

	const exported = model.generateSunniesnowEvents();
	const note = exported.find(({ type }) => type === "tap");
	const placeholder = exported.find(({ type }) => type === "placeholder");
	assertClose(note.properties.x, 5);
	assertClose(note.properties.y, 16);
	assertClose(placeholder.properties.x, -15);
	assertClose(placeholder.properties.y, 6);
	assert.equal(placeholder.properties.tipPoint, note.properties.tipPoint);
});

test("NW.js saves an opened chart back to its known path and resolves relative assets", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-platform-"));
	const chartPath = path.join(directory, "opened.json");
	const musicPath = path.join(directory, "music.bin");
	const previousNw = globalThis.nw;
	globalThis.nw = { require: createRequire(import.meta.url) };
	try {
		const source = ChartModel.createDefault({ metadata: { title: "Opened", difficultyName: "Hard" } });
		await writeFile(chartPath, source.serialize(2));
		await writeFile(musicPath, new Uint8Array([1, 2, 3, 4]));
		const file = {
			name: "opened.json",
			path: chartPath,
			text: () => readFile(chartPath, "utf8"),
		};
		const manager = new FileManager();
		const parsed = await manager.parseFile(file);
		manager.adoptChartSource(parsed);
		const model = ChartModel.import(parsed.document);
		model.metadata.title = "Saved in place";
		assert.equal(await manager.saveChart(model), chartPath);
		assert.equal(JSON.parse(await readFile(chartPath, "utf8")).title, "Saved in place");

		const asset = await manager.fileForAsset("music.bin", "music");
		assert.equal(asset.name, "music.bin");
		assert.deepEqual([...new Uint8Array(await asset.arrayBuffer())], [1, 2, 3, 4]);
		assert.equal(manager.localPathFor(asset), musicPath);
	} finally {
		if (previousNw === undefined) delete globalThis.nw;
		else globalThis.nw = previousNw;
		await rm(directory, { recursive: true, force: true });
	}
});

test("chart export does not enforce external JSON Schema required fields", () => {
	const model = ChartModel.createDefault({
		metadata: {
			title: "",
			artist: "",
			charter: "",
			difficultyName: "",
			difficulty: "",
		},
		events: [],
	});
	const chart = exportSunniesnowChartDocument(model);
	assert.equal(chart.artist, "");
	assert.equal(chart.charter, "");
	assert.deepEqual(chart.events, []);
	assert.match(chart.$schema, /chart-1\.0\.json$/);
});

test("project manifests preserve ordered difficulties and reject unsafe paths", () => {
	const manifest = createProjectManifest({
		name: "Song",
		music: "song.ogg",
		image: "cover.png",
		activeChart: "master",
		charts: [
			{ id: "hard", file: "hard.json" },
			{ id: "master", file: "master.json" },
		],
	});
	assert.deepEqual(manifest.charts.map(entry => entry.id), ["hard", "master"]);
	assert.equal(manifest.activeChart, "master");
	assert.throws(() => normalizeProjectManifest({
		...manifest,
		charts: [{ id: "bad", file: "charts/bad.json" }],
	}), /project folder root/);
	assert.deepEqual([...projectManagedFiles(manifest)].sort(), ["cover.png", "hard.json", "master.json", "song.ogg"]);
	assert.throws(() => normalizeProjectManifest({
		...manifest,
		music: "hard.json",
	}), /conflicts with a difficulty chart/);
});

test("project folders round-trip all difficulties and level export contains only strict root charts", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-project-"));
	const previousNw = globalThis.nw;
	const previousZip = globalThis.JSZip;
	const previousReady = globalThis.sviberDependenciesReady;
	globalThis.nw = { require: createRequire(import.meta.url) };
	globalThis.JSZip = JSZip;
	globalThis.sviberDependenciesReady = Promise.resolve();
	try {
		const makeChart = (difficultyName, difficulty, x) => {
			const model = ChartModel.createDefault({
				metadata: {
					title: "Folder Song",
					artist: "Artist",
					charter: "Charter",
					difficultyName,
					difficultyColor: "#e75e74",
					difficulty,
					difficultySup: "",
				},
			});
			model.addEvent("tap", { time: [1, 0, 1], x, y: 0 });
			return model;
		};
		const hard = makeChart("Hard", "9", -25);
		const master = makeChart("Master", "12", 25);
		const music = Object.assign(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }), { name: "song.ogg" });
		const cover = Object.assign(new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" }), { name: "cover.png" });
		const manager = new FileManager();
		manager.rememberAsset("source-song.ogg", music, "music");
		manager.rememberAsset("source-cover.png", cover, "image");
		const result = await manager.saveProject({
			name: "Folder Song",
			music: "source-song.ogg",
			image: "source-cover.png",
			activeChart: "master",
			charts: [
				{ id: "hard", file: "hard.json", model: hard },
				{ id: "master", file: "master.json", model: master },
			],
		}, { directoryPath: directory });
		assert.equal(result.manifest.music, "song.ogg");
		assert.equal(result.manifest.image, "cover.png");
		const diskManifest = JSON.parse(await readFile(path.join(directory, PROJECT_FILENAME), "utf8"));
		assert.deepEqual(diskManifest.charts.map(entry => entry.file), ["hard.json", "master.json"]);
		assert.ok(JSON.parse(await readFile(path.join(directory, "hard.json"), "utf8")).sviber);

		const reopenedManager = new FileManager();
		const reopened = await reopenedManager.openProject({ directoryPath: directory });
		assert.equal(reopened.manifest.activeChart, "master");
		assert.deepEqual(reopened.charts.map(entry => entry.document.difficultyName), ["Hard", "Master"]);
		assert.equal(reopened.musicFile.name, "song.ogg");
		assert.equal(reopened.imageFile.name, "cover.png");
		reopenedManager.rememberAsset("song.ogg", reopened.musicFile, "music");
		reopenedManager.rememberAsset("cover.png", reopened.imageFile, "image");

		const models = reopened.charts.map(entry => ({ ...entry, model: ChartModel.import(entry.document) }));
		const levelBlob = await reopenedManager.createLevelArchive({ name: "Folder Song", charts: models });
		const archive = await JSZip.loadAsync(await levelBlob.arrayBuffer());
		assert.deepEqual(Object.keys(archive.files).sort(), ["cover.png", "hard.json", "master.json", "song.ogg"]);
		for (const filename of ["hard.json", "master.json"]) {
			const chart = JSON.parse(await archive.file(filename).async("text"));
			assert.equal(Object.hasOwn(chart, "sviber"), false);
			assert.deepEqual(Object.keys(chart).sort(), [
				"$schema", "artist", "charter", "difficulty", "difficultyColor",
				"difficultyName", "difficultySup", "events", "title",
			].sort());
		}
		const conflictingMusic = Object.assign(new Blob([new Uint8Array([1])], { type: "audio/ogg" }), { name: "hard.json" });
		reopenedManager.rememberAsset("hard.json", conflictingMusic, "music");
		await assert.rejects(
			() => reopenedManager.createLevelArchive({ name: "Folder Song", charts: models }),
			/Duplicate Sunniesnow level filename/,
		);

		await writeFile(path.join(directory, "keep-me.txt"), "user file");
		const replacementMusic = Object.assign(new Blob([new Uint8Array([7, 8, 9])], { type: "audio/ogg" }), { name: "replacement.ogg" });
		const replacementCover = Object.assign(new Blob([new Uint8Array([10, 11, 12])], { type: "image/png" }), { name: "replacement.png" });
		manager.rememberAsset("replacement.ogg", replacementMusic, "music");
		manager.rememberAsset("replacement.png", replacementCover, "image");
		await manager.saveProject({
			name: "Folder Song",
			music: "replacement.ogg",
			image: "replacement.png",
			activeChart: "hard",
			charts: [{ id: "hard", file: "hard.json", model: hard }],
		});
		assert.deepEqual((await readdir(directory)).sort(), [
			"hard.json", "keep-me.txt", "replacement.ogg", "replacement.png", PROJECT_FILENAME,
		].sort());
	} finally {
		if (previousNw === undefined) delete globalThis.nw;
		else globalThis.nw = previousNw;
		if (previousZip === undefined) delete globalThis.JSZip;
		else globalThis.JSZip = previousZip;
		if (previousReady === undefined) delete globalThis.sviberDependenciesReady;
		else globalThis.sviberDependenciesReady = previousReady;
		await rm(directory, { recursive: true, force: true });
	}
});
