import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_PREFERENCES, inspectorHistoryFractions, timelineRowHeight } from "../js/app/app-helpers.js";

test("layout fractions and channel height live in editor preferences", () => {
	assert.equal(DEFAULT_PREFERENCES.leftPanelWidthFraction, 0.14);
	assert.equal(DEFAULT_PREFERENCES.rightPanelWidthFraction, 0.22);
	assert.equal(DEFAULT_PREFERENCES.statusPanelWidthFraction, 0.22);
	assert.equal(DEFAULT_PREFERENCES.inspectorHeightFraction, 0.58);
	assert.equal(DEFAULT_PREFERENCES.timelineChannelHeight, 48);
	assert.equal(timelineRowHeight(DEFAULT_PREFERENCES, 10), 25 + 48 * (3 + 1));
	assert.equal(timelineRowHeight({ ...DEFAULT_PREFERENCES, visibleChannels: 5 }, 2), 25 + 48 * (2 + 1));
});

test("inspector height fraction F maps to complementary history fraction 1-F", async () => {
	const mapped = inspectorHistoryFractions(0.58);
	assert.equal(Math.round(mapped.inspectorFr * 100), 58);
	assert.equal(Math.round(mapped.historyFr * 100), 42);
	assert.deepEqual(mapped, { inspectorFr: 0.58, historyFr: 0.42 });
	assert.deepEqual(inspectorHistoryFractions(0.85), { inspectorFr: 0.85, historyFr: 0.15 });
	const [css, layout] = await Promise.all([
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-layout.js", import.meta.url), "utf8"),
	]);
	assert.match(layout, /inspectorHistoryFractions\(/);
	assert.match(css, /minmax\(80px,\s*var\(--inspector-fraction/);
	assert.match(css, /minmax\(80px,\s*var\(--history-fraction/);
	assert.doesNotMatch(css, /minmax\(80px,\s*1fr\)/);
});

test("workspace exposes drag handles between the main panels", async () => {
	const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
	for (const id of [
		"layout-resize-left",
		"layout-resize-right",
		"layout-resize-status",
		"layout-resize-top",
		"layout-resize-inspector",
	]) {
		assert.match(index, new RegExp(`id="${id}"`));
	}
});
