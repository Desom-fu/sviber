import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";

test("select events at current time is bound to Z", () => {
	assert.equal(COMMAND_DEFINITIONS["edit.selectAtCurrentTime"].shortcut, "Z");
	const edit = MENU_DEFINITION.find(menu => menu.id === "edit");
	assert.ok(edit.items.some(item => item.command === "edit.selectAtCurrentTime"));
});

test("select-at-current-time command is registered against the current beat", async () => {
	const source = await readFile(new URL("../js/app/app-command-bindings.js", import.meta.url), "utf8");
	assert.match(source, /selectEventsAtCurrentTime/);
	assert.match(source, /Rational\.compare\(event\.time, current\) === 0/);
});
