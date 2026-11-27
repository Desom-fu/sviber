import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { I18n } from "../js/ui/i18n.js";

function createSeekHarness(model) {
	const App = withHistoryCommands(withEventEditing(class {}));
	const app = new App();
	app.model = model;
	app.timing = () => new TimingMap(app.model.timing);
	app.currentSeconds = () => {
		if (app.model.editor.timeSnapped) {
			return app.timing().beatToSeconds(app.model.editor.currentTime);
		}
		return Number(app.model.editor.currentTime);
	};
	app.timeBounds = () => [0, 120];
	app.audio = {
		playing: false,
		soughtTo: null,
		seek(seconds) {
			this.soughtTo = seconds;
		},
	};
	app.stage = { requestRender() {} };
	app.timeline = { requestRender() {} };
	app.scrollView = { requestRender() {} };
	app.refreshInteractionPreview = () => {};
	app.requestStatusUpdate = () => {};
	return app;
}

test("Music menu places Seek to last event (End) right after Seek to start (Home)", () => {
	assert.equal(COMMAND_DEFINITIONS["music.seekLastEvent"].shortcut, "End");
	const musicMenu = MENU_DEFINITION.find(menu => menu.id === "music");
	const startIndex = musicMenu.items.findIndex(item => item.command === "music.seekStart");
	assert.ok(startIndex >= 0);
	assert.equal(musicMenu.items[startIndex + 1].command, "music.seekLastEvent");

	const i18n = new I18n("en-US");
	assert.equal(i18n.shortcut("End"), "End");
});

test("seekLastEvent moves current time to the event with the largest time including grouped events", () => {
	const model = ChartModel.createDefault({
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
		editor: {
			currentTime: [0, 0, 1],
			timeSnapped: true,
			visibleRangeBeginning: 0,
			visibleRangeEnd: 5,
			visibleRangeLocked: false,
		},
	});
	const app = createSeekHarness(model);

	// Empty chart leaves current time unchanged.
	app.seekLastEvent();
	assert.deepEqual(model.editor.currentTime, [0, 0, 1]);

	model.addEvent("tap", { time: [4, 0, 1], x: 0, y: 0 });
	model.addEvent("hold", { time: [10, 0, 1], duration: [8, 0, 1], x: 0, y: 0 });
	model.addEvent("group", {
		x: 0,
		y: 0,
		events: [{ id: 99, type: "tap", channel: 0, time: [15, 1, 2], x: 10, y: 0 }],
	});

	app.seekLastEvent();
	// Largest event start time is 15 + 1/2 beats (7.75 s at 120 BPM).
	assert.deepEqual(model.editor.currentTime, [15, 1, 2]);
	assert.equal(model.editor.timeSnapped, true);
	// Visible range shifts so the target 7.75 s is contained within it.
	assert.ok(model.editor.visibleRangeBeginning <= 7.75);
	assert.ok(model.editor.visibleRangeEnd >= 7.75);
});
