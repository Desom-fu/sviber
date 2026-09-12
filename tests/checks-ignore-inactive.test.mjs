import assert from "node:assert/strict";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { runChecks } from "../js/core/checks.js";

test("all checks ignore inactive events and inactive channels", () => {
	const model = ChartModel.createDefault({
		metadata: { title: "T", artist: "A", charter: "C", difficultyName: "Master", difficulty: "12" },
		channels: [
			{ id: 0, active: true },
			{ id: 1, active: false },
		],
		events: [
			{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, x: 999, y: 0, active: false },
			{ id: 2, type: "tap", time: [0, 0, 1], channel: 1, x: 999, y: 0, active: true },
		],
		checks: { outOfBoundaryNotes: { enabled: true, bgNotes: true } },
	});
	const violations = runChecks(model);
	assert.equal(
		violations.filter(item => item.check === "outOfBoundaryNotes").length,
		0,
	);
});

test("active events on active channels are still reported", () => {
	const model = ChartModel.createDefault({
		metadata: { title: "T", artist: "A", charter: "C", difficultyName: "Master", difficulty: "12" },
		channels: [{ id: 0, active: true }],
		events: [{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, x: 999, y: 0, active: true }],
		checks: { outOfBoundaryNotes: { enabled: true, bgNotes: true } },
	});
	const violations = runChecks(model);
	assert.ok(violations.some(item => item.check === "outOfBoundaryNotes"));
});
