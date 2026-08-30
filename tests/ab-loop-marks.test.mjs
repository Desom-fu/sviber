import assert from "node:assert/strict";
import test from "node:test";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";

// The Music > Set/clear A-B loop marks state machine: none -> one mark, one different
// mark -> a sorted pair, one identical mark -> no operation, two marks -> cleared, and the
// whole operation is unavailable while the music is playing.
function makeApp(model) {
	const App = withHistoryCommands(
		class {
			commit(label, mutation) {
				return mutation(this.model);
			}

			_syncAudioLoop() {}

			refreshInteractionPreview() {}
		},
	);
	const app = new App();
	app.model = model;
	app.audio = { playing: false };
	return app;
}

function marks(model) {
	return (model.editor.abLoopMarks || []).map(mark => Rational.from(mark).toNumber());
}

test("A-B loop marks are created, paired, ignored, and cleared by repeated toggles", () => {
	const model = new ChartModel({ editor: { currentTime: [1, 0, 1] } });
	const app = makeApp(model);

	assert.ok(app.toggleAbLoop());
	assert.deepEqual(marks(model), [1]);

	// One mark exactly at the current time is a no-operation that keeps a single mark.
	model.editor.currentTime = [1, 0, 1];
	assert.ok(app.toggleAbLoop());
	assert.deepEqual(marks(model), [1]);

	// A second mark at a different time completes the pair, sorted as A then B.
	model.editor.currentTime = [3, 0, 1];
	assert.ok(app.toggleAbLoop());
	assert.deepEqual(marks(model), [1, 3]);

	// With two marks present, the next toggle clears both.
	assert.ok(app.toggleAbLoop());
	assert.deepEqual(marks(model), []);
});

test("A-B loop marks are refused while the music is playing", () => {
	const model = new ChartModel({ editor: { currentTime: [0, 0, 1] } });
	const app = makeApp(model);
	app.audio = { playing: true };
	assert.equal(app.toggleAbLoop(), false);
	assert.deepEqual(marks(model), []);
});
