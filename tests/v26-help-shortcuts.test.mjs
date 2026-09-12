import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";
import { readManual } from "./module-source.mjs";

test("help manuals and shortcuts document v26 menus and breaking macro names", async () => {
	const manual = await readManual();
	assert.match(manual, /Seek to/);
	assert.match(manual, /Bookmark/);
	assert.match(manual, /Spectrogram/);
	assert.match(manual, /perdurant/);
	assert.match(manual, /textable/);
	assert.doesNotMatch(manual, /have_duration\?/);
	assert.doesNotMatch(manual, /have_text\?/);
	assert.match(manual, /Chart\.metadata/);
	assert.match(manual, /inactive events and inactive channels/);
	assert.match(manual, /Example macros \(Ruby\)/);
	assert.equal(COMMAND_DEFINITIONS["music.seekTo"].shortcut, "G");
	assert.equal(COMMAND_DEFINITIONS["music.bookmark"].shortcut, "Shift+B");
	const timing = MENU_DEFINITION.find(menu => menu.id === "timing");
	const music = MENU_DEFINITION.find(menu => menu.id === "music");
	assert.ok(timing.items.some(item => item.command === "music.subdivision1"));
	assert.ok(music.items.some(item => item.command === "music.spectrogram"));
	const i18n = JSON.parse(await readFile(new URL("../json/i18n.en-US.json", import.meta.url), "utf8"));
	assert.equal(i18n["command.music.seekTo"], "Seek to...");
	assert.equal(i18n["command.music.bookmark"], "Bookmark...");
	assert.equal(i18n["command.music.spectrogram"], "Spectrogram...");
});
