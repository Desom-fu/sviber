import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser opens the manual in a tab and other tools as popups; NW.js remembers bounds", async () => {
	const [help, core, readme, bounds] = await Promise.all([
		readFile(new URL("../js/ui/help.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-readme-editor.js", import.meta.url), "utf8"),
		readFile(new URL("../js/platform/window-bounds.js", import.meta.url), "utf8"),
	]);
	assert.match(help, /window\.open\(url, "_blank"/);
	assert.match(core, /window\.open\(url, "sviber-macros", "popup/);
	assert.match(readme, /window\.open\(url, "sviber-readme", "popup/);
	assert.match(bounds, /rememberNwWindow/);
	assert.match(help, /rememberNwWindow\("docs"/);
});
