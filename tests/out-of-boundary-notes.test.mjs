import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { CHECK_IDS, defaultChecks, normalizeChecks, runChecks } from "../js/core/checks.js";

test("out-of-boundary notes merge bg notes behind a bgNotes parameter", () => {
	assert.ok(CHECK_IDS.includes("outOfBoundaryNotes"));
	assert.equal(CHECK_IDS.includes("outOfBoundaryBgNotes"), false);
	assert.equal(defaultChecks().outOfBoundaryNotes.bgNotes, true);
	const migrated = normalizeChecks({
		outOfBoundaryNotes: { enabled: true },
		outOfBoundaryBgNotes: { enabled: false },
	});
	assert.equal(migrated.outOfBoundaryNotes.bgNotes, false);
	const model = ChartModel.createDefault({
		metadata: { title: "Song", artist: "A", charter: "C", difficultyName: "Master", difficulty: "12" },
	});
	model.addEvent("bgNote", { time: [0, 0, 1], x: 400, y: 0 });
	model.checks.outOfBoundaryNotes.bgNotes = true;
	assert.ok(runChecks(model).some(item => item.check === "outOfBoundaryNotes"));
	model.checks.outOfBoundaryNotes.bgNotes = false;
	assert.equal(
		runChecks(model).filter(item => item.check === "outOfBoundaryNotes").length,
		0,
	);
});
