import assert from "node:assert/strict";
import test from "node:test";

import {
	activeFilterChannels,
	applyFilterSelection,
	matchEventFilter,
	matchFilterText,
} from "../js/core/select-filter.js";

test("filter text supports case sensitivity and regex", () => {
	assert.equal(matchFilterText("Hello", "hello", { caseSensitive: false }), true);
	assert.equal(matchFilterText("Hello", "hello", { caseSensitive: true }), false);
	assert.equal(matchFilterText("tap-12", "^tap-\\d+$", { regex: true }), true);
	assert.equal(matchFilterText("tap-12", "[", { regex: true }), false);
});

test("channel filter cannot choose inactive channels", () => {
	const active = activeFilterChannels([
		{ id: 0, active: true, name: "A" },
		{ id: 1, active: false, name: "B" },
	]);
	assert.deepEqual(
		active.map(channel => channel.id),
		[0],
	);
});

test("tip-point spawn type and select/add/remove modes", () => {
	const chain = { id: 1, type: "tap", tipPointSpawnType: "chain", text: "x", time: [1, 0, 1], channel: 0 };
	const inherit = { id: 2, type: "tap", text: "y", time: [2, 0, 1], channel: 0 };
	assert.equal(matchEventFilter(chain, { enableSpawnType: true, spawn_chain: true, spawn_inherit: false }), true);
	assert.equal(matchEventFilter(inherit, { enableSpawnType: true, spawn_chain: true, spawn_inherit: false }), false);
	assert.deepEqual(applyFilterSelection([1, 2], [2, 3], "select"), [2, 3]);
	assert.deepEqual(applyFilterSelection([1, 2], [2, 3], "add").sort(), [1, 2, 3]);
	assert.deepEqual(applyFilterSelection([1, 2, 3], [2], "remove"), [1, 3]);
});
