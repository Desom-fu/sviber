import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PREFERENCES } from "../js/app/app-helpers.js";
import { drawTimelineEventIcon, eventIconRadius } from "../js/render/timeline-helpers.js";

test("event icon size defaults to radius 8 and scales drawing", () => {
	assert.equal(DEFAULT_PREFERENCES.eventIconSize, 8);
	assert.equal(eventIconRadius({}), 8);
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
