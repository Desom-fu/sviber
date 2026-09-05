import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { runChecks } from "../js/core/checks.js";

test("drifting tip points reports a long gap before the later event", () => {
	const model = ChartModel.createDefault({
		metadata: { title: "Song", artist: "A", charter: "C", difficultyName: "Master", difficulty: "12" },
		timing: { offset: 0, initialBpm: 60, bpmChanges: [], barLines: [] },
	});
	model.addEvent("tap", { time: [0, 0, 1], x: 0, y: 0, tipPointSpawnType: "chain", tipPointSpawnTime: 0 });
	const later = model.addEvent("tap", { time: [8, 0, 1], x: 10, y: 0, tipPointSpawnType: "inherit" });
	model.checks.driftingTipPoint.seconds = 2;
	const hits = runChecks(model).filter(item => item.check === "driftingTipPoint");
	assert.equal(hits.length, 1);
	assert.deepEqual(hits[0].eventIds, [later.id]);
});
