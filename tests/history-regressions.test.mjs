import assert from "node:assert/strict";
import test from "node:test";

import { History, captureHistoryView } from "../js/core/history.js";
import { ChartModel } from "../js/core/chart-model.js";
import { withHistoryCommands } from "../js/app-history-commands.js";
import { withFreeTransform } from "../js/app-free-transform.js";

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

test("channel deactivation is a distinct history view so activate is recorded", () => {
	const base = {
		events: [],
		snappees: [],
		channels: [{ id: 0, name: "A" }, { id: 1, name: "B" }],
		editor: { currentChannel: 1, timeSnapped: true, currentTime: [0, 0, 1] },
	};
	const history = new History(base);
	const deactivated = {
		...base,
		channels: [{ id: 0, name: "A", active: false }, { id: 1, name: "B" }],
	};
	assert.equal(history.recordView(captureHistoryView(deactivated), "Deactivate"), true);
	assert.equal(history.current.channels[0].active, false);
	const reactivated = {
		...deactivated,
		channels: [{ id: 0, name: "A", active: true }, { id: 1, name: "B" }],
	};
	assert.equal(history.recordView(captureHistoryView(reactivated), "Activate"), true);
	assert.equal(history.current.channels[0].active, true);
	assert.equal(history.undo().channels[0].active, false);
	assert.equal(history.redo().channels[0].active, true);
});

test("toggleChannel can deactivate then activate the same channel", () => {
	const App = withHistoryCommands(withFreeTransform(class {
		commit(label, mutation, options = {}) {
			return this._finishCommit(label, mutation, options, false);
		}
		_invalidatePlaybackSchedule() {}
		_normalizeGroupSelectionScope() {}
		refresh() {}
		refreshInteractionPreview() {}
		requestStatusUpdate() {}
		syncActiveDifficultyState() {}
		broadcastLiveChartUpdate() {}
	}));
	App.prototype._refreshAfterCommit = function() {};
	const app = new App();
	app.model = ChartModel.createDefault({
		channels: [{ id: 0, name: "A" }, { id: 1, name: "B" }],
		editor: { currentChannel: 1 },
	});
	app.history = new History(app.model.snapshot());
	app.toggleChannel(0);
	assert.equal(app.model.channels[0].active, false);
	app.toggleChannel(0);
	assert.equal(app.model.channels[0].active, true);
});
