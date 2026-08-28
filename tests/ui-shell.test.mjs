import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EVENT_EDITING_MODULES, TIMELINE_MODULES, readSources } from "./module-source.mjs";

test("layout toggles preserve the stage grid slot when hiding a side", async () => {
	const [css, layout, editing, timeline] = await Promise.all([
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/ui-layout.js", import.meta.url), "utf8"),
		readSources(EVENT_EDITING_MODULES),
		readSources(TIMELINE_MODULES),
	]);
	assert.match(css, /\.editor-row\.is-scroll-hidden\s+#scroll-view-panel,[\s\S]*?visibility:\s*hidden/);
	assert.match(css, /\.editor-row\.is-side-hidden\s+\.side-panel[\s\S]*?pointer-events:\s*none/);
	assert.doesNotMatch(css, /\.editor-row\.is-scroll-hidden[^\{]*\{\s*display:\s*none/);
	assert.doesNotMatch(css, /\.render-surface:hover\s+\.edge-toggle/);
	assert.match(css, /\.stage-surface\.is-hovering-left-edge\s+\.edge-toggle-left/);
	assert.match(css, /\.stage-surface\.is-hovering-right-edge\s+\.edge-toggle-right/);
	assert.match(layout, /offset <= 28/);
	assert.match(layout, /offset >= bounds\.width - 28/);
	assert.match(editing, /this\.timeline\.requestRender\(\);\s*this\.scrollView\?\.requestRender\(\);/);
	assert.match(editing, /onTimelineResize: \(\) => this\.scrollView\?\.requestRender\(\)/);
	assert.match(timeline, /this\.callbacks\.onTimelineResize\?\.\(\)/);
});

test("UI uses icon controls, sliders, fullscreen, read-only macros, and PWA caching", async () => {
	const [index, styles, fields, core, shortcuts, macros, bridge, manifestText, worker, sandboxHtml] =
		await Promise.all([
		readFile(new URL("../index.html", import.meta.url), "utf8"),
		readFile(new URL("../css/app-v11.css", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/ui-fields.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-global-shortcuts.js", import.meta.url), "utf8"),
		readFile(new URL("../js/macro/macros.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-macro-bridge.js", import.meta.url), "utf8"),
		readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"),
		readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
		readFile(new URL("../macro-sandbox.html", import.meta.url), "utf8"),
	]);
	for (const id of [
		"lock-visible-range",
		"play-se",
		"seek-back-after-playing",
		"metronome",
		"read-only",
		"fullscreen",
	]) {
		assert.match(index, new RegExp(`id="${id}"[\\s\\S]*?<img`));
	}
	assert.match(styles, /\.status-option input:checked \+ img/);
	assert.match(fields, /input\.type = "range"/);
	assert.match(fields, /createElement\("output"\)/);
	assert.match(shortcuts, /event\.key === "F11"/);
	assert.match(core, /sviber-macro-read-only/);
	assert.match(macros, /if \(readOnly\)[\s\S]{0,120}?error\.readOnly/);
	assert.match(macros, /editor\.updateOptions\(\{ readOnly: !editable \}\)/);
	assert.match(bridge, /readOnly: Boolean\(app\.model\.editor\.readOnly\)/);
	const manifest = JSON.parse(manifestText);
	assert.equal(manifest.id, "./");
	assert.equal(manifest.display, "standalone");
	assert.match(worker, /json\/i18n\.en-US\.json/);
	assert.match(worker, /json\/i18n\.zh-CN\.json/);
	assert.match(worker, /js\/ui\/ui-layout\.js/);
	assert.match(worker, /js\/macro\/macro-sandbox\.bundle\.js/);
	assert.match(sandboxHtml, /macro-sandbox\.bundle\.js/);
});
