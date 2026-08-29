import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, CommandRegistry } from "../js/app/commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { createEvent } from "../js/core/chart-events.js";

function chartWithEvents() {
	const model = ChartModel.createDefault();
	const unlocked = model.addEvent("tap", { time: [1, 0, 1], x: 0, y: 0, selected: true });
	const locked = model.addEvent("tap", { time: [2, 0, 1], x: 10, y: 0, selected: true, locked: true });
	return { model, unlocked, locked };
}

test("events carry a locked flag that defaults to false and survives normalization", () => {
	assert.equal(createEvent("tap", {}).locked, false);
	assert.equal(createEvent("tap", { locked: true }).locked, true);
	assert.equal(createEvent("group", { locked: true }).locked, true);
	const { model, locked } = chartWithEvents();
	const restored = ChartModel.import(JSON.parse(JSON.stringify(model.toJSON())));
	assert.equal(restored.findEvent(locked.id).locked, true);
});

test("groupSelected skips locked events", () => {
	const { model, unlocked, locked } = chartWithEvents();
	const group = model.groupSelected("#ff9d3d");
	assert.ok(group);
	const memberIds = group.events.map(event => event.id);
	assert.deepEqual(memberIds, [unlocked.id]);
	assert.equal(model.findEvent(locked.id).locked, true);
	assert.equal(model.events.some(event => event.id === locked.id), true);
});

test("groupSelected returns null when every selected event is locked", () => {
	const model = ChartModel.createDefault();
	model.addEvent("tap", { time: [1, 0, 1], selected: true, locked: true });
	assert.equal(model.groupSelected("#ff9d3d"), null);
});

test("ungroupSelected skips locked groups", () => {
	const model = ChartModel.createDefault();
	model.addEvent("tap", { time: [1, 0, 1], selected: true });
	const group = model.groupSelected("#ff9d3d");
	model.allEvents().forEach(event => {
		event.selected = event.id === group.id;
	});
	group.locked = true;
	model.ungroupSelected();
	assert.equal(model.findEvent(group.id)?.type, "group");
	group.locked = false;
	model.ungroupSelected();
	assert.equal(model.findEvent(group.id), null);
});

test("lock and unlock commands share Ctrl+L and sit in the events menu", () => {
	assert.equal(COMMAND_DEFINITIONS["events.lock"].shortcut, "Ctrl+L");
	assert.equal(COMMAND_DEFINITIONS["events.unlock"].shortcut, "Ctrl+L");
});

test("a disabled command does not shadow another command on the same shortcut", () => {
	const registry = new CommandRegistry();
	const fired = [];
	registry.register("events.lock", {
		action: () => fired.push("lock"),
		enabled: () => false,
	});
	registry.register("events.unlock", {
		action: () => fired.push("unlock"),
		enabled: () => true,
	});
	const event = {
		key: "l",
		ctrlKey: true,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		repeat: false,
		isComposing: false,
		preventDefault() {},
		stopImmediatePropagation() {},
	};
	assert.equal(registry.handleKeyboard(event, {}), true);
	assert.deepEqual(fired, ["unlock"]);
});
