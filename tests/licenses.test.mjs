import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("JavaScript license labels cover independent scripts with valid source links", async () => {
	const labels = await readFile(new URL("../javascript.html", import.meta.url), "utf8");
	assert.match(labels, /id="jslicense-labels1"/);
	for (const script of ["js/app/app.js", "js/boot/license-page.js", "service-worker.js", "docs/docs.js"]) {
		assert.match(labels, new RegExp(`href="${script.replace(".", "\\.")}"`));
	}
	assert.match(labels, /data-return-editor/);
	assert.doesNotMatch(labels, /\/blob\/master\//);
});
