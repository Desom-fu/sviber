import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("selected snappee times are marked on the overview scrollbar", async () => {
	const source = await readFile(new URL("../js/render/timeline-markers.js", import.meta.url), "utf8");
	assert.match(source, /_drawSnappeeScrollbarMarks/);
	assert.match(source, /event\.attached/);
	assert.match(source, /snappee\.color/);
});
