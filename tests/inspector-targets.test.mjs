import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { withEventEditing } from "../js/app/app-event-editing.js";
import { InspectorPanel } from "../js/ui/panels.js";
import { makeRationalControl } from "../js/ui/panel-controls.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";
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

test("the rebind wraps the original wiring, not the previous wrapper", async () => {
	const source = await readFile(new URL("../js/ui/panels.js", import.meta.url), "utf8");
	// The per-render wrappers only accept (property, value), so wrapping the previous wrapper
	// would drop every new targets and send all later edits to the first render's selection.
	assert.match(source, /const forward = this\.#appOnChange;/);
	// A callback that resolved `this.onChange` when the edit landed would follow whatever render
	// rebound it last; every field must capture the binding of the render that created it.
	assert.doesNotMatch(source, /this\.onChange\(/);
});

// A small DOM stand-in: enough of the element API for the inspector to build and flush a form.
function fakeElement(tagName) {
	return {
		tagName,
		children: [],
		className: "",
		textContent: "",
		value: "",
		checked: false,
		type: "",
		inputMode: "",
		placeholder: "",
		indeterminate: false,
		step: "",
		min: "",
		title: "",
		hidden: false,
		disabled: false,
		dataset: {},
		listeners: {},
		append(...nodes) {
			this.children.push(...nodes);
		},
		replaceChildren() {
			this.children = [];
		},
		addEventListener(type, listener) {
			(this.listeners[type] ||= []).push(listener);
		},
		removeEventListener() {},
		dispatchEvent(event) {
			for (const listener of [...(this.listeners[event.type] || [])]) {
				listener(event);
			}
		},
		setAttribute(name, value) {
			this[name] = value;
		},
		matches(selector) {
			return selector.split(",").map(part => part.trim()).includes(this.tagName);
		},
		querySelectorAll(selector) {
			const tags = selector.split(",").map(part => part.trim());
			const found = [];
			const walk = node => {
				for (const child of node.children || []) {
					if (typeof child === "object") {
						if (tags.includes(child.tagName)) {
							found.push(child);
						}
						walk(child);
					}
				}
			};
			walk(this);
			return found;
		},
	};
}

test("an edit flushed after re-renders carries the targets of its own render", () => {
	globalThis.document = { createElement: tag => fakeElement(tag), getElementById: () => null };
	const model = ChartModel.createDefault({ channels: [{ id: 0 }] });
	const first = model.addEvent("tap", { time: [1, 0, 1], x: 0, y: 0, channel: 0, selected: true });
	const second = model.addEvent("tap", { time: [2, 0, 1], x: 10, y: 0, channel: 0 });
	const commits = [];
	const panel = new InspectorPanel({
		i18n: { t: key => key },
		onChange: (property, value, targets) => commits.push({ property, value, targets }),
	});
	panel.element = fakeElement("div");
	// Boot renders for the first note; any unrelated refresh renders again — the wrapper chain
	// is what used to bury every later targets under the very first render's selection.
	panel.render(model);
	panel.render(model);
	model.findEvent(first.id).selected = false;
	model.findEvent(second.id).selected = true;
	panel.render(model);
	const input = panel.element
		.querySelectorAll("input")
		.find(candidate => candidate.type === "text" && !candidate.inputMode);
	assert.ok(input, "the text field of the second note is rendered");
	input.value = "typed on the second note";
	// Clicking the first note moves the selection before the edit is flushed.
	model.findEvent(second.id).selected = false;
	model.findEvent(first.id).selected = true;
	panel.render(model);
	const commit = commits.find(entry => entry.property === "text");
	assert.equal(commit.value, "typed on the second note");
	assert.deepEqual(commit.targets, [second.id], "the edit carries its own render's targets");
});

test("a rational control commits through the change event the inspector flush dispatches", () => {
	const committed = [];
	const documentRef = { createElement: tag => fakeElement(tag) };
	const control = makeRationalControl(documentRef, 2, value => committed.push(value));
	const [whole, , numerator, , denominator] = control.children;
	whole.value = "4";
	numerator.value = "0";
	denominator.value = "1";
	whole.dispatchEvent({ type: "change" });
	assert.equal(committed.length, 1, "the flush's synthetic change commits the tuple");
	assert.equal(Rational.from(committed[0]).toString(), Rational.from([4, 0, 1]).toString());
	// change (flush or blur) and the wrapper focusout can both fire for the same tuple.
	denominator.dispatchEvent({ type: "change" });
	assert.equal(committed.length, 1, "an unchanged tuple is not emitted twice");
});
