import assert from "node:assert/strict";
import test from "node:test";
import { withChartTools } from "../js/app/app-chart-tools.js";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { COMMAND_DEFINITIONS, CommandRegistry } from "../js/app/commands.js";
import { ChartModel } from "../js/core/chart-model.js";

test("read-only command policy keeps navigation, Music, comments, and macro access", () => {
	const registry = new CommandRegistry();
	for (const id of Object.keys(COMMAND_DEFINITIONS)) {
		registry.register(id, () => {});
	}
	const context = {
		model: { editor: { readOnly: true } },
		readOnlyCommandAllowed: id => id === "edit.delete",
	};
	for (const id of ["music.playPause", "timeline.pageForward", "edit.selectAll", "events.comment", "macros.open"]) {
		assert.equal(registry.isEnabled(id, context), true, `${id} should remain enabled`);
	}
	for (const id of ["file.save", "edit.undo", "events.tap", "channel.createAbove", "snappee.pen", "transform.free"]) {
		assert.equal(registry.isEnabled(id, context), false, `${id} should be disabled`);
	}
	assert.equal(registry.isEnabled("edit.delete", context), true);
});

test("read-only state round-trips and blocks history navigation", () => {
	const model = ChartModel.createDefault({ editor: { readOnly: true } });
	assert.equal(ChartModel.import(JSON.parse(model.serialize())).editor.readOnly, true);
	let historyCalls = 0;
	const HistoryApp = withHistoryCommands(class {});
	const app = new HistoryApp();
	app.model = model;
	app.history = {
		goTo() {
			historyCalls += 1;
		},
	};
	assert.equal(app.goToHistory(0), false);
	assert.equal(historyCalls, 0);
});

test("read-only inspector mutations allow comment fields but not type conversion", () => {
	const EditingApp = withEventEditing(
		class {
			constructor(model) {
				this.model = model;
			}

			commit(_label, mutation, options = {}) {
				if (this.model.editor.readOnly && !options.allowReadOnly) {
					return null;
				}
				return mutation(this.model);
			}

			rememberCreationDefaults() {}
		},
	);
	const model = ChartModel.createDefault({
		editor: { readOnly: true },
		events: [
			{
				id: 1,
				type: "comment",
				channel: 0,
				time: [0, 0, 1],
				duration: [1, 0, 1],
				text: "before",
				selected: true,
			},
		],
	});
	const app = new EditingApp(model);
	app.editSelectedProperty("text", "after");
	assert.equal(model.events[0].text, "after");
	app.editSelectedProperty("type", "tap");
	assert.equal(model.events[0].type, "comment");
});

test("read-only mode keeps channel and snappee activation available but blocks edits", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }],
		editor: { readOnly: true },
	});
	const HistoryApp = withHistoryCommands(class {});
	const historyApp = new HistoryApp();
	historyApp.model = model;
	historyApp.commit = (_label, mutation, options = {}) => {
		if (model.editor.readOnly && !options.allowReadOnly) {
			return null;
		}
		return mutation(model);
	};
	historyApp.toggleChannel(0);
	assert.equal(model.channels[0].active, false);
	const ToolApp = withChartTools(class {});
	const toolApp = new ToolApp();
	toolApp.model = model;
	toolApp.commit = historyApp.commit;
	toolApp.toggleSnappee(0);
	assert.equal(model.snappees[0].active, false);
	assert.equal(
		historyApp.commit("blocked", target => {
			target.channels[1].name = "blocked";
		}),
		null,
	);
});
