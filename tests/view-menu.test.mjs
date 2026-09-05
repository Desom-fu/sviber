import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";

test("View menu toggles panels and resets layout", () => {
	const view = MENU_DEFINITION.find(menu => menu.id === "view");
	assert.equal(view.mnemonic, "i");
	assert.deepEqual(
		view.items.filter(item => item.type === "command").map(item => item.command),
		["view.toggleTimeline", "view.toggleLeft", "view.toggleRight", "view.resetLayout"],
	);
	assert.ok(COMMAND_DEFINITIONS["view.resetLayout"]);
});
