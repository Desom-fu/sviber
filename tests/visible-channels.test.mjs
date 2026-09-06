import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_PREFERENCES, storePreferences } from "../js/app/app-helpers.js";

test("visible channels default to 3 and clamp to 1-16", () => {
	assert.equal(DEFAULT_PREFERENCES.visibleChannels, 3);
	const storage = {
		data: {},
		getItem(key) {
			return this.data[key] ?? null;
		},
		setItem(key, value) {
			this.data[key] = value;
		},
	};
	assert.equal(storePreferences({ visibleChannels: 8 }, storage).visibleChannels, 8);
	assert.equal(storePreferences({ visibleChannels: 99 }, storage).visibleChannels, 16);
	assert.equal(storePreferences({ visibleChannels: 0 }, storage).visibleChannels, 1);
});

test("timeline layout uses the visible-channels preference instead of a hardcoded 3", async () => {
	const [timeline, drawing, pointer] = await Promise.all([
		readFile(new URL("../js/render/timeline.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/timeline-drawing.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/timeline-pointer.js", import.meta.url), "utf8"),
	]);
	assert.match(timeline, /_visibleChannelLimit\(/);
	assert.match(timeline, /_maxChannelOffset\(/);
	assert.doesNotMatch(timeline, /length - 3/);
	assert.doesNotMatch(timeline, /channelOffset \+ 3/);
	assert.match(drawing, /_visibleChannelLimit\(/);
	assert.doesNotMatch(drawing, /channels\.length <= 3/);
	assert.doesNotMatch(drawing, /channels\.length - 3/);
	assert.match(pointer, /_visibleChannelLimit\(/);
	assert.doesNotMatch(pointer, /\.length > 3 && event\.shiftKey/);
});
