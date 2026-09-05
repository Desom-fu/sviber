import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Alt drag on the scrollbar moves the visible-range center without seeking", async () => {
	const source = await readFile(new URL("../js/render/timeline-pointer.js", import.meta.url), "utf8");
	assert.match(source, /_scrollbarAltPan/);
	assert.match(source, /event\.altKey && !event\.ctrlKey/);
	assert.match(source, /onVisibleRange/);
	assert.doesNotMatch(source, /_scrollbarAltPan[\s\S]{0,400}onSeek/);
});
