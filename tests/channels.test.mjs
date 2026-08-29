import assert from "node:assert/strict";
import test from "node:test";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { History } from "../js/core/history.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";

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

function makeDoubleTapHarness() {
	globalThis.document = { title: "", getElementById: () => null };
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "Lead", active: true },
			{ id: 1, name: "Second", active: true },
		],
	});
	// The harness keeps the trait's real refreshInteractionPreview so channel edits go
	// through the same rebuild branch as the live editor.
	const EditingApp = withHistoryCommands(
		withEventEditing(
			class {
				commit(label, mutation, options = {}) {
					return this._finishCommit(label, mutation, options, false);
				}

				_rebuildRenderIndex() {
					this.renderIndex = new ChartRenderIndex(this.model, this.model.timing, {});
					return this.renderIndex;
				}

				viewState() {
					return { renderIndex: this.renderIndex };
				}

				timeline = { setState() {}, requestRender() {} };

				stage = { setState() {}, requestRender() {} };

				_invalidatePlaybackSchedule() {}

				_normalizeGroupSelectionScope() {}

				refresh() {}

				requestStatusUpdate() {}

				syncActiveDifficultyState() {}

				broadcastLiveChartUpdate() {}

				registry = { notify() {}, notifyAll() {} };
			},
		),
	);
	const app = new EditingApp();
	app.model = model;
	app.history = new History(model.snapshot());
	app._rebuildRenderIndex();
	const describe = () => ({
		pairs: app.renderIndex.doubleTapPairs.map(pair => [pair.event1.id, pair.event2.id]),
		order: app.renderIndex.tapEventsByTime.get("4").map(event => [event.id, event.channel]),
	});
	return { model, app, describe };
}

test("changing a tap's channel updates the double-tap pairing order immediately", () => {
	const { model, app, describe } = makeDoubleTapHarness();
	const a = model.addEvent("tap", { time: [4, 0, 1], x: -40, y: 0, channel: 0 });
	const b = model.addEvent("tap", { time: [4, 0, 1], x: 40, y: 0, channel: 0 });
	const c = model.addEvent("tap", { time: [4, 0, 1], x: 0, y: 20, channel: 1 });
	app._rebuildRenderIndex();
	// Channel 0 sorts before channel 1, so the lines connect a-b and b-c.
	assert.deepEqual(describe(), {
		pairs: [
			[a.id, b.id],
			[b.id, c.id],
		],
		order: [
			[a.id, 0],
			[b.id, 0],
			[c.id, 1],
		],
	});
	// The inspector channel dropdown moves a to channel 1: b stays first on channel 0 and
	// the lines re-pair to b-a and a-c within the same edit.
	app.selectEvents([a.id], "replace");
	app.editSelectedProperty("channel", 1);
	assert.equal(model.findEvent(a.id).channel, 1);
	assert.deepEqual(describe().order, [
		[b.id, 0],
		[a.id, 1],
		[c.id, 1],
	]);
	assert.deepEqual(describe().pairs, [
		[b.id, a.id],
		[a.id, c.id],
	]);
	// The Ctrl+Shift+Arrow channel move sends b to channel 1 too; everything shares a
	// channel again and creation order rules.
	app.selectEvents([b.id], "replace");
	app.moveSelectedChannel(1);
	assert.equal(model.findEvent(b.id).channel, 1);
	assert.deepEqual(describe().order, [
		[a.id, 1],
		[b.id, 1],
		[c.id, 1],
	]);
	assert.deepEqual(describe().pairs, [
		[a.id, b.id],
		[b.id, c.id],
	]);
	// The timeline arrow-key channel delta moves c back to channel 0.
	app.selectEvents([c.id], "replace");
	app.moveEvents(0, -1, false);
	assert.equal(model.findEvent(c.id).channel, 0);
	assert.deepEqual(describe().order, [
		[c.id, 0],
		[a.id, 1],
		[b.id, 1],
	]);
	assert.deepEqual(describe().pairs, [
		[c.id, a.id],
		[a.id, b.id],
	]);
});
