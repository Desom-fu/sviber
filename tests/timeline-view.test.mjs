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
import { TimelinePointerTrait } from "../js/render/timeline-pointer.js";
import { readManual } from "./module-source.mjs";

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
	app.requestStatusUpdate = () => {};
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

test("timeline scrollbar blank track pages the visible range", () => {
	const app = scrollbarApp({ currentTime: [4, 0, 1], visibleRangeBeginning: 1, visibleRangeEnd: 3 });
	app.currentSeconds = () => 2;
	app.pageVisibleRange(1);
	assert.equal(app.model.editor.visibleRangeBeginning, 3);
	assert.equal(app.model.editor.visibleRangeEnd, 5);
	assert.deepEqual(app.model.editor.currentTime, [8, 0, 1]);

	const outside = scrollbarApp({ currentTime: [4, 0, 1], visibleRangeBeginning: 10, visibleRangeEnd: 12 });
	outside.currentSeconds = () => 2;
	outside.pageVisibleRange(1);
	assert.equal(outside.model.editor.visibleRangeBeginning, 12);
	assert.equal(outside.model.editor.visibleRangeEnd, 14);
	assert.deepEqual(outside.model.editor.currentTime, [4, 0, 1]);
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

// v22 fix: while playing, the armed follow offset used to slide the range back to its
// pre-zoom anchor on the next timeupdate, so the playhead's position inside the range
// jumped back after every zoom tick. The zoom must re-arm the offset instead.
test("timeline zoom during playback re-arms the follow offset to keep the playhead position", () => {
	const app = scrollbarApp({
		currentTime: 20,
		timeSnapped: false,
		visibleRangeBeginning: 0,
		visibleRangeEnd: 100,
	});
	app.audio = { playing: true, seek() {} };
	app.currentSeconds = () => 20;
	app.timeBounds = () => [0, 100];
	// Forward playback, playhead past the middle: follow keeps `time - beginning`.
	app.playFollowOffset = { direction: 1, value: 20 };
	app.navigateWheel(-1, true, true);
	assert.ok(Math.abs(app.model.editor.visibleRangeBeginning - 3.6) < 1e-9);
	assert.ok(Math.abs(app.model.editor.visibleRangeEnd - 85.6) < 1e-9);
	assert.ok(Math.abs(app.playFollowOffset.value - 16.4) < 1e-9);
	// Simulating the next playback frame: the playhead keeps its new offset.
	const forwardTime = 20.5;
	const forwardBeginning = forwardTime - app.playFollowOffset.value;
	assert.ok(Math.abs((forwardTime - forwardBeginning) - app.playFollowOffset.value) < 1e-9);

	// Reverse playback keeps `visibleRangeEnd - time` instead.
	app.model.editor.visibleRangeBeginning = 0;
	app.model.editor.visibleRangeEnd = 100;
	app.playFollowOffset = { direction: -1, value: 80 };
	app.navigateWheel(-1, true, true);
	assert.ok(Math.abs(app.playFollowOffset.value - 65.6) < 1e-9);

	// A disabled follow (bounds reached) must not be revived by zooming.
	app.model.editor.visibleRangeBeginning = 0;
	app.model.editor.visibleRangeEnd = 100;
	app.playFollowOffset = false;
	app.navigateWheel(-1, true, true);
	assert.equal(app.playFollowOffset, false);
});

test("timeline scrollbar blank track pages by one visible span", async () => {
	const source = await readSources(TIMELINE_MODULES);
	assert.match(source, /onPageVisibleRange\?\.\(-1\)/);
	assert.match(source, /onPageVisibleRange\?\.\(1\)/);
	assert.doesNotMatch(source, /_scrollSeek\(point\.x, hit, true\)/);
	const pointer = Object.create(TimelinePointerTrait.prototype);
	const directions = [];
	pointer.callbacks = { onPageVisibleRange: direction => directions.push(direction) };
	const hit = {
		type: "scroll-track",
		rectangle: { x: 0, width: 100 },
		bounds: [0, 100],
	};
	const project = { editor: { visibleRangeBeginning: 40, visibleRangeEnd: 60 } };
	pointer._scrollbarPressDrag({ ctrlKey: false }, { point: { x: 10 }, hit, project });
	pointer._scrollbarPressDrag({ ctrlKey: false }, { point: { x: 90 }, hit, project });
	assert.deepEqual(directions, [-1, 1]);
});

test("Ctrl-dragging the timeline scrollbar still seeks to the pointer", () => {
	const pointer = Object.create(TimelinePointerTrait.prototype);
	const beats = [];
	pointer.timing = {
		beatToSeconds: beat => Number(beat),
		secondsToSnappedBeat: seconds => ({ toJSON: () => [Math.round(seconds), 0, 1] }),
	};
	pointer.callbacks = {
		onSeekStart() {},
		onPreviewSeekBeat: beat => beats.push(beat),
	};
	pointer._scrollbarPressDrag(
		{ ctrlKey: true },
		{
			point: { x: 75 },
			hit: { type: "scroll-track", rectangle: { x: 0, width: 100 }, bounds: [0, 100] },
			project: {
				editor: {
					currentTime: [20, 0, 1],
					timeSnapped: true,
					subdivision: 1,
					visibleRangeBeginning: 10,
					visibleRangeEnd: 30,
				},
			},
		},
	);
	assert.deepEqual(beats, [[75, 0, 1]]);
});

test("the manuals document scrollbar paging, Ctrl seeking, and Page keys", async () => {
	const manual = await readManual();
	assert.match(manual, /overview track outside the green range bar pages the visible range/);
	assert.match(manual, /Ctrl<\/kbd>-clicking or dragging anywhere on the overview track/);
	assert.match(manual, /总览进度条上绿条以外的位置，会按点击方向把可见范围移动一个可见跨度/);
	assert.match(manual, /按住 <kbd>Ctrl<\/kbd> 在总览进度条任意位置点击或拖动/);
	assert.match(manual, /<kbd>PageUp<\/kbd>[\s\S]*?<kbd>PageDown<\/kbd>/);
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
	const manual = await readManual();
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

test("timeline rubber-band selection includes events outside the painted viewport", async () => {
	const pointer = await readFile(new URL("../js/render/timeline-pointer.js", import.meta.url), "utf8");
	const timeline = await readFile(new URL("../js/render/timeline.js", import.meta.url), "utf8");
	assert.match(timeline, /_contentLanePosition\(event, layout, project, offsets, record/);
	assert.match(pointer, /_idsInSelectionBox\(/);
	assert.match(pointer, /_boxSelectCenters\(/);
	assert.match(
		pointer,
		/_moveSelectionBox\([\s\S]*?_idsInSelectionBox\(this\.selectionBox, layout, projectState\(this\.state\)\)/,
	);
	assert.match(pointer, /drag\.type === "box"[\s\S]*?_idsInSelectionBox\(/);
	assert.doesNotMatch(
		pointer,
		/drag\.type === "box"[\s\S]*?this\.eventCenters\s*\.filter/,
	);
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

test("Alt+Shift drag in the channels moves the selection from the closest selected event", () => {
	const timeline = Object.create(TimelinePointerTrait.prototype);
	timeline.channelOffset = 0;
	timeline.renderIndex = {
		ancestorsById: new Map(),
		selectionTarget: event => event,
		isEventSelected: event => Boolean(event.selected),
	};
	const near = { id: 1, type: "tap", time: [4, 0, 1], channel: 0, selected: true };
	const far = { id: 2, type: "tap", time: [8, 0, 1], channel: 0, selected: true };
	const project = { channels: [{ id: 0, active: true }], events: [near, far], editor: { subdivision: 4 } };
	timeline.timing = {
		beatToSeconds: time => time[0] + time[1] / time[2],
		secondsToSnappedBeat: seconds => Rational.from([Math.round(seconds * 4), 4]),
	};
	timeline._timeToX = seconds => seconds * 10;
	const layout = {
		waveform: { height: 50 },
		channels: { y: 50, width: 800, height: 100 },
		scroll: { y: 150 },
		channelHeight: 50,
		visibleCount: 2,
	};
	const drag = timeline._timelineDrag(
		{ altKey: true, shiftKey: true, ctrlKey: false },
		{ point: { x: 800, y: 60 }, hit: { type: "event", event: near }, project, layout, playing: false },
	);
	assert.equal(drag.type, "event");
	// The press sits closest to the later event, so it governs the drag baseline even
	// though the pointer technically landed on the earlier event.
	assert.equal(drag.event.id, 2);
	assert.equal(drag.collapseSelectionOnClick, false);
	// v22: like the main field's Shift drag, the gesture is fully absolute in time and
	// channel and has no minimum drag distance.
	assert.equal(drag.absoluteBeatSnap, true);
	assert.equal(drag.absoluteChannel, true);
	assert.equal(drag.noThreshold, true);
	assert.equal(drag.governingLaneIndex, 0);

	// The move points at the position under the mouse: the governing event's beat follows
	// the snapped x, and the channel delta targets the lane under the pointer.
	timeline.state = project;
	timeline.drag = drag;
	timeline.pointerMoved = true;
	let preview = null;
	timeline.callbacks = { onPreviewMoveEvents: (delta, channelDelta) => (preview = [delta, channelDelta]) };
	timeline._xToSeconds = x => x / 10;
	timeline._moveEvents({ point: { x: 400, y: 120 }, project, layout, drag });
	// x 400 → 40 s → snapped beat 40, so the delta from beat 8 is 32; the pointer sits at
	// lane (120 − 50) / 50 = 1.4 → round 1, so the selection moves one lane down.
	assert.deepEqual(preview, [[32, 0, 1], 1]);

	// Any pointer movement counts — a sub-pixel move already applies for this gesture.
	timeline.surface = { toLocal: () => ({ x: 400.2, y: 120.1 }), width: 800, height: 200 };
	timeline._layout = () => layout;
	timeline.pointerMoved = false;
	preview = null;
	timeline._pointerMove({});
	assert.equal(timeline.pointerMoved, true);
	assert.ok(preview, "the sub-threshold movement previewed a move");

	// Without Alt the same press keeps its ordinary semantics (plain event drag on the hit).
	const plainDrag = timeline._timelineDrag(
		{ altKey: false, shiftKey: false, ctrlKey: false },
		{ point: { x: 800, y: 60 }, hit: { type: "event", event: near }, project, layout, playing: false },
	);
	assert.equal(plainDrag.type, "event");
	assert.equal(plainDrag.event.id, 1);
	assert.equal(plainDrag.noThreshold, undefined);
});

test("Ctrl+Alt enlarges every draggable handle and its hit box", async () => {
	const [timelineDrawing, stageOverlays, stageSnappees] = await Promise.all([
		readFile(new URL("../js/render/timeline-drawing.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/stage-overlays.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/stage-snappees.js", import.meta.url), "utf8"),
	]);
	assert.match(timelineDrawing, /this\.ctrlAltHeld \? 12 : 7/);
	assert.match(stageOverlays, /this\.ctrlAltHeld \? 17 : 10/);
	assert.match(stageOverlays, /this\.ctrlAltHeld \? 14 : 8/);
	assert.match(stageSnappees, /this\.ctrlAltHeld \? 9 : 5/);
});
