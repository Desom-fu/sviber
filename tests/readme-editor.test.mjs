import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("readme editor is a separate page with file edit and view menus", async () => {
	const html = await readFile(new URL("../readme.html", import.meta.url), "utf8");
	assert.match(html, /data-menu="file"/);
	assert.match(html, /data-menu="edit"/);
	assert.match(html, /data-menu="view"/);
	assert.match(html, /id="readme-preview"/);
	const script = await readFile(new URL("../js/readme/readme.js", import.meta.url), "utf8");
	assert.match(script, /needsDisplayTextFile/);
	assert.match(script, /marked/);
	assert.match(script, /DOMPurify|dompurify/);
});

test("readme editor reuses main chrome and follows theme", async () => {
	const [html, script, css] = await Promise.all([
		readFile(new URL("../readme.html", import.meta.url), "utf8"),
		readFile(new URL("../js/readme/readme.js", import.meta.url), "utf8"),
		readFile(new URL("../css/readme.css", import.meta.url), "utf8"),
	]);
	assert.match(html, /class="menu-bar"/);
	assert.match(html, /class="menu-root-button"/);
	assert.match(html, /data-mnemonic="F"/);
	assert.match(script, /appendMnemonic/);
	assert.match(script, /sviberTheme\?\.isDark\(\)/);
	assert.match(script, /sviber-theme-change/);
	assert.match(script, /file-list-item/);
	assert.match(css, /macros\.css/);
});
