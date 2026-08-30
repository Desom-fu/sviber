import assert from "node:assert/strict";
import test from "node:test";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";

// The channels panel operations: duplicating copies every event into a new channel,
// moving up/down reorders without changing IDs or the current channel, and activating all
// channels reports whether anything changed.
function makeApp(model) {
	const App = withHistoryCommands(
		class {
			commit(label, mutation) {
				return mutation(this.model);
			}

			_syncAudioLoop() {}

			refreshInteractionPreview() {}
		},
	);
	const app = new App();
	app.model = model;
	app.audio = { playing: false };
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
