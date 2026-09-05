import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("channel snappee and clip rows support drag-and-drop reordering", async () => {
	const [lists, clips] = await Promise.all([
		readFile(new URL("../js/ui/panel-lists.js", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/panel-clips.js", import.meta.url), "utf8"),
	]);
	assert.match(lists, /bindItemReorder/);
	assert.match(lists, /item\.draggable = true/);
	assert.match(clips, /item\.draggable = true/);
	assert.match(clips, /onMove\(source, index - source\)/);
});
