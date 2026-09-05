import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_PREFERENCES, storePreferences } from "../js/app/app-helpers.js";
import {
	INPUT_OFFSET_BEAT_SECONDS,
	INPUT_OFFSET_METRONOME_BPM,
	averageInputOffsetSamples,
	closestMetronomeDelta,
	isInputOffsetSampleKey,
} from "../js/app/app-preferences-media.js";

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

test("input offset adjust uses AudioContext beats at 120 BPM and averages samples", async () => {
	assert.equal(INPUT_OFFSET_METRONOME_BPM, 120);
	assert.equal(INPUT_OFFSET_BEAT_SECONDS, 0.5);
	assert.ok(Math.abs(closestMetronomeDelta(1.02, 0.5, 0.5) - 0.02) < 1e-12);
	assert.ok(Math.abs(closestMetronomeDelta(0.9, 0.5, 0.5) + 0.1) < 1e-12);
	assert.ok(Math.abs(closestMetronomeDelta(0.74, 0.5, 0.5) - 0.24) < 1e-12);
	assert.ok(Math.abs(closestMetronomeDelta(0.76, 0.5, 0.5) + 0.24) < 1e-12);
	assert.ok(Math.abs(closestMetronomeDelta(0.75, 0.5, 0.5) + 0.25) < 1e-12);
	assert.equal(closestMetronomeDelta(1.0, Number.NaN, 0.5), 0);
	assert.ok(Math.abs(averageInputOffsetSamples([0.01, 0.03, -0.01]) - 0.01) < 1e-12);
	assert.equal(isInputOffsetSampleKey({ key: "a", repeat: false }), true);
	assert.equal(isInputOffsetSampleKey({ key: "a", repeat: true }), false);
	assert.equal(isInputOffsetSampleKey({ key: " ", repeat: false }), false);

	const prefs = await readFile(new URL("../js/app/app-preferences-media.js", import.meta.url), "utf8");
	assert.match(prefs, /inputOffsetAdjusting/);
	assert.match(prefs, /playMetronome\(0, when\)/);
	assert.match(prefs, /beatZero/);
	assert.match(prefs, /Math\.round\(\(audioTime - beatZero\) \/ beatSeconds\)/);
	assert.match(prefs, /previousDisabled/);
	assert.match(prefs, /_finishInputOffsetAdjust/);
	assert.doesNotMatch(prefs, /event\.timeStamp/);
	assert.match(prefs, /input\.disabled = true|control\.disabled = true/);
});
