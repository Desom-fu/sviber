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
	const source = await readFile(new URL("../js/render/timeline.js", import.meta.url), "utf8");
	assert.match(source, /preferences\?\.visibleChannels/);
	assert.doesNotMatch(source, /channels\.length - 3/);
});
