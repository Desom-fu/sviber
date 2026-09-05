import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";
import { needsDisplayTextFile } from "../js/platform/platform-file-kinds.js";

test("Edit level readme is a desktop-only File menu item", () => {
	assert.equal(COMMAND_DEFINITIONS["file.editLevelReadme"].desktopOnly, true);
	const file = MENU_DEFINITION.find(menu => menu.id === "file");
	assert.ok(file.items.some(item => item.command === "file.editLevelReadme"));
});

test("readme filenames match Sunniesnow display-text files", () => {
	assert.equal(needsDisplayTextFile("README.md"), true);
	assert.equal(needsDisplayTextFile("LICENSE"), true);
	assert.equal(needsDisplayTextFile("notes.json"), false);
});

test("readme editor page exists as a separate webpage", async () => {
	const html = await readFile(new URL("../readme.html", import.meta.url), "utf8");
	assert.match(html, /js\/readme\/readme\.js/);
});
