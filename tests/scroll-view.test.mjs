import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scrollPanTarget } from "../js/render/scroll-view.js";

test("Scroll view places current time exactly one quarter of its height from the bottom", async () => {
	const scrollSource = await readFile(new URL("../js/render/scroll-view.js", import.meta.url), "utf8");
	assert.match(scrollSource, /const baseline = height \* 0\.75/);
});

test("falling preview pans with the pointer and previews box selection", async () => {
	const [scrollView, core] = await Promise.all([
		readFile(new URL("../js/render/scroll-view.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-core.js", import.meta.url), "utf8"),
	]);
	assert.match(scrollView, /scrollPanTarget\(\s*this\.drag\.startSeconds,[\s\S]*?current\.y - this\.drag\.start\.y/);
	assert.match(scrollView, /return Number\(startSeconds\) \+ Number\(pointerDeltaY\)/);
	assert.match(
		scrollView,
		/onPreviewBoxSelect\?\.\([\s\S]{0,80}?#eventsInBox\(/,
	);
	assert.match(scrollView, /onBoxSelect\(ids, this\.drag\.mode\)/);
	assert.match(core, /onPreviewBoxSelect: \(ids, mode\) => this\.previewSelection\(ids, mode\)/);
	assert.match(core, /onBoxSelect: \(ids, mode\) => this\.finishSelectionPreview\(ids, mode\)/);
});

test("falling preview maps downward pointer motion to forward time", () => {
	assert.equal(scrollPanTarget(10, 25, 5), 15);
	assert.equal(scrollPanTarget(10, -25, 5), 5);
});

// v18 fix: the Scroll view and the checks panel share the left column as tabs. Hiding the
// inactive one with `visibility` alone left it occupying layout, so the two appeared stacked.
test("the inactive left-column panel takes no layout space", async () => {
	const styles = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
	assert.match(styles, /\.scroll-surface\.is-inactive \{[^}]*visibility:\s*hidden/);
	assert.match(styles, /\.scroll-surface\.is-inactive \{[^}]*pointer-events:\s*none/);
	// `content-visibility` skips painting without collapsing the element the WebGL renderer
	// sizes itself against, which `display: none` would.
	assert.match(styles, /\.scroll-surface\.is-inactive \{[^}]*content-visibility:\s*hidden/);
	assert.doesNotMatch(styles, /\.scroll-surface\.is-inactive \{[^}]*display:\s*none/);
	assert.match(styles, /\.checks-panel\[hidden\]/);
});
