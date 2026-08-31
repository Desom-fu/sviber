import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";

test("panel expansion flags round-trip for channels, snappees, and clips", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0, name: "Main", expanded: true }],
		snappees: [{ type: "rectangularMesh", id: 0, expanded: true }],
		clips: [{ name: "Phrase", expanded: true, data: { events: [], snappees: [] } }],
	});
	const snapshot = model.snapshot();
	assert.equal(snapshot.channels[0].expanded, true);
	assert.equal(snapshot.snappees[0].expanded, true);
	assert.equal(snapshot.clips[0].expanded, true);
	const restored = new ChartModel(snapshot);
	assert.equal(restored.channels[0].expanded, true);
	assert.equal(restored.snappees[0].expanded, true);
	assert.equal(restored.clips[0].expanded, true);
});
