import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { withChecks } from "../js/app/app-checks.js";
import { TimelineDrawingTrait } from "../js/render/timeline-drawing.js";
import { TimelineMarkersTrait } from "../js/render/timeline-markers.js";

// A chart with a few thousand events turns the whole-chart work in these paths into the frame
// budget itself: the checks scan is 100 ms+ of rule work, and both selection overlays used to
// flatten every event once per frame.

function explodingChart() {
	return new Proxy(
		{},
		{
			get() {
				throw new Error("the whole chart was walked");
			},
			ownKeys() {
				throw new Error("the whole chart was walked");
			},
		},
	);
}

test("automatic checks refreshes wait for a quiet moment instead of pumping after every edit", async () => {
	const app = new (withChecks(class {}))();
	app.checksPanel = {};
	let pumps = 0;
	app._pumpChecksRefresh = () => {
		pumps += 1;
	};
	for (let index = 0; index < 5; index += 1) {
		app._scheduleChecksRefresh();
	}
	assert.equal(pumps, 0, "a burst of edits starts no scan");
	assert.equal(app.checksRefreshToken, 5, "every edit still invalidates an in-flight scan");
	await new Promise(resolve => setTimeout(resolve, 600));
	assert.equal(pumps, 1, "the scan runs once the edits pause");
});

test("a frame with nothing selected draws no markers and never walks the chart", () => {
	const timeline = Object.assign(Object.create(TimelineMarkersTrait.prototype), {
		renderIndex: { selectedEvents: [] },
		channelOffset: 0,
		_visibleChannels: () => [],
		timing: { beatToSeconds: () => 0 },
	});
	const project = {
		channels: [],
		editor: { visibleRangeBeginning: 0, visibleRangeEnd: 1 },
		events: explodingChart(),
	};
	assert.equal(timeline._drawSelectedEventMarkers({}, {}, project), undefined);
});

test("the scrollbar draws its selected-event lines from the index, not from a fresh flatten", () => {
	const timeline = Object.assign(Object.create(TimelineDrawingTrait.prototype), {
		renderIndex: { selectedEvents: [{ id: 1, selected: true, locked: false, time: [1, 0, 1] }] },
		timing: { beatToSeconds: () => 1.5 },
		_scrollX: () => 42,
	});
	const points = [];
	const context = {
		beginPath: () => {},
		moveTo: (x, y) => points.push([x, y]),
		lineTo: (x, y) => points.push([x, y]),
		stroke: () => {},
		strokeStyle: "",
		lineWidth: 0,
	};
	const project = { channels: [], editor: {}, events: explodingChart() };
	timeline._drawSelectedEventScrollbarLines(context, { x: 0, y: 0, width: 100, height: 10 }, project, [0, 10]);
	assert.deepEqual(points, [
		[42, 1],
		[42, 9],
	]);
});

test("with nothing selected the scrollbar overlay returns before touching the chart", () => {
	const timeline = Object.assign(Object.create(TimelineDrawingTrait.prototype), {
		renderIndex: { selectedEvents: [] },
		timing: { beatToSeconds: () => 0 },
	});
	const project = { channels: [], editor: {}, events: explodingChart() };
	assert.equal(
		timeline._drawSelectedEventScrollbarLines({}, { x: 0, y: 0, width: 10, height: 10 }, project, [0, 1]),
		undefined,
	);
});

test("both selection overlays use the render index and precomputed channel positions", async () => {
	const [drawing, markers] = await Promise.all([
		readFile(new URL("../js/render/timeline-drawing.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/timeline-markers.js", import.meta.url), "utf8"),
	]);
	const earlyOut = /if \(index && !index\.selectedEvents\?\.length\) \{\s*return;\s*\}/;
	assert.match(drawing, earlyOut);
	assert.match(markers, earlyOut);
	assert.match(drawing, /index\?\.selectedEvents \|\| flattenEvents/);
	assert.match(markers, /const orderedPositions = new Map\(/);
	assert.match(markers, /const visiblePositions = new Map\(/);
	// The per-event channel scan is gone: positions come from the maps above.
	assert.doesNotMatch(markers, /const originalIndex = ordered\.findIndex\(/);
	assert.doesNotMatch(markers, /const visibleIndex = allVisible\.findIndex\(/);
});
