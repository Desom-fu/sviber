import assert from "node:assert/strict";
import test from "node:test";

import { History, captureHistoryView } from "../js/core/history.js";

test("History view restores the snapped beat mode and visible time range between patches", () => {
	const base = {
		events: [],
		snappees: [], channels: [{ id: 0 }],
		editor: {
			timeSnapped: true, currentTime: [1, 0, 1], visibleRangeBeginning: 0,
			visibleRangeEnd: 10, currentChannel: 0,
		},
	};
	const history = new History(base);
	const first = { id: 1, type: "tap", time: [20, 0, 1], selected: true };
	const firstView = {
		...base,
		events: [first],
		editor: {
			timeSnapped: false, currentTime: 12.75, visibleRangeBeginning: 10,
			visibleRangeEnd: 20, currentChannel: 0,
		},
	};
	history.recordPatch({ kind: "appendRootEvent", event: first, nextEventId: 2,
		view: captureHistoryView(firstView, { selectedEventIds: [first.id] }) }, "Create first tap");
	const second = { id: 2, type: "tap", time: [30, 0, 1], selected: true };
	const secondView = {
		...firstView,
		events: [first, second],
		editor: {
			timeSnapped: true, currentTime: [30, 0, 1], visibleRangeBeginning: 25,
			visibleRangeEnd: 35, currentChannel: 0,
		},
	};
	history.recordPatch({ kind: "appendRootEvent", event: second, nextEventId: 3,
		view: captureHistoryView(secondView, { selectedEventIds: [second.id] }) }, "Create second tap");
	const restored = history.undo();
	assert.equal(restored.editor.timeSnapped, false);
	assert.equal(restored.editor.currentTime, 12.75);
	assert.equal(restored.editor.visibleRangeBeginning, 10);
	assert.equal(restored.editor.visibleRangeEnd, 20);
	assert.deepEqual(restored.events.map(event => event.id), [1]);
});
