import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMAND_DEFINITIONS } from "../js/app/commands.js";
import {
	matchesCreationPlaybackKeyShape,
	toggledCreationMode,
} from "../js/app/app-event-tools.js";

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
	assert.match(tools, /isCreationPlaybackKeyEvent\(event\)/);
	assert.match(tools, /matchesCreationPlaybackKeyShape/);
	assert.match(tools, /event\.repeat/);
	assert.match(tools, /Long-press keydown repeats must not place extra notes/);
	assert.match(tools, /if \(!event\.repeat\)/);
	assert.match(tools, /placeCreationEventFromPointer/);

	assert.equal(
		matchesCreationPlaybackKeyShape({ key: "a", repeat: false }, "tap", true),
		true,
	);
	assert.equal(
		matchesCreationPlaybackKeyShape({ key: "a", repeat: true }, "tap", true),
		true,
		"shape matches on repeat so shortcuts stay suppressed",
	);
	assert.equal(
		matchesCreationPlaybackKeyShape({ key: "a", ctrlKey: true }, "tap", true),
		false,
	);
	assert.equal(
		matchesCreationPlaybackKeyShape({ key: "a" }, null, true),
		false,
	);
	assert.equal(
		matchesCreationPlaybackKeyShape({ key: "a" }, "tap", false),
		false,
	);

	assert.equal(toggledCreationMode("tap", "tap"), null);
	assert.equal(toggledCreationMode(null, "tap"), "tap");
});

test("creation preview is kept when the pointer leaves the stage", async () => {
	const pointer = await readFile(new URL("../js/render/stage-pointer.js", import.meta.url), "utf8");
	assert.match(pointer, /_pointerLeave\(\)/);
	assert.match(pointer, /Keep the last creation preview/);
	assert.match(pointer, /this\.pointerScreen = null/);
	// Must not clear creationPreview on leave (keyboard placement needs it).
	const leaveBody = pointer.slice(
		pointer.indexOf("_pointerLeave()"),
		pointer.indexOf("_capturePointer"),
	);
	assert.doesNotMatch(leaveBody, /this\.creationPreview = null/);
	assert.doesNotMatch(leaveBody, /onCreationPreview\?\.\(null\)/);
});
