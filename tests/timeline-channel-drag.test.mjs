import assert from "node:assert/strict";
import test from "node:test";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { boundedVisibleChannelDelta } from "../js/app/app-event-move.js";
import { ChartModel } from "../js/core/chart-model.js";

function makePreviewApp(model) {
	const EditingApp = withEventEditing(
		class {
			preview(_label, mutation, options = {}) {
				if (!this.previewBase) {
					this.previewBase = this.model.snapshot();
					this.previewLabel = _label;
				}
				if (!options.incremental) {
					this.model.restore(this.previewBase);
				}
				mutation(this.model);
			}

			commit(_label, mutation) {
				if (this.previewBase) {
					this.model.restore(this.previewBase);
					this.previewBase = null;
				}
				mutation(this.model);
			}
		},
	);
	const app = new EditingApp();
	app.model = model;
	return app;
}

test("timeline channel deltas skip collapsed hidden channels", () => {
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "A", active: true },
			{ id: 1, name: "Hidden", active: true, hidden: true },
			{ id: 2, name: "B", active: true },
		],
		events: [{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true }],
	});
	assert.equal(boundedVisibleChannelDelta(model, model.events, 1), 1);
	const app = makePreviewApp(model);
	app._applyEventMove(model, [0, 0, 1], 1, false);
	assert.equal(model.events[0].channel, 2);
});

test("timeline drags refuse to land on a paused channel", () => {
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "A", active: true },
			{ id: 1, name: "Paused", active: false },
			{ id: 2, name: "B", active: true },
		],
		events: [{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true }],
	});
	assert.equal(boundedVisibleChannelDelta(model, model.events, 1), 0);
	assert.equal(boundedVisibleChannelDelta(model, model.events, 2), 2);
	const app = makePreviewApp(model);
	app._applyEventMove(model, [1, 0, 1], 1, false);
	assert.equal(model.events[0].channel, 0);
	assert.deepEqual(model.events[0].time, [1, 0, 1]);
});

test("previewing over a paused channel still hops to the next active lane", () => {
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "A", active: true },
			{ id: 1, name: "Paused", active: false },
			{ id: 2, name: "B", active: true },
		],
		events: [{ id: 1, type: "tap", channel: 0, time: [4, 0, 1], x: 0, y: 0, selected: true }],
	});
	const app = makePreviewApp(model);
	app.previewMoveEvents([0, 0, 1], 1, false);
	assert.equal(model.events[0].channel, 0, "hovering the paused lane must not move");
	app.previewMoveEvents([0, 0, 1], 2, false);
	assert.equal(model.events[0].channel, 2, "the next active lane must preview immediately");
	app.moveEvents([0, 0, 1], 2, false);
	assert.equal(model.events[0].channel, 2);
});
