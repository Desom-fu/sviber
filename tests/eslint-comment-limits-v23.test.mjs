import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v23 ESLint line limits exclude comments", async () => {
	const source = await readFile(new URL("../eslint.config.mjs", import.meta.url), "utf8");
	assert.match(source, /"max-lines": \["error", \{[\s\S]*skipComments: true/);
	assert.match(source, /"max-lines-per-function": \["error", \{[\s\S]*skipComments: true/);
});
