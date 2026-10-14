import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scrollEventsInBox, scrollPanTarget } from "../js/render/scroll-view.js";

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
	assert.match(
		scrollView,
		/hideBackground = projectState\(this\.state\)\?\.editor\?\.showBgEventsInTimeline === false/,
	);
	assert.match(core, /onPreviewBoxSelect: \(ids, mode\) => this\.previewSelection\(ids, mode\)/);
	assert.match(core, /onBoxSelect: \(ids, mode\) => this\.finishSelectionPreview\(ids, mode\)/);
});

test("falling preview box selection skips hidden bg notes", () => {
	const records = [
		{ event: { id: 1, type: "tap" }, start: 10, position: { x: 0, y: 0 } },
		{ event: { id: 2, type: "bgNote" }, start: 10, position: { x: 10, y: 0 } },
		{ event: { id: 3, type: "hold" }, start: 10, position: { x: 20, y: 0 } },
	];
	const box = { x1: 0, y1: 0, x2: 400, y2: 400 };
	const toScreen = (x, time) => ({ x: x + 100, y: 200 - time * 10 });
	assert.deepEqual(scrollEventsInBox(records, box, { hideBackground: true, toScreen }), [1, 3]);
	assert.deepEqual(scrollEventsInBox(records, box, { hideBackground: false, toScreen }), [1, 2, 3]);
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
