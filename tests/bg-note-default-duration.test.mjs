import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("first bg note duration defaults to zero beats", async () => {
	const source = await readFile(new URL("../js/app/app-core.js", import.meta.url), "utf8");
	assert.match(source, /lastBgNoteDuration = \[0, 0, 1\]/);
	assert.match(source, /lastHoldDuration = \[1, 0, 1\]/);
});
