import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STAGE_INTERACTION_MODULES, TIMELINE_MODULES, readSources } from "./module-source.mjs";
import { TOOLBAR_ITEMS } from "../js/app/commands.js";

test("toolbar and wheel routing keep main-field controls discoverable", async () => {
	assert.equal(TOOLBAR_ITEMS[TOOLBAR_ITEMS.indexOf("events.bpmChange") - 1], "separator");
	const [css, timeline] = await Promise.all([
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readSources(TIMELINE_MODULES),
	]);
	assert.match(css, /\.reset-main-field-view[^\{]*\{[^}]*border: 2px solid var\(--text\)/s);
	assert.match(timeline, /if \(event\.ctrlKey && event\.shiftKey\) \{[\s\S]*onMainFieldZoom/s);
});

test("global main-field zoom and live-hosting lifecycle follow the prompt", async () => {
	const [core, shortcuts, hosting, timeline, scrollView] = await Promise.all([
		readFile(new URL("../js/app/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-global-shortcuts.js", import.meta.url), "utf8"),
		readFile(new URL("../js/platform/live-hosting.js", import.meta.url), "utf8"),
		readSources(TIMELINE_MODULES),
		readFile(new URL("../js/render/scroll-view.js", import.meta.url), "utf8"),
	]);
	const wheel = shortcuts.slice(
		shortcuts.indexOf('"wheel",'),
		shortcuts.indexOf('"beforeunload"'),
	);
	assert.ok(wheel.indexOf("event.ctrlKey && event.shiftKey") < wheel.indexOf("closest("));
	assert.match(core, /onError: error =>\s*this\.toast\?\.error\("toast\.liveHostingFailed"/);
	assert.match(core, /onStop: \(\) => \{\s*this\.toast\?\.show\("toast\.liveHostingStopped"/);
	assert.match(hosting, /this\.#reportError\(error\)/);
	assert.match(hosting, /this\.onStop\(\)/);
	assert.match(timeline, /fillText\(line\.beat\.toString\(\)/);
	assert.match(scrollView, /text: line\.beat\.toString\(\)/);
});

test("keeps main-field pan when pointer capture is cancelled", async () => {
	const [core, interactions] = await Promise.all([
		readFile(new URL("../js/render/stage-core.js", import.meta.url), "utf8"),
		readSources(STAGE_INTERACTION_MODULES),
	]);
	assert.match(core, /releasePointerCapture\?\.\(event\.pointerId\)/);
	assert.match(interactions, /setPointerCapture\?\.\(event\.pointerId\)/);
	// A cancelled pan is dropped instead of being committed at the last known position.
	assert.match(interactions, /_commitPan\([\s\S]*?event\.type === "pointercancel"[\s\S]*?onMainFieldPan/);
});
