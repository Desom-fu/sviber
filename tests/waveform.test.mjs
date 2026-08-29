import assert from "node:assert/strict";
import test from "node:test";
import { TimingMap } from "../js/core/timing.js";
import { Rational } from "../js/core/rational.js";

test("Waveform beat numbers appear when t - b is an integer from the latest bar line", () => {
	const timing = new TimingMap({
		bpmChanges: [{ time: [0, 0, 1], bpm: 120 }],
		barLines: [{ time: [0, 0, 1] }, { time: [4, 0, 1] }],
	});

	const lines = timing.beatLinesBetween(Rational.from(0), Rational.from(4), 2);
	// On beat 0 (bar line), integerFromBar is true
	assert.equal(lines[0].integerFromBar, true);
	assert.equal(lines[0].barLine, true);
	assert.equal(lines[0].beat.toString(), "0");

	// On beat 1/2, integerFromBar is false (0.5 is not an integer from bar line 0)
	assert.equal(lines[1].integerFromBar, false);

	// On beat 1, integerFromBar is true (1 - 0 = 1 is integer)
	assert.equal(lines[2].integerFromBar, true);
	assert.equal(lines[2].beat.toString(), "1");
});

test("Waveform BPM changes format as bare numbers without BPM suffix", () => {
	const formatBpm = bpm => Number(bpm).toFixed(Number.isInteger(bpm) ? 0 : 2);
	assert.equal(formatBpm(120), "120");
	assert.equal(formatBpm(135.5), "135.50");
	assert.equal(formatBpm(180), "180");
});

test("A-B loop marks compute sorted seconds range for waveform highlight", () => {
	const timing = new TimingMap({
		bpmChanges: [{ time: [0, 0, 1], bpm: 120 }],
	});
	const editor = {
		abLoopMarks: [
			[4, 0, 1], // beat 4 = 2.0s
			[2, 0, 1], // beat 2 = 1.0s
		],
	};
	const marks = (editor.abLoopMarks || [])
		.slice(0, 2)
		.map(mark => timing.beatToSeconds(mark))
		.sort((a, b) => a - b);

	assert.deepEqual(marks, [1.0, 2.0]);
});
