import assert from "node:assert/strict";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import {
	BOOKMARK_LINE_COLOR,
	SCROLLBAR_OVERLAY_LAYERS,
	SELECTED_EVENT_LINE_LOCKED,
	SELECTED_EVENT_LINE_UNLOCKED,
	bookmarkOverlayTimes,
	selectedEventLineColor,
	selectedEventOverlayTimes,
} from "../js/core/scrollbar-overlays.js";
import { scrollbarNoteDensity, scrollbarRecordsForProject } from "../js/render/timeline-helpers.js";

test("scrollbar overlay z-order is heatmap, snappees, selected events, range, A-B/bookmarks, playhead", () => {
	assert.deepEqual(SCROLLBAR_OVERLAY_LAYERS, [
		"heatmap",
		"snappeeMarks",
		"selectedEventLines",
		"visibleRange",
		"abLoopAndBookmarks",
		"currentTime",
	]);
});

test("selected-event lines are bright red when unlocked and magenta when locked", () => {
	assert.equal(selectedEventLineColor({ locked: false }), SELECTED_EVENT_LINE_UNLOCKED);
	assert.equal(selectedEventLineColor({ locked: true }), SELECTED_EVENT_LINE_LOCKED);
	const marks = selectedEventOverlayTimes(
		[
			{ selected: true, locked: false, time: 1 },
			{ selected: true, locked: true, time: 2 },
			{ selected: false, locked: false, time: 3 },
		],
		event => event.time,
	);
	assert.deepEqual(
		marks.map(item => item.color),
		[SELECTED_EVENT_LINE_UNLOCKED, SELECTED_EVENT_LINE_LOCKED],
	);
});

test("bookmark overlay lines are bright orange", () => {
	assert.equal(BOOKMARK_LINE_COLOR, "#ff8c00");
	const marks = bookmarkOverlayTimes([{ time: [1, 0, 1] }], () => 1.5);
	assert.equal(marks[0].color, BOOKMARK_LINE_COLOR);
	assert.equal(marks[0].time, 1.5);
});

test("heatmap ignores inactive channels and inactive events", () => {
	const model = ChartModel.createDefault({
		channels: [
			{ id: 0, active: true },
			{ id: 1, active: false },
		],
		events: [
			{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, active: true },
			{ id: 2, type: "tap", time: [0, 0, 1], channel: 0, active: false },
			{ id: 3, type: "tap", time: [0, 0, 1], channel: 1, active: true },
			{ id: 4, type: "hold", time: [0, 1, 2], channel: 0, duration: [1, 0, 1] },
		],
	});
	const records = model.events.map(event => ({ event, start: event.time[0] + event.time[1] / event.time[2] }));
	const filtered = scrollbarRecordsForProject(records, model);
	assert.deepEqual(
		filtered.map(record => record.event.id),
		[1, 4],
	);
	const density = scrollbarNoteDensity(filtered, [0, 1], 1);
	assert.equal(density[0], 2);
});
