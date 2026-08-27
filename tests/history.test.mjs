// Undo history behaviour: which records are worth keeping, how append, channel and remove
// patches avoid full snapshots, and how view records restore selection and panel order.
import test from "node:test";
import assert from "node:assert/strict";

import { History, captureHistoryView } from "../js/core/history.js";

test("History ignores no-op records and truncates redo branches", () => {
	const history = new History({ value: 0 });
	assert.equal(history.record({ value: 0 }, "No-op"), false);
	assert.equal(history.length, 1);

	assert.equal(history.push({ value: 1 }, "One"), true);
	assert.equal(history.record({ value: 2 }, "Two"), true);
	assert.deepEqual(history.undo(), { value: 1 });
	assert.equal(history.canRedo, true);
	assert.equal(history.record({ value: 3 }, "Three"), true);
	assert.equal(history.length, 3);
	assert.equal(history.canRedo, false);
	assert.deepEqual(history.current, { value: 3 });
	assert.deepEqual(
		history.entries.map(({ label }) => label),
		["Initial state", "One", "Three"],
	);
});

test("History transforms every snapshot without moving its cursor", () => {
	const history = new History({ value: 0, shared: "old" });
	history.record({ value: 1, shared: "old" }, "One");
	history.record({ value: 2, shared: "old" }, "Two");
	history.undo();
	const cursor = history.cursor;
	history.transformStates(state => ({ ...state, shared: "new" }));

	assert.equal(history.cursor, cursor);
	assert.deepEqual(history.getSnapshot(0), { value: 0, shared: "new" });
	assert.deepEqual(history.current, { value: 1, shared: "new" });
	assert.deepEqual(history.redo(), { value: 2, shared: "new" });
});

test("History retains only the latest 1000 snapshots", () => {
	const history = new History({ value: 0 });
	for (let value = 1; value <= 1100; value += 1) {
		history.record({ value }, `Commit ${value}`);
	}

	assert.equal(history.length, 1000);
	assert.deepEqual(history.getSnapshot(0), { value: 101 });
	assert.deepEqual(history.current, { value: 1100 });
	assert.equal(history.entries.at(-1).label, "Commit 1100");
});

test("History records manual and automatic save markers on the current entry", () => {
	const history = new History({ value: 0 });
	history.record({ value: 1 }, "Edit");
	history.markCurrent("autosave", 100);
	history.markCurrent("save", 200);
	assert.deepEqual(history.currentEntry.metadata.historyMarkers, { autosave: 100, save: 200 });
});

test("History view records overlay selection without storing another full snapshot", () => {
	const base = {
		events: [
			{ id: 1, type: "tap", selected: false },
			{ id: 2, type: "tap", selected: false },
		],
		snappees: [{ id: 7, selected: false, active: true }],
		editor: { currentTime: [0, 0, 1], currentChannel: 0 },
	};
	const history = new History(base);
	const selected = captureHistoryView({
		...base,
		events: [
			{ id: 1, type: "tap", selected: true },
			{ id: 2, type: "tap", selected: false },
		],
		snappees: [{ id: 7, selected: true, active: false }],
		editor: { currentTime: [1, 0, 1], currentChannel: 3, allowOutOfBound: true },
	});
	assert.equal(history.recordView(selected, "Selection"), true);
	assert.equal(history._entries.at(-1).state, null);
	assert.equal(history.current.events[0].selected, true);
	assert.equal(history.current.snappees[0].active, false);
	assert.deepEqual(history.current.editor.currentTime, [1, 0, 1]);
	assert.equal(history.recordView(selected, "Selection"), false);
	assert.equal(history.current.events[1].selected, false);
	assert.equal(history.undo().events[0].selected, false);
	assert.equal(history.redo().snappees[0].selected, true);
	assert.equal(history.current.editor.allowOutOfBound, true);
	history.record(
		{
			...base,
			events: [
				{ id: 1, type: "tap", selected: true, x: 4 },
				{ id: 2, type: "tap", selected: false },
			],
			snappees: [{ id: 7, selected: true, active: false }],
			editor: { currentTime: [1, 0, 1], currentChannel: 3 },
		},
		"Move",
	);
	assert.equal(history.current.events[0].x, 4);
	assert.equal(history.undo().events[0].x, undefined);
	assert.equal(history.current.events[0].selected, true);
});

test("History append patches retain sequential note creation without full snapshots", () => {
	const base = {
		events: [],
		snappees: [],
		channels: [{ id: 0 }],
		editor: { currentTime: [0, 0, 1], currentChannel: 0 },
		nextIds: { event: 0 },
	};
	const history = new History(base);
	for (let id = 0; id < 3; id += 1) {
		const event = { id, type: "tap", time: [id, 0, 1], channel: 0, x: id, y: 0, selected: true };
		history.recordPatch(
			{
				kind: "appendRootEvent",
				event,
				nextEventId: id + 1,
				view: captureHistoryView({ ...base, events: [event] }, { selectedEventIds: [id] }),
			},
			"Create tap",
		);
	}
	assert.deepEqual(
		history._entries.slice(1).map(entry => entry.state),
		[null, null, null],
	);
	assert.deepEqual(
		history.current.events.map(event => event.id),
		[0, 1, 2],
	);
	assert.equal(history.current.events.at(-1).selected, true);
	assert.deepEqual(
		history.undo().events.map(event => event.id),
		[0, 1],
	);
	assert.deepEqual(
		history.redo().events.map(event => event.id),
		[0, 1, 2],
	);
	assert.equal(history.current.nextIds.event, 3);
});

test("History channel patches insert channels without a full snapshot", () => {
	const base = {
		events: [],
		snappees: [],
		channels: [{ id: 0, name: "Channel 1" }],
		editor: { currentChannel: 0 },
		nextIds: { channel: 1 },
	};
	const history = new History(base);
	history.recordPatch(
		{
			kind: "addChannel",
			channel: { id: 1, name: "Channel 2", active: true },
			index: 1,
			nextChannelId: 2,
			view: { selectedEventIds: [], channelIds: [0, 1], currentChannel: 1 },
		},
		"Create channel",
	);
	assert.deepEqual(
		history.current.channels.map(channel => channel.id),
		[0, 1],
	);
	assert.equal(history.current.editor.currentChannel, 1);
	assert.equal(history.current.nextIds.channel, 2);
	assert.deepEqual(
		history.undo().channels.map(channel => channel.id),
		[0],
	);
	assert.deepEqual(
		history.redo().channels.map(channel => channel.id),
		[0, 1],
	);
});

test("History channel patches retain selection and support nested events", () => {
	const base = {
		events: [
			{ id: 1, type: "group", selected: true, events: [{ id: 2, type: "tap", channel: 0, selected: false }] },
		],
		snappees: [],
		channels: [{ id: 0 }, { id: 1 }],
		editor: { currentChannel: 0 },
		nextIds: {},
	};
	const history = new History(base);
	history.recordPatch({ kind: "setEventChannels", changes: [{ id: 2, channel: 1 }] }, "Move events");
	assert.equal(history.current.events[0].events[0].channel, 1);
	assert.equal(history.current.events[0].selected, true);
	assert.equal(history.current.events[0].events[0].selected, false);
	assert.equal(history.undo().events[0].events[0].channel, 0);
	assert.equal(history.redo().events[0].events[0].channel, 1);
});

test("History remove patches delete nested events and restore them on undo", () => {
	const base = {
		events: [
			{
				id: 1,
				type: "group",
				selected: false,
				events: [
					{ id: 2, type: "tap", channel: 0, selected: true },
					{ id: 3, type: "hold", channel: 0, selected: false },
				],
			},
			{ id: 4, type: "tap", channel: 0, selected: false },
		],
		snappees: [],
		channels: [{ id: 0 }],
		editor: { currentChannel: 0 },
		nextIds: { event: 5 },
	};
	const history = new History(base);
	history.recordPatch({ kind: "removeEvents", eventIds: [2], view: { selectedEventIds: [] } }, "Delete events");
	assert.deepEqual(
		history.current.events[0].events.map(event => event.id),
		[3],
	);
	assert.deepEqual(
		history.undo().events[0].events.map(event => event.id),
		[2, 3],
	);
	assert.deepEqual(
		history.redo().events[0].events.map(event => event.id),
		[3],
	);
});

test("History channel patches remove nested events and preserve the active view", () => {
	const base = {
		events: [
			{
				id: 1,
				type: "group",
				selected: false,
				events: [
					{ id: 2, type: "tap", channel: 7, selected: true },
					{ id: 3, type: "hold", channel: 8, selected: false },
				],
			},
			{ id: 4, type: "tap", channel: 8, selected: false },
		],
		snappees: [],
		channels: [{ id: 7 }, { id: 8 }],
		editor: { currentChannel: 8 },
		nextIds: {},
	};
	const history = new History(base);
	history.recordPatch(
		{ kind: "removeChannel", channelId: 7, view: { selectedEventIds: [], channelIds: [8], currentChannel: 8 } },
		"Delete channel",
	);
	assert.deepEqual(
		history.current.channels.map(channel => channel.id),
		[8],
	);
	assert.deepEqual(
		history.current.events.map(event => event.id),
		[1, 4],
	);
	assert.deepEqual(
		history.current.events[0].events.map(event => event.id),
		[3],
	);
	const restored = history.undo();
	assert.deepEqual(
		restored.channels.map(channel => channel.id),
		[7, 8],
	);
	assert.deepEqual(
		restored.events[0].events.map(event => event.id),
		[2, 3],
	);
	assert.deepEqual(
		history.redo().channels.map(channel => channel.id),
		[8],
	);
});

test("History materializes append patches before trimming their base snapshot", () => {
	const history = new History({ events: [], snappees: [], channels: [], editor: {}, nextIds: {} }, { limit: 3 });
	for (let id = 0; id < 4; id += 1) {
		history.recordPatch({
			kind: "appendRootEvent",
			event: { id, type: "tap" },
			nextEventId: id + 1,
			view: { selectedEventIds: [id] },
		});
	}
	assert.equal(history.length, 3);
	assert.deepEqual(
		history.current.events.map(event => event.id),
		[0, 1, 2, 3],
	);
	assert.deepEqual(
		history.undo().events.map(event => event.id),
		[0, 1, 2],
	);
});

test("History view records materialize when the retained window loses its base snapshot", () => {
	const history = new History(
		{
			events: [{ id: 1, type: "tap", selected: false }],
			snappees: [{ id: 1, selected: false, active: true }],
			editor: { currentChannel: 0 },
			value: 0,
		},
		{ limit: 3 },
	);
	history.recordView(
		captureHistoryView({
			events: [{ id: 1, type: "tap", selected: true }],
			snappees: [{ id: 1, selected: false, active: true }],
			editor: { currentChannel: 0 },
		}),
		"One",
	);
	history.recordView(
		captureHistoryView({
			events: [{ id: 1, type: "tap", selected: false }],
			snappees: [{ id: 1, selected: false, active: false }],
			editor: { currentChannel: 1 },
		}),
		"Two",
	);
	history.recordView(
		captureHistoryView({
			events: [{ id: 1, type: "tap", selected: true }],
			snappees: [{ id: 1, selected: true, active: false }],
			editor: { currentChannel: 2 },
		}),
		"Three",
	);
	assert.equal(history.length, 3);
	assert.notEqual(history._entries[0].state, null);
	assert.equal(history.getSnapshot(0).events[0].selected, true);
	assert.equal(history.current.editor.currentChannel, 2);
	assert.equal(history.current.snappees[0].selected, true);
	history.transformStates(state => {
		state.value = "kept";
		return state;
	});
	assert.equal(history.getSnapshot(0).value, "kept");
	assert.equal(history.current.events[0].selected, true);
});

test("History view records restore snappee and channel order", () => {
	const base = {
		events: [],
		snappees: [
			{ id: 1, selected: false, active: true },
			{ id: 2, selected: false, active: true },
		],
		channels: [
			{ id: 10, name: "A" },
			{ id: 20, name: "B" },
		],
		editor: { currentTime: [0, 0, 1], currentChannel: 10 },
	};
	const history = new History(base);
	assert.equal(
		history.recordView(
			captureHistoryView({
				...base,
				snappees: [base.snappees[1], base.snappees[0]],
				channels: [base.channels[1], base.channels[0]],
			}),
			"Reorder",
		),
		true,
	);
	assert.deepEqual(
		history.current.snappees.map(item => item.id),
		[2, 1],
	);
	assert.deepEqual(
		history.current.channels.map(item => item.id),
		[20, 10],
	);
	assert.deepEqual(
		history.undo().snappees.map(item => item.id),
		[1, 2],
	);
	assert.deepEqual(
		history.current.channels.map(item => item.id),
		[10, 20],
	);
});
