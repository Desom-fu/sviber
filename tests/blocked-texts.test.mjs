import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { runChecks } from "../js/core/checks.js";

test("blocked texts reports a covered note throughout its lifetime", () => {
	const model = ChartModel.createDefault({
		metadata: { title: "Song", artist: "A", charter: "C", difficultyName: "Master", difficulty: "12" },
	});
	const behind = model.addEvent("tap", { time: [0, 0, 1], x: 0, y: 0, text: "a" });
	model.addEvent("tap", { time: [0, 0, 1], x: 0, y: 0, text: "" });
	const hits = runChecks(model).filter(item => item.check === "blockedTexts");
	assert.ok(hits.some(item => item.eventIds.includes(behind.id)));
});

test("blocked texts ignores uncovered notes", () => {
	const model = ChartModel.createDefault({
		metadata: { title: "Song", artist: "A", charter: "C", difficultyName: "Master", difficulty: "12" },
	});
	model.addEvent("tap", { time: [0, 0, 1], x: 0, y: 0, text: "a" });
	model.addEvent("tap", { time: [1, 0, 1], x: 40, y: 0, text: "b" });
	assert.equal(
		runChecks(model).filter(item => item.check === "blockedTexts").length,
		0,
	);
});
