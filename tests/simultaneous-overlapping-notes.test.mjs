import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { defaultChecks, runChecks } from "../js/core/checks.js";

function modelWithNotes(notes) {
	const model = ChartModel.createDefault();
	for (const note of notes) {
		model.addEvent(note.type, { time: [1, 0, 1], x: note.x ?? 0, y: note.y ?? 0, ...note });
	}
	return model;
}

function violations(model, invisibleOnly) {
	const checks = defaultChecks();
	for (const setting of Object.values(checks)) {
		setting.enabled = false;
	}
	checks.simultaneousOverlappingNotes.enabled = true;
	checks.simultaneousOverlappingNotes.invisibleOnly = invisibleOnly;
	return runChecks(model, { checks }).filter(item => item.check === "simultaneousOverlappingNotes");
}

test("simultaneous overlapping notes reports each simultaneous position group once", () => {
	const model = modelWithNotes([
		{ type: "tap" },
		{ type: "tap" },
		{ type: "tap", x: 20 },
	]);
	const result = violations(model, false);
	assert.equal(result.length, 1);
	assert.deepEqual(result[0].eventIds.length, 2);
});

test("invisibleOnly recognizes documented hold, flick, and covered tap overlaps", () => {
	const model = modelWithNotes([
		{ type: "hold", duration: [1, 0, 1] },
		{ type: "hold", duration: [1, 0, 1] },
		{ type: "flick", angle: 0 },
		{ type: "flick", angle: 0 },
		{ type: "tap" },
		{ type: "tap" },
		{ type: "tap", x: 20 },
	]);
	assert.equal(violations(model, true).length, 3);
});

test("simultaneous overlapping notes does not merge distinct nearby beat times", () => {
	const model = ChartModel.createDefault();
	model.addEvent("tap", { time: [1, 0, 1], x: 0, y: 0 });
	model.addEvent("tap", { time: [1, 1, 1000000], x: 0, y: 0 });
	assert.equal(violations(model, false).length, 0);
});
