import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { History } from "../js/core/history.js";

// The inspector binds every field to the selection it was rendered for: when the user types
// text for one note and then clicks another note, the pending edit is flushed after the
// selection already changed, and it must land on the note it was typed for.

function editingApp() {
	globalThis.document = { title: "", getElementById: () => null };
	const EditingApp = withEventEditing(
		class {
			commit(label, mutation, options = {}) {
				return this._finishCommit(label, mutation, options, false);
			}

			_invalidatePlaybackSchedule() {}

			_normalizeGroupSelectionScope() {}

			refresh() {}

			refreshInteractionPreview() {}

			requestStatusUpdate() {}

			syncActiveDifficultyState() {}

			broadcastLiveChartUpdate() {}
		},
	);
	const app = new EditingApp();
	app.model = ChartModel.createDefault({ channels: [{ id: 0 }] });
	app.history = new History(app.model.snapshot());
	return app;
}

test("a pending edit flushed after the selection changed lands on the note it was typed for", () => {
	const app = editingApp();
	const typed = app.model.addEvent("tap", { time: [1, 0, 1], x: 0, y: 0, channel: 0, selected: true });
	const clicked = app.model.addEvent("tap", { time: [2, 0, 1], x: 10, y: 0, channel: 0 });
	// The field was rendered for `typed`; clicking the other note moved the selection before
	// the edit was committed (stage pointerdown, then blur, then the inspector re-render).
	app.model.findEvent(typed.id).selected = false;
	app.model.findEvent(clicked.id).selected = true;
	app.editSelectedProperty("text", "hello", [typed.id]);
	assert.equal(app.model.findEvent(typed.id).text, "hello", "the typed text reaches its own note");
	assert.equal(app.model.findEvent(clicked.id).text, "", "the other note stays untouched");
});

test("without render targets the edit follows the current selection", () => {
	const app = editingApp();
	const first = app.model.addEvent("tap", { time: [1, 0, 1], x: 0, y: 0, channel: 0, selected: true });
	const second = app.model.addEvent("tap", { time: [2, 0, 1], x: 10, y: 0, channel: 0 });
	app.editSelectedProperty("text", "on-first", [first.id]);
	app.model.findEvent(first.id).selected = false;
	app.model.findEvent(second.id).selected = true;
	app.editSelectedProperty("text", "on-second");
	assert.equal(app.model.findEvent(second.id).text, "on-second");
	assert.equal(app.model.findEvent(first.id).text, "on-first");
});

test("inspector fields commit against the selection they were rendered for", async () => {
	const source = await readFile(new URL("../js/ui/panels.js", import.meta.url), "utf8");
	assert.match(source, /const targets = Object\.freeze\(selected\.map\(event => event\.id\)\)/);
	assert.match(source, /this\.onChange = \(property, value\) => forward\(property, value, targets\)/);
	// The flush of the previous render's fields must run through the previous binding, so it
	// happens before the rebinding below captures the new selection.
	const flushIndex = source.indexOf("flushInspectorEdits(this.element)");
	const bindIndex = source.indexOf("const targets = Object.freeze(");
	assert.ok(flushIndex >= 0 && flushIndex < bindIndex, "the flush happens before the rebinding");
	const core = await readFile(new URL("../js/app/app-core.js", import.meta.url), "utf8");
	assert.match(core, /editSelectedProperty\(property, value, targets\)/);
});
