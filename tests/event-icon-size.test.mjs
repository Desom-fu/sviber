import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_PREFERENCES } from "../js/app/app-helpers.js";
import {
	DEFAULT_EVENT_ICON_RADIUS,
	drawTimelineEventIcon,
	durationTailWidth,
	eventIconRadius,
	eventIconScale,
	stackedEventLaneOffset,
	tipConnectorLineWidth,
	tipPointMarkerRadius,
	tipSpawnLineWidth,
} from "../js/render/timeline-helpers.js";

test("event icon size defaults to radius 8 and scales drawing", () => {
	assert.equal(DEFAULT_PREFERENCES.eventIconSize, 8);
	assert.equal(eventIconRadius({}), DEFAULT_EVENT_ICON_RADIUS);
	assert.equal(eventIconRadius({ eventIconSize: 12 }), 12);
	const calls = [];
	const context = {
		save() {},
		restore() {},
		beginPath() {},
		arc(x, y, radius) {
			calls.push(radius);
		},
		fill() {},
		fillText() {},
	};
	drawTimelineEventIcon(context, { type: "tap" }, 0, 0, "#fff", 12);
	assert.equal(calls[0], 12);
});

test("event icon size proportionally scales stacked offset, tip lines, tails, and markers", async () => {
	const prefs = { eventIconSize: 12 };
	assert.equal(eventIconScale(prefs), 12 / DEFAULT_EVENT_ICON_RADIUS);
	assert.equal(stackedEventLaneOffset(0, 2, prefs), -5.25);
	assert.equal(tipConnectorLineWidth(prefs), 7.5);
	assert.equal(tipSpawnLineWidth(prefs), 2.25);
	assert.equal(durationTailWidth("hold", prefs), 12);
	assert.equal(durationTailWidth("bgNote", prefs), 9);
	assert.equal(tipPointMarkerRadius(prefs), 6.75);
	const files = await Promise.all(
		[
			"js/render/timeline-drawing.js",
			"js/render/scroll-view.js",
			"js/render/chart-index.js",
			"js/render/chart-index-mutations.js",
			"js/render/chart-index-removal.js",
			"js/render/timeline.js",
		].map(path => readFile(new URL(`../${path}`, import.meta.url), "utf8")),
	);
	const [drawing, scroll, index, mutations, removal, timeline] = files;
	assert.match(drawing, /durationTailWidth\(/);
	assert.match(drawing, /tipConnectorLineWidth\(/);
	assert.match(drawing, /tipSpawnLineWidth\(/);
	assert.match(drawing, /eventIconScale\(/);
	assert.match(scroll, /durationTailWidth\(/);
	assert.match(scroll, /tipConnectorLineWidth\(/);
	assert.match(index, /stackedEventLaneOffset\(/);
	assert.match(mutations, /stackedEventLaneOffset\(/);
	assert.match(removal, /stackedEventLaneOffset\(/);
	assert.match(timeline, /stackedEventLaneOffset\(/);
	for (const source of files) {
		assert.doesNotMatch(source, /\* 7\)/);
		assert.doesNotMatch(source, /lineWidth = 5/);
		assert.doesNotMatch(source, /hold" \? 8 : 6/);
	}
});
