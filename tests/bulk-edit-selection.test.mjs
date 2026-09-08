import assert from "node:assert/strict";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { bulkEditableSelectedEvents, eventTextsToString, stringToEventTexts } from "../js/core/bulk-edit-texts.js";

function modelWithSelection() {
	return new ChartModel({
		channels: [
			{ id: 0, name: "A" },
			{ id: 1, name: "B" },
		],
		editor: { currentChannel: 0 },
		events: [
			{ id: 1, type: "tap", channel: 0, time: [2, 0, 1], x: 0, y: 0, selected: true, text: "late" },
			{ id: 2, type: "bigText", channel: 1, time: [0, 0, 1], selected: true, text: "first" },
			{ id: 3, type: "bgNote", channel: 0, time: [1, 0, 1], selected: true, text: "middle", duration: [0, 1, 1] },
			{ id: 4, type: "comment", channel: 0, time: [0, 0, 1], selected: true, text: "ignored" },
			{ id: 5, type: "tap", channel: 1, time: [3, 0, 1], x: 5, y: 5, selected: false, text: "unselected" },
		],
	});
}

test("bulk edit by selection sorts textable events by time and then by channel", () => {
	const events = bulkEditableSelectedEvents(modelWithSelection());
	assert.deepEqual(
		events.map(event => event.id),
		[2, 3, 1],
		"time first (0, 1, 2 beats), then channel (A before B) for simultaneous events",
	);
});

test("bulk edit by selection excludes comments and unselected events", () => {
	const events = bulkEditableSelectedEvents(modelWithSelection());
	const types = events.map(event => event.type);
	assert.equal(types.includes("comment"), false);
	assert.equal(events.map(event => event.id).includes(5), false, "unselected events are not edited");
});

test("the combined string separates movable texts with spaces and unmovable with newlines", () => {
	const events = bulkEditableSelectedEvents(modelWithSelection());
	assert.equal(eventTextsToString(events), "first\nmiddle late");
});

test("texts are written back to the sorted sequence and escapes survive", () => {
	const model = modelWithSelection();
	const events = bulkEditableSelectedEvents(model);
	stringToEventTexts("first\\nmiddle la\\tte", events);
	assert.deepEqual(
		events.map(event => event.text),
		["first\nmiddle", "la\tte", ""],
		"the \\n escape stays inside one text instead of splitting it into two",
	);
	// The comment and the unselected tap keep their texts.
	assert.equal(model.findEvent(4).text, "ignored");
	assert.equal(model.findEvent(5).text, "unselected");
});
