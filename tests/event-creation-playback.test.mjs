import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMAND_DEFINITIONS } from "../js/app/commands.js";
import { toggledCreationMode } from "../js/app/app-event-tools.js";

test("creation-mode playback intercepts unmodified letter keys before shortcuts", async () => {
	assert.equal(COMMAND_DEFINITIONS["events.tap"].blockDuringPlayback, true);
	const [commands, pointer] = await Promise.all([
		readFile(new URL("../js/app/commands.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/stage-pointer.js", import.meta.url), "utf8"),
	]);
	assert.match(commands, /interceptCreationPlaybackKey/);
	assert.match(pointer, /onCreateEvent/);
	assert.doesNotMatch(pointer, /if \(context\.playing\) \{\s*return true;/);
});

test("creation-mode note placement ignores keydown repeats from long-press", async () => {
	const tools = await readFile(new URL("../js/app/app-event-tools.js", import.meta.url), "utf8");
	assert.match(tools, /isCreationPlaybackKey\(event\)/);
	assert.match(tools, /event\.repeat/);
	assert.match(tools, /Long-press keydown repeats must not place extra notes/);

	const traitSource = tools;
	assert.ok(traitSource.includes("if (event.repeat)"));
	assert.equal(toggledCreationMode("tap", "tap"), null);
	assert.equal(toggledCreationMode(null, "tap"), "tap");
});
