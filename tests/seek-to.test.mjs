import assert from "node:assert/strict";
import test from "node:test";

import { visibleRangeAfterSeek } from "../js/core/seek-to.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";

test("Seek to keeps the playhead visually still when it is inside the visible range", () => {
	const followed = visibleRangeAfterSeek(
		{ visibleRangeBeginning: 10, visibleRangeEnd: 20, currentSeconds: 12 },
		22,
	);
	assert.equal(followed.beginning, 20);
	assert.equal(followed.ending, 30);
	const untouched = visibleRangeAfterSeek(
		{ visibleRangeBeginning: 10, visibleRangeEnd: 20, currentSeconds: 4 },
		22,
	);
	assert.equal(untouched.beginning, 10);
	assert.equal(untouched.ending, 20);
});

test("Seek to... is Music G and subdivisions live under Timing", () => {
	assert.equal(COMMAND_DEFINITIONS["music.seekTo"].shortcut, "G");
	const music = MENU_DEFINITION.find(menu => menu.id === "music");
	const timing = MENU_DEFINITION.find(menu => menu.id === "timing");
	assert.ok(music.items.some(item => item.command === "music.seekTo"));
	assert.ok(timing.items.some(item => item.command === "music.subdivision4"));
	assert.equal(COMMAND_DEFINITIONS["music.subdivisionOther"].shortcut, "0");
});
