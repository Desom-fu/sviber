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
