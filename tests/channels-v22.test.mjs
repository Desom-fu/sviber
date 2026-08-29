// v22 regression tests: hidden channels, the timeline collapse, the panel popup menus,
// and reordering simultaneous events within a channel.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { withChannelCommands } from "../js/app/app-channel-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { History } from "../js/core/history.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";
import { TimelineView } from "../js/render/timeline.js";
import { visibleTimelineChannels } from "../js/render/timeline-helpers.js";
import { inheritedTipPointSource } from "../js/core/tip-point.js";

test("the channel hidden flag normalizes and survives serialization", () => {
	const model = ChartModel.createDefault({
		channels: [
			{ id: 0, name: "Shown", hidden: false },
			{ id: 1, name: "Hidden", hidden: true },
		],
	});
	assert.equal(model.channels[0].hidden, false);
	assert.equal(model.channels[1].hidden, true);
	const reopened = ChartModel.import(model.toJSON());
	assert.equal(reopened.channels[1].hidden, true);
	assert.equal(reopened.channels[0].hidden, false);
	// A missing flag defaults to shown.
	const plain = ChartModel.createDefault({ channels: [{ id: 0 }] });
	assert.equal(plain.channels[0].hidden, false);
});

test("hidden channels collapse out of the timeline lanes and the offset clamps", () => {
	const channels = [
		{ id: 0, name: "Hidden", hidden: true },
		{ id: 1, name: "Lead" },
		{ id: 2, name: "Second" },
		{ id: 3, name: "Also hidden", hidden: true },
		{ id: 4, name: "Fifth" },
		{ id: 5, name: "Sixth" },
	];
	const project = { channels };
	assert.deepEqual(visibleTimelineChannels(project).map(channel => channel.id), [1, 2, 4, 5]);
	const view = Object.create(TimelineView.prototype);
	view.channelOffset = 10;
	assert.deepEqual(view._visibleChannels(project).map(channel => channel.id), [2, 4, 5]);
	view.channelOffset = 0;
	assert.deepEqual(view._visibleChannels(project).map(channel => channel.id), [1, 2, 4]);
});

function makeChannelHarness() {
	globalThis.document = {
		title: "",
		getElementById: () => null,
		querySelector: () => null,
	};
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "Lead" },
			{ id: 1, name: "Second" },
			{ id: 2, name: "Third" },
		],
		editor: { currentChannel: 1 },
	});
	const App = withChannelCommands(
		withHistoryCommands(
			withEventEditing(
				class {
				commit(label, mutation, options = {}) {
					return this._finishCommit(label, mutation, options, false);
				}

				exitModes() {}

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
		),
	);
	const app = new App();
	app.model = model;
	app.history = new History(model.snapshot());
	app._rebuildRenderIndex();
	return { model, app };
}

test("hiding the current channel moves the current channel to a shown neighbour", () => {
	const { model, app } = makeChannelHarness();
	assert.equal(app.setChannelHidden(1, true), true);
	assert.equal(model.channels[1].hidden, true);
	// The same nearest-shown-neighbour rule as deactivating: above wins over below.
	assert.equal(model.editor.currentChannel, 0);
	assert.equal(app.showAllChannels(), true);
	assert.ok(model.channels.every(channel => channel.hidden === false));
	// Showing an already shown channel is a no-op.
	assert.equal(app.setChannelHidden(1, false), false);
});

test("creating a channel from a panel item anchors it to that channel", () => {
	const { model, app } = makeChannelHarness();
	app.createChannel(0, 2);
	const created = model.channels.find(channel => channel.name === "Channel 4");
	assert.ok(created, "the new channel exists");
	assert.equal(model.channels.indexOf(created), 2, "it sits directly above channel 2");
	assert.equal(model.editor.currentChannel, created.id);
});

test("move above within channel swaps each selected event over the unselected one above", () => {
	const { model, app } = makeChannelHarness();
	const ids = ["A", "B", "C", "D"].map((name, index) =>
		model.addEvent("tap", { time: [4, 0, 1], x: index * 10, y: 0, channel: 1 }).id,
	);
	const byId = new Map(model.events.map(event => [event.id, event]));
	// Restore the original ABCD stacking between the cases; every case starts from it.
	const reset = () => {
		model.events = ids.map(id => byId.get(id));
		model.events.forEach(event => (event.selected = false));
	};
	const order = () => model.events.map(event => event.id);
	const select = picked => model.events.forEach(event => (event.selected = picked.includes(event.id)));

	// Selecting B, C, and D makes BCDA.
	reset();
	select([ids[1], ids[2], ids[3]]);
	assert.equal(app.canMoveSelectedWithinChannel(-1), true);
	assert.equal(app.moveSelectedWithinChannel(-1), true);
	assert.deepEqual(order(), [ids[1], ids[2], ids[3], ids[0]]);

	// Selecting B and D makes BADC.
	reset();
	select([ids[1], ids[3]]);
	assert.equal(app.moveSelectedWithinChannel(-1), true);
	assert.deepEqual(order(), [ids[1], ids[0], ids[3], ids[2]]);

	// Selecting C and D makes ACDB.
	reset();
	select([ids[2], ids[3]]);
	assert.equal(app.moveSelectedWithinChannel(-1), true);
	assert.deepEqual(order(), [ids[0], ids[2], ids[3], ids[1]]);

	// Selecting the topmost event alone cannot move above.
	reset();
	select([ids[0]]);
	assert.equal(app.canMoveSelectedWithinChannel(-1), false);
	assert.equal(app.moveSelectedWithinChannel(-1), false);
	assert.deepEqual(order(), ids);

	// Moving below walks the group bottom-up: selecting A and B makes CABD.
	reset();
	select([ids[0], ids[1]]);
	assert.equal(app.moveSelectedWithinChannel(1), true);
	assert.deepEqual(order(), [ids[2], ids[0], ids[1], ids[3]]);
	assert.equal(app.history.canUndo, true);
});

test("tip point chains of simultaneous events follow the timeline stacking order", () => {
	const make = tipPointSpawnType => ({
		id: null,
		type: "tap",
		channel: 0,
		time: [4, 0, 1],
		tipPointSpawnType,
	});
	// Array order is the stacking order: the earlier event is stacked at the top.
	const top = make("chain");
	const bottom = make("chain");
	const events = [top, bottom];
	assert.equal(inheritedTipPointSource(events, bottom), top);
	// Nothing is stacked above the topmost event.
	assert.equal(inheritedTipPointSource(events, top), null);
});

test("the timeline paints the waveform separator and marks collapsed hidden channels", async () => {
	const drawing = await readFile(new URL("../js/render/timeline-drawing.js", import.meta.url), "utf8");
	// A dark gray line at the bottom of the waveform (the top edge of the channels area).
	assert.match(drawing, /_drawChannels\(context, layout, project\)/);
	assert.match(drawing, /Math\.round\(layout\.channels\.y\) \+ 0\.5/);
	// Separators over collapsed hidden channels become bright gray and thick.
	assert.match(drawing, /hiddenBetween \? "#d5dade" : "#34383d"/);
	assert.match(drawing, /hiddenBetween \? 2\.5 : 1/);
});

test("the panel items keep one primary action and hide the rest in a popup menu", async () => {
	const [lists, clips] = await Promise.all([
		readFile(new URL("../js/ui/panel-lists.js", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/panel-clips.js", import.meta.url), "utf8"),
	]);
	// Channels: activate/deactivate stays, the menu carries hide/show, create, and the rest.
	assert.match(lists, /makeItemMenuButton/);
	assert.match(lists, /icon: channel\.hidden === true \? "show-channel" : "hide-channel"/);
	assert.match(lists, /icon: "create-channel-above"/);
	assert.match(lists, /icon: "create-channel-below"/);
	assert.match(lists, /tooltipKey: "panel\.channel\.menu"/);
	// Only moving up/down keeps the menu open; everything else closes it.
	const keepOpenCount = lists.split("keepOpen: true").length - 1;
	assert.equal(keepOpenCount, 4);
	// Clips: pasting stays on the item, the rest hides in the menu.
	assert.match(clips, /this\.#action\("paste", "panel\.clip\.paste"/);
	assert.match(clips, /tooltipKey: "panel\.clip\.menu"/);
});
