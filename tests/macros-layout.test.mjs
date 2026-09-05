import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_PREFERENCES } from "../js/app/app-helpers.js";

test("macros layout fractions are stored in editor preferences", () => {
	assert.ok(DEFAULT_PREFERENCES.macrosSidebarWidthFraction > 0);
	assert.ok(DEFAULT_PREFERENCES.macrosConsoleHeightFraction > 0);
	assert.equal(DEFAULT_PREFERENCES.macrosConsoleHidden, false);
});

test("macros page has a View menu for console and reset", async () => {
	const html = await readFile(new URL("../macros.html", import.meta.url), "utf8");
	assert.match(html, /data-menu="view"/);
	assert.match(html, /data-action="toggle-console"/);
	assert.match(html, /data-action="reset-layout"/);
});

test("macros page reuses main menu/tab chrome and shared file list", async () => {
	const [html, script, css] = await Promise.all([
		readFile(new URL("../macros.html", import.meta.url), "utf8"),
		readFile(new URL("../js/macro/macros.js", import.meta.url), "utf8"),
		readFile(new URL("../css/macros.css", import.meta.url), "utf8"),
	]);
	assert.match(html, /class="menu-bar"/);
	assert.match(html, /class="side-tabs"/);
	assert.match(html, /class="side-tab/);
	assert.match(html, /data-mnemonic="R"/);
	assert.match(script, /appendMnemonic/);
	assert.match(script, /file-list-item/);
	assert.match(css, /shared-chrome\.css/);
	assert.match(css, /themes\.css/);
});
