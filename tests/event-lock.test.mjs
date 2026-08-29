import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, CommandRegistry } from "../js/app/commands.js";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { createEvent } from "../js/core/chart-events.js";
import { withStageInteractions } from "../js/render/stage-interactions.js";

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

test("lock and unlock have distinct shortcuts and sit in the events menu", () => {
	assert.equal(COMMAND_DEFINITIONS["events.lock"].shortcut, "Ctrl+L");
	assert.equal(COMMAND_DEFINITIONS["events.unlock"].shortcut, "Ctrl+Shift+L");
});

test("a disabled command does not shadow another command on the same shortcut", () => {
	const registry = new CommandRegistry();
	const fired = [];
	registry.register("edit.pasteOptions", {
		action: () => fired.push("pasteOptions"),
		enabled: () => false,
	});
	registry.register("edit.pasteDuplicateSnappees", {
		action: () => fired.push("pasteDuplicateSnappees"),
		enabled: () => true,
	});
	const event = {
		key: "v",
		ctrlKey: true,
		shiftKey: true,
		altKey: false,
		metaKey: false,
		repeat: false,
		isComposing: false,
		preventDefault() {},
		stopImmediatePropagation() {},
	};
	assert.equal(registry.handleKeyboard(event, {}), true);
	assert.deepEqual(fired, ["pasteDuplicateSnappees"]);
});

test("pressing a locked event in the main field selects it but never starts a drag", () => {
	const InteractionApp = withStageInteractions(class {});
	const stage = new InteractionApp();
	const locked = { id: 7, type: "tap", selected: false, locked: true };
	const selections = [];
	stage.renderIndex = {
		selectionTarget: event => event,
		isEventSelected: event => Boolean(event.selected),
	};
	stage.callbacks = { onSelectEvents: (ids, mode) => selections.push([ids, mode]) };
	const drag = stage._eventPressDrag(
		{ ctrlKey: false, altKey: false },
		{ point: { x: 3, y: 4 }, project: { events: [locked] } },
		{ type: "event", event: locked, position: { x: 0, y: 0 } },
	);
	assert.equal(drag, null);
	assert.deepEqual(selections, [[[7], "replace"]]);

	const unlocked = { id: 8, type: "tap", selected: false, locked: false };
	const unlockedDrag = stage._eventPressDrag(
		{ ctrlKey: false, altKey: false },
		{ point: { x: 3, y: 4 }, project: { events: [unlocked] } },
		{ type: "event", event: unlocked, position: { x: 0, y: 0 } },
	);
	assert.equal(unlockedDrag.type, "event");
	assert.equal(unlockedDrag.hit.event.id, 8);
});

test("main-field position drags move only unlocked events", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.model = ChartModel.createDefault();
	const free = app.model.addEvent("tap", { time: [1, 0, 1], x: 0, y: 0, selected: true });
	const locked = app.model.addEvent("tap", { time: [2, 0, 1], x: 10, y: 0, selected: true, locked: true });
	app._applyPositionMove(app.model, free.id, { x: 40, y: 0 });
	assert.equal(app.model.findEvent(free.id).x, 40);
	assert.equal(app.model.findEvent(locked.id).x, 10);
	// Dragging the locked event itself moves nothing at all.
	app._applyPositionMove(app.model, locked.id, { x: 60, y: 0 });
	assert.equal(app.model.findEvent(locked.id).x, 10);
	assert.equal(app.model.findEvent(free.id).x, 40);
});

test("dragging a group by its event or anchor leaves locked descendants in place", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.model = ChartModel.createDefault();
	app.model.addEvent("tap", { time: [1, 0, 1], x: 0, y: 0, selected: true });
	const staying = app.model.addEvent("tap", { time: [2, 0, 1], x: 20, y: 0, selected: true });
	const group = app.model.groupSelected("#ff9d3d");
	assert.ok(group);
	// Grouping clones members, so lock the copy that lives inside the group.
	const stayingInGroup = app.model.findEvent(staying.id);
	assert.notEqual(stayingInGroup, staying);
	stayingInGroup.locked = true;
	app.model.allEvents().forEach(event => {
		event.selected = event.id === group.id;
	});
	// The group sits at the member average (10, 0); dragging its body to (60, 0) shifts the
	// group and its unlocked child by +50 while the locked child stays at x 20.
	app._applyPositionMove(app.model, group.id, { x: 60, y: 0 });
	assert.equal(app.model.findEvent(group.id).x, 60);
	assert.equal(app.model.findEvent(group.events[0].id).x, 50);
	assert.equal(app.model.findEvent(staying.id).x, 20);

	app.model.allEvents().forEach(event => {
		event.selected = event.id === group.id;
	});
	// The anchor drag only repositions the group event itself; children keep their spots.
	app._applyGroupAnchorMove(app.model, group.id, { x: 80, y: 0 });
	assert.equal(app.model.findEvent(group.id).x, 80);
	assert.equal(app.model.findEvent(group.events[0].id).x, 50);
	assert.equal(app.model.findEvent(staying.id).x, 20);

	// A locked group's anchor cannot be dragged either.
	group.locked = true;
	app.model.allEvents().forEach(event => {
		event.selected = event.id === group.id;
	});
	app._applyGroupAnchorMove(app.model, group.id, { x: 130, y: 0 });
	assert.equal(app.model.findEvent(group.id).x, 80);
});

