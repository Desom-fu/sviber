import assert from "node:assert/strict";
import test from "node:test";
import { scoreTempoGrid, timingFromTempoGrid } from "../js/dsp/tempo-grid.js";

function noveltyForSegments(segments, frameRate = 100, duration = 50) {
	const novelty = new Float64Array(Math.ceil(duration * frameRate));
	for (const { start, end, bpm } of segments) {
		const period = 60 / bpm;
		for (let time = start; time < end; time += period) {
			const index = Math.round(time * frameRate);
			if (index >= 0 && index < novelty.length) {
				novelty[index] = 1;
			}
		}
	}
	return novelty;
}

test("tempo grid scores the correct BPM and phase", () => {
	const novelty = noveltyForSegments([{ start: 0.2, end: 30, bpm: 120 }], 100, 30);
	const correct = scoreTempoGrid(novelty, 100, 120);
	const wrong = scoreTempoGrid(novelty, 100, 137);
	assert.ok(correct.score > wrong.score * 1.5);
	assert.ok(Math.abs(correct.phase - 0.2) < 0.03);
});

test("tempo grid accepts a half-tempo global estimate without inventing changes", () => {
	const novelty = noveltyForSegments([{ start: 0.2, end: 45, bpm: 120 }], 100, 45);
	const timing = timingFromTempoGrid(novelty, 100, 60);
	assert.ok(Math.abs(timing.initialBpm - 120) < 0.5);
	assert.equal(timing.bpmChanges.length, 0);
});

test("tempo grid reports a sustained tempo change in beat coordinates", () => {
	const novelty = noveltyForSegments(
		[
			{ start: 0.2, end: 20, bpm: 120 },
			{ start: 20.2, end: 35, bpm: 160 },
		],
		100,
	);
	const timing = timingFromTempoGrid(novelty, 100, 120, { minimumSegmentSeconds: 8 });
	assert.equal(timing.bpmChanges.length, 1);
	assert.ok(Math.abs(timing.bpmChanges[0].bpm - 160) < 1);
	assert.ok(Math.abs(timing.bpmChanges[0].time - 20) < 1);
	assert.ok(Math.abs(timing.bpmChanges[0].beat - 40) < 2);
});
