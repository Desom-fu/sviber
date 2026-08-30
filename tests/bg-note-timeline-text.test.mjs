import assert from "node:assert/strict";
import test from "node:test";
import { drawTimelineEventIcon } from "../js/render/timeline-helpers.js";

function recordingContext() {
	const calls = [];
	return {
		calls,
		save() {},
		restore() {},
		beginPath() {},
		moveTo() {},
		lineTo() {},
		closePath() {},
		fill() {},
		stroke() {},
		arc() {},
		fillRect() {},
		translate() {},
		rotate() {},
		fillText(...args) {
			calls.push(args);
		},
	};
}

test("timeline bgNote icons draw their text inside the hexagon", () => {
	const context = recordingContext();
	drawTimelineEventIcon(context, { type: "bgNote", text: "墨点" }, 20, 30, "#ffffff");
	assert.deepEqual(context.calls, [["墨点", 20, 30]]);
});

test("timeline bgNote icons omit text when the event has no text", () => {
	const context = recordingContext();
	drawTimelineEventIcon(context, { type: "bgNote", text: "" }, 20, 30, "#ffffff");
	assert.equal(context.calls.length, 0);
});
