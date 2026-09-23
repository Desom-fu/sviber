import assert from "node:assert/strict";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { readManual } from "./module-source.mjs";

test("a new chart starts with three named channels and keeps at least one", async () => {
	const model = ChartModel.createDefault();
	assert.deepEqual(
		model.channels.map(channel => channel.name),
		["Channel 1", "Channel 2", "Channel 3"],
	);
	assert.deepEqual(
		model.channels.map(channel => channel.id),
		[0, 1, 2],
	);
	assert.equal(model.editor.currentChannel, 0);
	assert.ok(model.removeChannel(2));
	assert.ok(model.removeChannel(1));
	assert.equal(model.channels.length, 1);
	assert.equal(model.removeChannel(model.channels[0].id), null);
	assert.equal(model.channels.length, 1);
	assert.equal(model.channels[0].id, 0);

	const imported = ChartModel.import({ title: "Imported", events: [] });
	assert.equal(imported.channels.length, 1, "a Sunniesnow import is not a new sviber chart");

	const manual = await readManual();
	assert.match(manual, /three channels/);
	assert.match(manual, /三条通道/);
	assert.match(manual, /三條通道/);
	assert.match(manual, /3つのチャンネル/);
});
