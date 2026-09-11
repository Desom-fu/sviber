import assert from "node:assert/strict";
import test from "node:test";
import { withChannelCommands } from "../js/app/app-channel-commands.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { readSource } from "./audit-contract-helpers.mjs";

// The channels panel operations: duplicating copies every event into a new channel,
// moving up/down reorders without changing IDs or the current channel, and activating all
// channels reports whether anything changed.
function makeApp(model) {
	const App = withChannelCommands(
		withHistoryCommands(
			class {
				commit(label, mutation) {
					return mutation(this.model);
				}

				_syncAudioLoop() {}

				refreshInteractionPreview() {}
			},
		),
	);
	const app = new App();
	app.model = model;
	app.audio = { playing: false };
	// selectChannel reveals the channel in the timeline; the other cases in this file never
	// reach that call, so the stub only needs the one method.
	app.timeline = { revealChannel() {} };
	return app;
}

function modelWithChannels() {
	return new ChartModel({
		channels: [
			{ id: 0, name: "Lead", active: true },
			{ id: 1, name: "Echo", active: true, hidden: true },
		],
		editor: { currentChannel: 0 },
		events: [
			{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0 },
			{
				id: 2,
				type: "group",
				channel: 0,
				x: 0,
				y: 0,
				events: [{ id: 3, type: "tap", channel: 0, time: [1, 0, 1], x: 5, y: 5 }],
			},
			{ id: 4, type: "tap", channel: 1, time: [2, 0, 1], x: 10, y: 0 },
		],
	});
}

test("duplicating a channel copies its events and hidden state", () => {
	const model = modelWithChannels();
	const app = makeApp(model);
	app.duplicateChannel(0);
	assert.deepEqual(
		model.channels.map(channel => channel.name),
		["Lead", "Lead 2", "Echo"],
	);
	const duplicate = model.channels[1];
	assert.equal(duplicate.id, 2);
	assert.equal(duplicate.name, "Lead 2");
	// The tap and the whole group are copied onto the new channel with fresh IDs; a
	// copied group carries no channel of its own, so it is found through its members.
	const copiedTap = model.events.find(event => event.type === "tap" && event.channel === 2);
	const copiedGroup = model.events.find(
		event => event.type === "group" && event.events.every(child => child.channel === 2),
	);
	assert.ok(copiedTap, "the tap is duplicated");
	assert.ok(copiedGroup, "the group is duplicated with its contents");
	assert.notEqual(copiedGroup.id, 2);
	assert.notEqual(copiedGroup.events[0].id, 3);
	assert.equal(copiedTap.selected, false);
	// Duplicating an active channel switches the current channel to the copy.
	assert.equal(model.editor.currentChannel, 2);
});

test("duplicating an inactive channel keeps the current channel", () => {
	const model = modelWithChannels();
	model.channels[1].active = false;
	const app = makeApp(model);
	app.duplicateChannel(1);
	assert.equal(model.editor.currentChannel, 0);
	assert.equal(model.channels[2].hidden, true);
	assert.equal(model.channels[2].active, false);
});

test("moving channels up and down reorders without renumbering IDs", () => {
	const model = modelWithChannels();
	const app = makeApp(model);
	app.moveChannel(1, -1);
	assert.deepEqual(
		model.channels.map(channel => channel.id),
		[1, 0],
	);
	assert.equal(model.editor.currentChannel, 0);
	// Moving past the edge is a no-operation.
	app.moveChannel(1, -1);
	assert.deepEqual(
		model.channels.map(channel => channel.id),
		[1, 0],
	);
});

test("activate all channels activates every channel", () => {
	const model = modelWithChannels();
	model.channels[1].active = false;
	const app = makeApp(model);
	assert.ok(app.activateAllChannels());
	assert.ok(model.channels.every(channel => channel.active === true));
	assert.equal(app.activateAllChannels(), false);
});

// v0.16.24: an inactive channel stays unselectable, while its row keeps the non-selection
// interactions — drag reorder (moveChannel), the expansion toggle and the eye button.
test("inactive channels stay unselectable but remain movable and toggleable", () => {
	const model = modelWithChannels();
	model.channels[1].active = false;
	const app = makeApp(model);
	assert.equal(app.selectChannel(1), false, "selecting an inactive channel is refused");
	assert.equal(model.editor.currentChannel, 0);
	assert.equal(app.selectChannel(0), true, "an active channel still selects");
	// The drag gesture goes through moveChannel, which must not care about the active flag.
	app.moveChannel(1, -1);
	assert.deepEqual(
		model.channels.map(channel => channel.name),
		["Echo", "Lead"],
	);
	// The eye button toggles the inactive channel back on without selecting it.
	app.toggleChannel(1);
	assert.equal(model.channels[0].active, true);
	assert.equal(model.editor.currentChannel, 0, "toggling does not select the channel");
});

test("the channel row gates selection but not reorder or its buttons", async () => {
	const source = await readSource("js/ui/panel-lists.js");
	// Selection stays behind the active guard...
	assert.match(
		source,
		/if \(channel\.active !== false\) \{\s*\n\s*this\.onSelect\(channel\.id\);/,
		"the row click handler must keep inactive channels unselectable",
	);
	// ...while reordering and the expansion button are registered unconditionally.
	assert.match(source, /bindItemReorder\(item, index, \(from, to\) => \{/);
	assert.match(source, /makeExpansionButton\(\s*\n\s*document,/);
});
