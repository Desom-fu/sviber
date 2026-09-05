import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_PREFERENCES, storePreferences } from "../js/app/app-helpers.js";

test("input offset is stored in editor preferences", () => {
	assert.equal(DEFAULT_PREFERENCES.inputOffset, 0);
	const storage = {
		data: {},
		getItem(key) {
			return this.data[key] ?? null;
		},
		setItem(key, value) {
			this.data[key] = value;
		},
	};
	assert.equal(storePreferences({ inputOffset: 0.042 }, storage).inputOffset, 0.042);
});

test("event creation during playback uses audio currentTime plus input offset", async () => {
	const tools = await readFile(new URL("../js/app/app-event-tools.js", import.meta.url), "utf8");
	assert.match(tools, /placementBeat/);
	assert.match(tools, /inputOffset/);
	assert.match(tools, /secondsToSnappedBeat/);
	assert.match(tools, /interceptCreationPlaybackKey/);
	assert.doesNotMatch(tools, /timeStamp/);
});
