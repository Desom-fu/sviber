import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_PREFERENCES, timelineRowHeight } from "../js/app/app-helpers.js";

test("layout fractions and channel height live in editor preferences", () => {
	assert.equal(DEFAULT_PREFERENCES.leftPanelWidthFraction, 0.14);
	assert.equal(DEFAULT_PREFERENCES.rightPanelWidthFraction, 0.22);
	assert.equal(DEFAULT_PREFERENCES.statusPanelWidthFraction, 0.22);
	assert.equal(DEFAULT_PREFERENCES.inspectorHeightFraction, 0.58);
	assert.equal(DEFAULT_PREFERENCES.timelineChannelHeight, 48);
	assert.equal(timelineRowHeight(DEFAULT_PREFERENCES, 10), 25 + 48 * (3 + 1));
	assert.equal(timelineRowHeight({ ...DEFAULT_PREFERENCES, visibleChannels: 5 }, 2), 25 + 48 * (2 + 1));
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
