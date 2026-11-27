import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, CommandRegistry, MENU_DEFINITION } from "../js/app/commands.js";
import { withEventTools } from "../js/app/app-event-tools.js";
import { SPAWN_DIRECTIONS } from "../js/app/app-tip-point-modes.js";
import { ChartModel } from "../js/core/chart-model.js";
import { History } from "../js/core/history.js";

function createToolsHarness(model) {
	const App = withEventTools(class {});
	const app = new App();
	app.model = model;
	app.history = new History(model.snapshot());
	app.commit = (label, mutator) => {
		mutator(app.model);
		app.history.record(label, app.model.snapshot());
	};
	return app;
}

function keyEvent(key) {
	return {
		key,
		target: null,
		defaultPrevented: false,
		isComposing: false,
		ctrlKey: false,
		shiftKey: true,
		altKey: false,
		metaKey: false,
		repeat: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopImmediatePropagation() {},
	};
}

test("Events menu lists the four cardinal spawn directions while all eight shortcuts exist", () => {
	const eventsMenu = MENU_DEFINITION.find(menu => menu.id === "events");
	const items = eventsMenu.items;
	const commentIndex = items.findIndex(item => item.command === "events.comment");
	const groupIndex = items.findIndex(item => item.command === "events.group");
	assert.ok(commentIndex >= 0 && groupIndex > commentIndex);
	const between = items.slice(commentIndex + 1, groupIndex);
	assert.deepEqual(
		between.map(item => (item.type === "separator" ? "---" : item.command)),
		[
			"---",
			"events.spawnFromRight",
			"events.spawnFromAbove",
			"events.spawnFromLeft",
			"events.spawnFromBelow",
			"---",
		],
	);

	const expected = [
		["events.spawnFromRight", "^", 0, true],
		["events.spawnFromAboveRight", "(", Math.PI / 4, false],
		["events.spawnFromAbove", "*", Math.PI / 2, true],
		["events.spawnFromAboveLeft", "&", (3 * Math.PI) / 4, false],
		["events.spawnFromLeft", "$", Math.PI, true],
		["events.spawnFromBelowLeft", "!", (-3 * Math.PI) / 4, false],
		["events.spawnFromBelow", "@", -Math.PI / 2, true],
		["events.spawnFromBelowRight", "#", -Math.PI / 4, false],
	];
	assert.equal(SPAWN_DIRECTIONS.length, 8);
	const registry = new CommandRegistry(COMMAND_DEFINITIONS);
	const triggered = [];
	for (const [id, key, angle, inMenu] of expected) {
		assert.equal(COMMAND_DEFINITIONS[id].shortcut, key);
		assert.equal(items.some(item => item.command === id), inMenu);
		const entry = SPAWN_DIRECTIONS.find(item => item.id === id);
		assert.ok(entry);
		assert.equal(entry.angle, angle);
		registry.register(id, () => triggered.push(id));
		assert.equal(registry.handleKeyboard(keyEvent(key), {}), true, `Shortcut ${key} failed for ${id}`);
	}
	assert.deepEqual(triggered, expected.map(([id]) => id));
});

test("spawn direction commands update direct and inherited relative spawns and skip non-matching events", () => {
	const model = ChartModel.createDefault({
		channels: [
			{ id: 0, name: "Ch 1", active: true, tipPointSwitches: [{ time: [2, 0, 1], target: 1 }] },
			{ id: 1, name: "Ch 2", active: true, tipPointSwitches: [{ time: [2, 0, 1], target: 0 }] },
		],
	});
	const relativeDirect = model.addEvent("tap", {
		time: [1, 0, 1],
		channel: 0,
		x: 0,
		y: 0,
		tipPointSpawnType: "chain",
		tipPointSpawnAbsolutePosition: false,
		tipPointSpawnAngle: Math.PI / 2,
		selected: false,
	});
	const inheritedAcrossSwitch = model.addEvent("hold", {
		time: [3, 0, 1],
		duration: [1, 0, 1],
		channel: 1,
		x: 10,
		y: 0,
		tipPointSpawnType: "inherit",
		selected: true,
	});
	const absoluteNote = model.addEvent("tap", {
		time: [4, 0, 1],
		channel: 0,
		x: 20,
		y: 0,
		tipPointSpawnType: "drop",
		tipPointSpawnAbsolutePosition: true,
		tipPointSpawnX: 5,
		tipPointSpawnY: 5,
		selected: true,
	});
	const bgNote = model.addEvent("bgNote", {
		time: [5, 0, 1],
		channel: 0,
		x: 0,
		y: 0,
		selected: true,
	});
	const app = createToolsHarness(model);

	assert.equal(app.canSetSelectedSpawnDirection(), true);
	assert.equal(app.setSelectedSpawnDirection(Math.PI), true);
	// inheritedAcrossSwitch inherits from relativeDirect across the channel 0 <-> 1 switch at beat 2.
	assert.equal(relativeDirect.tipPointSpawnAngle, Math.PI);
	assert.equal(inheritedAcrossSwitch.tipPointSpawnType, "inherit");
	assert.equal(absoluteNote.tipPointSpawnAbsolutePosition, true);
	assert.equal(bgNote.tipPointSpawnAngle, undefined);

	// Selecting only absolute, none, or non-tip-pointable events grays out the commands.
	inheritedAcrossSwitch.selected = false;
	assert.equal(app.canSetSelectedSpawnDirection(), false);
	assert.equal(app.setSelectedSpawnDirection(0), false);
});

test("spawn direction commands work on grouped events and respect locked sources", () => {
	const model = ChartModel.createDefault();
	const lockedSource = model.addEvent("tap", {
		time: [1, 0, 1],
		channel: 0,
		x: 0,
		y: 0,
		tipPointSpawnType: "chain",
		tipPointSpawnAbsolutePosition: false,
		tipPointSpawnAngle: Math.PI / 2,
		locked: true,
		selected: false,
	});
	const childInherited = model.addEvent("tap", {
		time: [2, 0, 1],
		channel: 0,
		x: 10,
		y: 0,
		tipPointSpawnType: "inherit",
		selected: true,
	});
	const app = createToolsHarness(model);
	assert.equal(app.canSetSelectedSpawnDirection(), false);
	assert.equal(app.setSelectedSpawnDirection(-Math.PI / 2), false);
	assert.equal(lockedSource.tipPointSpawnAngle, Math.PI / 2);

	lockedSource.locked = false;
	const group = model.addEvent("group", {
		x: 0,
		y: 0,
		selected: true,
		events: [
			{
				id: 50,
				type: "flick",
				time: [3, 0, 1],
				channel: 1,
				x: 0,
				y: 0,
				tipPointSpawnType: "drop",
				tipPointSpawnAbsolutePosition: false,
				tipPointSpawnAngle: 0,
			},
		],
	});
	const groupedNote = group.events[0];
	childInherited.selected = false;
	assert.equal(app.canSetSelectedSpawnDirection(), true);
	assert.equal(app.setSelectedSpawnDirection(-Math.PI / 4), true);
	assert.equal(groupedNote.tipPointSpawnAngle, -Math.PI / 4);
});
