import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("panel expansion uses more.svg", async () => {
	const [shared, clips] = await Promise.all([
		readFile(new URL("../js/ui/ui-shared.js", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/panel-clips.js", import.meta.url), "utf8"),
	]);
	assert.match(shared, /svg\/icons\/more\.svg/);
	assert.match(clips, /makeExpansionButton/);
});
