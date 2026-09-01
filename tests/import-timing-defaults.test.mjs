import assert from "node:assert/strict";
import test from "node:test";
import { importTimingDefaults } from "../js/app/app-preferences-media.js";

test("import timing defaults derive offset and BPM from the first two notes", () => {
	const defaults = importTimingDefaults({
		events: [
			{ type: "bgNote", time: 0.1 },
			{ type: "tap", time: 0.5 },
			{ type: "hold", time: 1.0 },
			{ type: "drag", time: 0.9 },
			{ type: "comment", time: 0.2 },
		],
	});
	assert.equal(defaults.offset, 0.5);
	assert.equal(defaults.initialBpm, 150);
});

test("import timing defaults accept file-format rational note times", () => {
	const defaults = importTimingDefaults({
		events: [
			{ type: "tap", time: [1, 1, 2] },
			{ type: "flick", time: [2, 0, 1] },
		],
	});
	assert.equal(defaults.offset, 1.5);
	assert.equal(defaults.initialBpm, 120);
});
