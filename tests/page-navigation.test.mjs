import assert from "node:assert/strict";
import test from "node:test";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";

// Timeline navigation commands: PageUp/PageDown shift the visible range by its own length
// and carry the current time along when it was visible, and plain wheel navigation steps
// the current time by one subdivision, moving the visible range only when the current time
// sits at or past the centre in the scroll direction.
function makeApp(model) {
	const App = withEventEditing(
		class {
			commit(label, mutation) {
				return mutation(this.model);
			}
		},
	);
	const app = new App();
	app.model = model;
	const seek = seconds => {
		app.seekCalls.push(seconds);
	};
	app.audio = { playing: false, seek };
	app.seekCalls = [];
	app.timing = () => model.timing;
	app.timeBounds = () => [0, 600];
	app.setVisibleRange = (beginning, end) => {
		model.editor.visibleRangeBeginning = beginning;
		model.editor.visibleRangeEnd = end;
	};
	app.currentBeat = () => Rational.from(model.editor.currentTime);
	app.currentSeconds = () => model.timing.beatToSeconds(Rational.from(model.editor.currentTime));
	app.stage = { requestRender() {} };
	app.timeline = { requestRender() {}, revealChannel() {} };
	app.scrollView = { requestRender() {} };
	app.requestStatusUpdate = () => {};
	return app;
}

function modelAt(beat, range) {
	return new ChartModel({
		editor: { currentTime: beat, subdivision: 2, ...range },
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
	});
}

test("PageUp and PageDown shift the visible range by its own length", () => {
	const model = modelAt([6, 0, 1], { visibleRangeBeginning: 2, visibleRangeEnd: 12 });
	const app = makeApp(model);
	app.pageVisibleRange(1);
	// Beat 6 at 120 BPM is second 3, inside the old range, so it moves with the page by
	// the ten-second span of the old range.
	assert.equal(model.editor.visibleRangeBeginning, 12);
	assert.equal(model.editor.visibleRangeEnd, 22);
	assert.deepEqual(model.editor.currentTime, [26, 0, 1]);
	assert.deepEqual(app.seekCalls, [13]);
	app.pageVisibleRange(-1);
	assert.equal(model.editor.visibleRangeBeginning, 2);
	assert.equal(model.editor.visibleRangeEnd, 12);
});

test("paging keeps the current time untouched when it is outside the visible range", () => {
	const model = modelAt([100, 0, 1], { visibleRangeBeginning: 2, visibleRangeEnd: 12 });
	const app = makeApp(model);
	app.pageVisibleRange(1);
	assert.equal(model.editor.visibleRangeBeginning, 12);
	assert.deepEqual(model.editor.currentTime, [100, 0, 1]);
	assert.deepEqual(app.seekCalls, []);
});

test("wheel navigation steps by one subdivision and drags the range past the centre", () => {
	const model = modelAt([6, 0, 1], { visibleRangeBeginning: 2, visibleRangeEnd: 12 });
	const app = makeApp(model);
	// Scrolling down increases the current time by half a beat (0.25 s at 120 BPM).
	app.navigateWheel(1);
	assert.deepEqual(model.editor.currentTime, [6, 1, 2]);
	// The current time (second 3) is left of the centre (second 7), so the range stays.
	assert.equal(model.editor.visibleRangeBeginning, 2);
	// Scrolling down again from right of the centre pushes the visible range along.
	model.editor.currentTime = [16, 0, 1];
	app.navigateWheel(1);
	assert.deepEqual(model.editor.currentTime, [16, 1, 2]);
	assert.equal(model.editor.visibleRangeBeginning, 2.25);
	assert.equal(model.editor.visibleRangeEnd, 12.25);
});

test("wheel navigation refuses to step outside the music bounds", () => {
	const model = modelAt([0, 0, 1], { visibleRangeBeginning: 0, visibleRangeEnd: 10 });
	const app = makeApp(model);
	app.navigateWheel(-1);
	assert.deepEqual(model.editor.currentTime, [0, 0, 1]);
});
