import assert from "node:assert/strict";
import test from "node:test";
import { CHECK_IDS } from "../js/core/checks-config.js";
import { ChartModel } from "../js/core/chart-model.js";

test("editor fields use the file-format spelling", () => {
	const model = ChartModel.createDefault({
		editor: {
			allowOutOfBound: true,
			showGroupingInTimeline: false,
			showGroupingInMainField: false,
			showTipPoints: false,
		},
	});
	assert.equal(model.editor.allowOutOfBound, true);
	assert.equal(ChartModel.import(model.toJSON()).editor.allowOutOfBound, true);
	assert.equal(ChartModel.createDefault({ editor: { allowOutOfBounds: true } }).editor.allowOutOfBound, false);
});

test("editor view and background visibility fields round-trip", () => {
	const model = ChartModel.createDefault({
		editor: {
			showBgEventsInTimeline: false,
			showBgEventsInMainField: false,
			mainFieldPanX: 12,
			mainFieldPanY: -4,
			mainFieldZoom: 1.75,
		},
	});

	const restored = ChartModel.import({ sviber: model.serializeSviber(), metadata: model.metadata });
	assert.equal(restored.editor.showBgEventsInTimeline, false);
	assert.equal(restored.editor.showBgEventsInMainField, false);
	assert.equal(restored.editor.mainFieldPanX, 12);
	assert.equal(restored.editor.mainFieldPanY, -4);
	assert.equal(restored.editor.mainFieldZoom, 1.75);
});

test("rulers default off and persist in editor state", () => {
	const model = ChartModel.createDefault();
	assert.equal(model.editor.showRulers, false);
	model.editor.showRulers = true;
	const restored = ChartModel.import({ sviber: model.serializeSviber(), metadata: model.metadata });
	assert.equal(restored.editor.showRulers, true);
});

test("Show HUD defaults on and persists", () => {
	const model = ChartModel.createDefault();
	assert.equal(model.editor.showHud, true);
	model.editor.showHud = false;
	const restored = ChartModel.import({ sviber: model.serializeSviber(), metadata: model.metadata });
	assert.equal(restored.editor.showHud, false);
});

test("editor playback settings and A-B marks round-trip canonically", () => {
	const model = ChartModel.createDefault({
		editor: {
			lockVisibleRange: true,
			playSe: false,
			seekBackAfterPlaying: true,
			metronome: true,
			abLoopMarks: [
				[4, 0, 1],
				[1, 1, 2],
				[4, 0, 1],
			],
		},
	});
	assert.equal(model.editor.lockVisibleRange, true);
	assert.equal(model.editor.playSe, false);
	assert.equal(model.editor.seekBackAfterPlaying, true);
	assert.equal(model.editor.metronome, true);
	assert.deepEqual(model.editor.abLoopMarks, [
		[1, 1, 2],
		[4, 0, 1],
	]);
	const reopened = ChartModel.import(JSON.parse(model.serialize()));
	assert.deepEqual(reopened.editor, model.editor);
});

// v18 documents `clips` and `checks` as part of the `sviber` object, so a saved chart has to
// carry them and reloading has to bring back both the enabled flags and the parameters.
test("the sviber document carries clips and checks with their parameters", () => {
	const model = ChartModel.createDefault({});
	model.addClip({ events: [], channels: [], snappees: [] }, "Intro fill");
	model.checks.shortHold.seconds = 0.25;
	model.checks.requiredFingers.fingers = 3;
	model.checks.multiCharacterCjk.enabled = false;
	const document = model.serializeSviber();
	assert.ok(Array.isArray(document.clips));
	assert.equal(document.clips[0].name, "Intro fill");
	assert.equal(document.checks.shortHold.seconds, 0.25);
	assert.equal(document.checks.requiredFingers.fingers, 3);
	assert.equal(document.checks.multiCharacterCjk.enabled, false);
	// Every documented check id must be present so the checks dialog never has a missing row.
	for (const id of CHECK_IDS) {
		assert.equal(typeof document.checks[id]?.enabled, "boolean", `missing check ${id}`);
	}
	const restored = ChartModel.import({ sviber: document, metadata: model.metadata });
	assert.equal(restored.clips.length, 1);
	assert.equal(restored.checks.shortHold.seconds, 0.25);
	assert.equal(restored.checks.requiredFingers.fingers, 3);
	assert.equal(restored.checks.multiCharacterCjk.enabled, false);
});
