import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("channel panel names are gray when hidden, strikethrough when inactive, current highlighted", async () => {
	const [css, lists] = await Promise.all([
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/panel-lists.js", import.meta.url), "utf8"),
	]);
	assert.match(css, /\.channel-item\.is-hidden[\s\S]*color:\s*var\(--text-muted\)/);
	assert.match(css, /\.channel-item\.is-inactive[\s\S]*text-decoration:\s*line-through/);
	assert.match(lists, /selected:\s*channel\.id === model\.editor\.currentChannel/);
	assert.match(lists, /inactive:\s*channel\.active === false/);
	assert.match(lists, /is-hidden[\s\S]*channel\.hidden === true/);
});
