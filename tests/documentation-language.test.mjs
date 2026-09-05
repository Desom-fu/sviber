import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("documentation language follows the editor query and does not persist widget changes", async () => {
	const source = await readFile(new URL("../docs/docs.js", import.meta.url), "utf8");
	assert.match(source, /URLSearchParams\(location\.search\)\.get\("lang"\)/);
	assert.doesNotMatch(source, /sviber\.documentationLanguage/);
});
