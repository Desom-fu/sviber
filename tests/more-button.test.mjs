import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("panel expansion uses more.svg", async () => {
	const [lists, clips] = await Promise.all([
		readFile(new URL("../js/ui/panel-lists.js", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/panel-clips.js", import.meta.url), "utf8"),
	]);
	assert.match(lists, /svg\/icons\/more\.svg/);
	assert.match(clips, /svg\/icons\/more\.svg/);
});
