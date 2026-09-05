import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tip-point connectors clip to the hidden-channel separator", async () => {
	const [drawing, markers] = await Promise.all([
		readFile(new URL("../js/render/timeline-drawing.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/timeline-markers.js", import.meta.url), "utf8"),
	]);
	assert.match(drawing, /laneY\(event\.channel\) \?\? baseY/);
	assert.match(markers, /original > left && original < right/);
	assert.match(markers, /layout\.channels\.y \+ \(lane \+ 1\) \* layout\.channelHeight/);
});
