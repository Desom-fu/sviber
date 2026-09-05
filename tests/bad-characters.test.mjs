import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { runChecks } from "../js/core/checks.js";

function chartWithText(type, text, extra = {}) {
	const model = ChartModel.createDefault({
		metadata: { title: "Song", artist: "A", charter: "C", difficultyName: "Master", difficulty: "12" },
	});
	model.addEvent(type, { time: [0, 0, 1], text, x: 0, y: 0, ...extra });
	return model;
}

test("bad characters flags control letters and movable whitespace", () => {
	const tab = chartWithText("tap", "a\tb");
	assert.ok(runChecks(tab).some(item => item.check === "badCharacters"));
	const space = chartWithText("tap", "a b");
	assert.ok(runChecks(space).some(item => item.check === "badCharacters"));
	const rtl = chartWithText("tap", "a\u202Eb");
	assert.ok(runChecks(rtl).some(item => item.check === "badCharacters"));
	const ok = chartWithText("tap", "啊");
	assert.equal(
		runChecks(ok).filter(item => item.check === "badCharacters").length,
		0,
	);
	const comment = chartWithText("comment", "a\tb", { duration: [1, 0, 1] });
	assert.equal(
		runChecks(comment).filter(item => item.check === "badCharacters").length,
		0,
	);
});
