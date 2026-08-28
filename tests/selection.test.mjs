import assert from "node:assert/strict";
import test from "node:test";
import { eventClickSelectionMode } from "../js/render/selection.js";

test("selection clicks toggle without changing modifier semantics", () => {
	assert.equal(eventClickSelectionMode({ selected: false }), "replace");
	assert.equal(eventClickSelectionMode({ selected: true }), "remove");
	assert.equal(eventClickSelectionMode({ selected: false, ctrlKey: true }), "add");
	assert.equal(eventClickSelectionMode({ selected: true, ctrlKey: true }), "add");
	assert.equal(eventClickSelectionMode({ selected: false, altKey: true }), "remove");
	assert.equal(eventClickSelectionMode({ selected: true, altKey: true }), "remove");
});
