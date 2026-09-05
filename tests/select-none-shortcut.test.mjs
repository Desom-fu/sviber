import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS } from "../js/app/commands.js";

test("select none uses X instead of Ctrl+D", () => {
	assert.equal(COMMAND_DEFINITIONS["edit.selectNone"].shortcut, "X");
});
