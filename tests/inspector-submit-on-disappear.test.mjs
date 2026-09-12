import assert from "node:assert/strict";
import test from "node:test";

import {
	collectDirtyInspectorControls,
	flushInspectorEdits,
	isInspectorControlDirty,
} from "../js/core/inspector-submit.js";
import { InspectorPanel } from "../js/ui/panels.js";
import { readFile } from "node:fs/promises";

function fakeInput(value, initial, type = "text") {
	return {
		type,
		value,
		checked: value === "true",
		dataset: { initialValue: initial },
		events: [],
		dispatchEvent(event) {
			this.events.push(event.type);
			return true;
		},
	};
}

test("an edited inspector field is dirty against its remembered initial value", () => {
	assert.equal(isInspectorControlDirty(fakeInput("next", "start")), true);
	assert.equal(isInspectorControlDirty(fakeInput("start", "start")), false);
});

test("disappearing dirty inspector fields are submitted via change", () => {
	const dirty = fakeInput("typed", "old");
	const clean = fakeInput("old", "old");
	const root = { querySelectorAll: () => [dirty, clean] };
	const flushed = flushInspectorEdits(root, class Event {
		constructor(type) {
			this.type = type;
		}
	});
	assert.equal(flushed.length, 1);
	assert.deepEqual(dirty.events, ["change"]);
	assert.deepEqual(clean.events, []);
	assert.equal(collectDirtyInspectorControls(root).length, 1);
});

test("InspectorPanel.render flushes pending edits before rebuilding", async () => {
	const source = await readFile(new URL("../js/ui/panels.js", import.meta.url), "utf8");
	assert.match(source, /flushInspectorEdits\(this\.element\)/);
	assert.equal(typeof InspectorPanel, "function");
});
