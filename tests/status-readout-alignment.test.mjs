import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("status time beat and speed align left center and right", async () => {
	const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
	assert.match(css, /status-readouts[\s\S]*justify-content:\s*space-between/);
	assert.match(css, /status-item:first-child[\s\S]*margin-right:\s*auto/);
	assert.match(css, /status-item:nth-child\(2\)[\s\S]*margin-left:\s*auto/);
	assert.match(css, /status-item:last-child[\s\S]*margin-left:\s*auto/);
});
