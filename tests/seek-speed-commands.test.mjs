import assert from "node:assert/strict";
import test from "node:test";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";

// The Music menu's seeking and rate commands: seek to start snaps and keeps the visible
// range on the target, seek by seconds clamps to the music bounds and snaps when stopped,
// subdivision changes re-snap the current time, and the playback rate never leaves its
// documented 0.1..4 clamp.
function makeApp(model) {
	const App = withHistoryCommands(
		class {
			commit(label, mutation) {
				return mutation(this.model);
			}

			_syncAudioLoop() {}

			refreshInteractionPreview() {}

			_syncCheckedCommands() {}

			timeBounds() {
				return [0, 60];
			}

			timing() {
				return this.model.timing;
			}

			currentBeat() {
				return Rational.from(this.model.editor.currentTime);
			}

			currentSeconds() {
				return this.model.timing.beatToSeconds(Rational.from(this.model.editor.currentTime));
			}

			seekBeat(beat) {
				this.model.editor.currentTime = beat;
				this.model.editor.timeSnapped = true;
			}

			setVisibleRange(beginning, end) {
				this.model.editor.visibleRangeBeginning = beginning;
				this.model.editor.visibleRangeEnd = end;
			}
		},
	);
	const app = new App();
	app.model = model;
	app.audio = { playing: false, seek() {}, setRate() {} };
	return app;
}

function modelAt(beat) {
	return new ChartModel({
		editor: {
			currentTime: beat,
			visibleRangeBeginning: 5,
			visibleRangeEnd: 15,
		},
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
	});
}

test("seek to start snaps the current time and moves the visible range onto it", () => {
	const model = modelAt([9, 0, 1]);
	const app = makeApp(model);
	app.seekStart();
	assert.deepEqual(model.editor.currentTime, [0, 0, 1]);
	assert.equal(model.editor.visibleRangeBeginning, 0);
	assert.equal(model.editor.visibleRangeEnd, 10);
});

test("seek forward and backward by 3 s clamps to the music bounds and snaps", () => {
	const model = modelAt([1, 0, 1]);
	const app = makeApp(model);
	// 120 BPM means 3 s is exactly 6 beats.
	app.seekSeconds(3);
	assert.deepEqual(model.editor.currentTime, [7, 0, 1]);
	app.seekSeconds(-30);
	// Clamped to the music start at second 0, i.e. beat 0.
	assert.deepEqual(model.editor.currentTime, [0, 0, 1]);
	// The long forward seek clamps to the 60 s bound at beat 120.
	app.seekSeconds(600);
	assert.deepEqual(model.editor.currentTime, [120, 0, 1]);
});

test("setting a subdivision re-snaps the current time onto the new lattice", () => {
	const model = modelAt([1, 1, 3]);
	const app = makeApp(model);
	app.setSubdivision(4);
	assert.equal(model.editor.subdivision, 4);
	// 1 + 1/3 snaps to the closest quarter beat, 1 + 1/4.
	assert.deepEqual(model.editor.currentTime, [1, 1, 4]);
});

test("playback rate commands keep the rate within 0.1 through 4", () => {
	const model = modelAt([0, 0, 1]);
	const app = makeApp(model);
	app.setSpeed(0.5);
	assert.equal(model.editor.speed, 0.5);
	app.setSpeed(0);
	assert.equal(model.editor.speed, 0.1);
	app.setSpeed(100);
	assert.equal(model.editor.speed, 4);
});
