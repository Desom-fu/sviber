import assert from "node:assert/strict";
import test from "node:test";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";

test("deleting the current channel chooses a remaining active channel", () => {
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "Inactive above", active: false },
			{ id: 1, name: "Current", active: true },
			{ id: 2, name: "Active below", active: true },
		],
		editor: { currentChannel: 1 },
	});
	model.removeChannel(1);
	assert.equal(model.editor.currentChannel, 2);
});

test("event dragging cannot move selected events into an inactive channel", () => {
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "Active", active: true },
			{ id: 1, name: "Inactive", active: false },
		],
		events: [{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true }],
	});
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app._applyEventMove(model, [1, 0, 1], 1, false);
	assert.equal(model.events[0].channel, 0);
	assert.deepEqual(model.events[0].time, [1, 0, 1]);
});
