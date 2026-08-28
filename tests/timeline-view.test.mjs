import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { TIMELINE_MODULES, readSources } from "./module-source.mjs";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { timelineTipConnector, timelineTipSegments, ZERO_DURATION_TYPES } from "../js/render/timeline-helpers.js";
import { AB_LOOP_GRAB_DISTANCE, abLoopDragMarks, abLoopGrabIndex } from "../js/render/timeline-gestures.js";
import { Rational } from "../js/core/rational.js";

function scrollbarApp(editor) {
	const App = withEventEditing(class {});
	const app = new App();
	app.model = ChartModel.createDefault({
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
		editor: { timeSnapped: true, subdivision: 4, ...editor },
	});
	app.timing = () => new TimingMap(app.model.timing);
	app.timeBounds = () => [0, 60];
	app.audio = { playing: false, seek() {} };
	app.timeline = { requestRender() {} };
	app.stage = { requestRender() {} };
	app.scrollView = { requestRender() {} };
	app.refreshInteractionPreview = () => {};
	return app;
}

test("timeline channel offset round-trips and clamps to visible channels", () => {
	const model = ChartModel.createDefault({
		channels: Array.from({ length: 8 }, (_, id) => ({ id, name: `Channel ${id + 1}` })),
		editor: { timelineChannelOffset: 5 },
	});
	assert.equal(model.editor.timelineChannelOffset, 5);
	const reopened = ChartModel.import(model.toJSON());
	assert.equal(reopened.editor.timelineChannelOffset, 5);
	const clamped = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }],
		editor: { timelineChannelOffset: 5 },
	});
	assert.equal(clamped.editor.timelineChannelOffset, 0);
});

test("timeline scrollbar track jump seeks current time and moves the visible range", () => {
	const app = scrollbarApp({ currentTime: [4, 0, 1], visibleRangeBeginning: 1, visibleRangeEnd: 3 });
	app.currentSeconds = () => 2;
	app.seekScrollbar(10);
	assert.equal(app.model.editor.visibleRangeBeginning, 9);
	assert.equal(app.model.editor.visibleRangeEnd, 11);
	assert.deepEqual(app.model.editor.currentTime, [20, 0, 1]);
});

test("timeline scrollbar track jump moves only the visible range when current time is outside it", () => {
	const app = scrollbarApp({ currentTime: [4, 0, 1], visibleRangeBeginning: 10, visibleRangeEnd: 12 });
	app.currentSeconds = () => 2;
	app.seekScrollbar(20);
	assert.equal(app.model.editor.visibleRangeBeginning, 19);
	assert.equal(app.model.editor.visibleRangeEnd, 21);
	assert.deepEqual(app.model.editor.currentTime, [4, 0, 1]);
});

test("timeline zoom keeps the visual position of the current time", () => {
	const App = withEventEditing(class {});
	const app = new App();
	app.model = ChartModel.createDefault({
		editor: {
			currentTime: [40, 0, 1],
			timeSnapped: true,
			subdivision: 4,
			visibleRangeBeginning: 0,
			visibleRangeEnd: 100,
		},
	});
	app.currentSeconds = () => 20;
	app.timeBounds = () => [0, 100];
	app.timeline = { requestRender() {} };
	app.stage = { requestRender() {} };
	app.scrollView = { requestRender() {} };
	app.requestStatusUpdate = () => {};
	app.navigateWheel(-1, true, true);
	// The current time sits one fifth into the range, so it stays one fifth into it.
	assert.ok(Math.abs(app.model.editor.visibleRangeBeginning - 3.6) < 1e-9);
	assert.ok(Math.abs(app.model.editor.visibleRangeEnd - 85.6) < 1e-9);
	app.model.editor.visibleRangeBeginning = 0;
	app.model.editor.visibleRangeEnd = 40;
	app.currentSeconds = () => 20;
	app.navigateWheel(-1, true, true);
	assert.ok(Math.abs((app.model.editor.visibleRangeBeginning + app.model.editor.visibleRangeEnd) / 2 - 20) < 1e-9);
	assert.ok(Math.abs(app.model.editor.visibleRangeEnd - app.model.editor.visibleRangeBeginning - 32.8) < 1e-9);
	// Outside the visible range the centre is preserved instead.
	app.model.editor.visibleRangeBeginning = 40;
	app.model.editor.visibleRangeEnd = 60;
	app.currentSeconds = () => 5;
	app.navigateWheel(-1, true, true);
	assert.ok(Math.abs((app.model.editor.visibleRangeBeginning + app.model.editor.visibleRangeEnd) / 2 - 50) < 1e-9);
});

test("timeline scrollbar track click jumps instead of paging", async () => {
	const source = await readSources(TIMELINE_MODULES);
	assert.match(source, /_scrollSeek\(point\.x, hit, true\)/);
	assert.match(source, /onScrollbarJump\?\.\(seconds\)/);
	assert.doesNotMatch(source, /onPageVisibleRange\?\.\(direction\)/);
});

test("timeline tip connector is fixed just beyond the largest event icon radius", () => {
	const connector = timelineTipConnector([
		{ time: 0, x: 0, y: 0 },
		{ time: 10, x: 1000, y: 0 },
	]);
	assert.equal(connector[0].time, 0);
	assert.equal(Math.hypot(connector[0].x - connector[1].x, connector[0].y - connector[1].y), 12);
});

test("timeline tip clipping only reads checkpoints around the visible time range", () => {
	const values = Array.from({ length: 10000 }, (_, index) => ({ time: index, x: index, y: 0 }));
	let reads = 0;
	const checkpoints = new Proxy(values, {
		get(target, property, receiver) {
			if (property !== "length") {
				reads += 1;
			}
			return Reflect.get(target, property, receiver);
		},
	});
	const segments = timelineTipSegments(checkpoints, 5000, 5002);
	assert.equal(segments.length, 4);
	assert.ok(reads < 100, `expected logarithmic clipping reads, got ${reads}`);
});

// v18 reworked the Shift-drag A-B loop gesture: a press away from the marks starts a new pair
// whose second mark only appears once the pointer reaches another subdivision, and a press on a
// mark moves that one while the other stays put.
test("Shift-drag on the waveform grabs a nearby A-B mark and otherwise starts a new pair", () => {
	const toX = seconds => seconds * 100;
	assert.equal(abLoopGrabIndex([1, 3], 100, toX), 0);
	assert.equal(abLoopGrabIndex([1, 3], 304, toX), 1);
	assert.equal(abLoopGrabIndex([1, 3], 150, toX), null);
	// The closer mark wins when both are inside the tolerance.
	assert.equal(abLoopGrabIndex([1, 1.04], 103, toX), 1);
	assert.equal(AB_LOOP_GRAB_DISTANCE, 6);
});

test("A-B loop drag marks collapse to one mark and stay ordered when the mark passes the other", () => {
	const anchor = Rational.from(4);
	// Before the pointer reaches another subdivision there is only the anchor.
	assert.deepEqual(abLoopDragMarks(anchor, Rational.from(4)), [Rational.from(4).toJSON()]);
	assert.deepEqual(abLoopDragMarks(anchor, Rational.from(6)), [
		Rational.from(4).toJSON(),
		Rational.from(6).toJSON(),
	]);
	// The moving mark may pass the anchor; the result is still A before B.
	assert.deepEqual(abLoopDragMarks(anchor, Rational.from(1)), [
		Rational.from(1).toJSON(),
		Rational.from(4).toJSON(),
	]);
	// Grabbing the only existing mark leaves no anchor, so the drag keeps a single mark.
	assert.deepEqual(abLoopDragMarks(null, Rational.from(2)), [Rational.from(2).toJSON()]);
	assert.deepEqual(abLoopDragMarks(null, null), []);
});

test("the waveform Shift-drag handlers keep the anchor and chase the visible range", async () => {
	const pointer = await readSources(["../js/render/timeline-pointer.js"]);
	// The press decides the anchor once; grabbing keeps the mark that was not grabbed.
	assert.match(pointer, /_abLoopPointerDown\(point, project, layout, seconds\)/);
	assert.match(pointer, /grabbed == null \? beat : \(existing\.find\(\(_, index\) => index !== grabbed\) \?\? null\)/);
	assert.match(pointer, /type: "ab-loop"[\s\S]*?anchorBeat: anchor/);
	// The move handler re-snaps, re-derives the pair from the same anchor, and chases the view.
	assert.match(pointer, /_moveAbLoop\(\{ point, project, layout, drag \}\)[\s\S]*?secondsToSnappedBeat/);
	assert.match(pointer, /_moveAbLoop[\s\S]*?abLoopDragMarks\(drag\.anchorBeat, beat\)[\s\S]*?_chaseVisibleRange/);
	// The release commits with `true` so history records one entry for the whole gesture.
	assert.match(pointer, /abLoopDragMarks\(drag\.anchorBeat, movingBeat\), true\)/);
});

test("the manual documents the v18 A-B drag, volume ceiling, and saved clips and checks", async () => {
	const manual = await readSources(["../docs/index.html"]);
	assert.match(manual, /within six pixels\) moves that mark instead and keeps the other one fixed/);
	assert.match(manual, /releasing on the other mark's subdivision leaves a single mark/);
	assert.match(manual, /六像素内）按下则改为移动该标记/);
	assert.match(manual, /SE volume and music volume both default to 1 and use a range slider from 0 to 2/);
	assert.match(manual, /音效音量和音乐音量都使用 0 到 2 的滑块/);
	assert.match(manual, /snappees, events, <code>clips<\/code>, <code>checks<\/code>, editor state/);
	assert.match(manual, /<code>fingers<\/code> for <code>requiredFingers<\/code>/);
	assert.doesNotMatch(manual, /music volume defaults to 1 and uses a range slider from 0 to 1/);
	assert.doesNotMatch(manual, /clears A-B marks and creates marks at mouse down and mouse up/);
});

test("timeline drawing reuses indexed lane offsets and selected groups during playback", async () => {
	const source = await readSources(["../js/render/timeline-drawing.js"]);
	assert.match(source, /this\.renderIndex\?\.eventLaneOffsets/);
	assert.match(source, /this\.renderIndex\?\.selectedRootGroups/);
	assert.match(source, /_drawTipPointLines[\s\S]*this\.renderIndex\?\.eventLaneOffsets/);
});

test("timeline rubber-band selection keeps its origin in content space while chasing", async () => {
	const pointer = await readFile(new URL("../js/render/timeline-pointer.js", import.meta.url), "utf8");
	// Press stores the chart-space corner, not just the viewport pixel.
	assert.match(pointer, /type: "box"[\s\S]*?startSeconds:[\s\S]*?startChannelIndex:/);
	// Move remaps that corner after chase so the rubber-band vertex follows the scroll.
	assert.match(
		pointer,
		/_moveSelectionBox\([\s\S]*?_chaseVisibleRange[\s\S]*?_chaseChannels[\s\S]*?_selectionBoxOrigin/,
	);
	assert.match(pointer, /_selectionBoxOrigin\(drag, layout\)/);
	assert.match(pointer, /_timeToX\(startSeconds, layout\.channels\.width\)/);
	assert.match(pointer, /startChannelIndex - this\.channelOffset/);
	// Release also uses the remapped origin, not the stale press pixel.
	assert.match(pointer, /drag\.type === "box"[\s\S]*?_selectionBoxOrigin\(drag, layout\)/);
});

test("timeline duration drag allows zero length only for bgNote and comment", async () => {
	assert.equal(ZERO_DURATION_TYPES.has("bgNote"), true);
	assert.equal(ZERO_DURATION_TYPES.has("comment"), true);
	assert.equal(ZERO_DURATION_TYPES.has("hold"), false);
	const pointer = await readFile(new URL("../js/render/timeline-pointer.js", import.meta.url), "utf8");
	assert.match(pointer, /ZERO_DURATION_TYPES/);
	assert.match(pointer, /from "\.\/timeline-helpers\.js"/);
	// Runtime binding: the pointer module must import the set, not rely on a sibling file const.
	assert.match(pointer, /ZERO_DURATION_TYPES[,\s].*projectState|projectState.*ZERO_DURATION_TYPES/);
	const source = await readSources(TIMELINE_MODULES);
	assert.match(source, /comparison === 0 && !ZERO_DURATION_TYPES\.has\(record\.event\.type\)/);
});
