import assert from "node:assert/strict";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { runChecks, createChecksSteps, normalizeChecks } from "../js/core/checks.js";
import { defaultChecks } from "../js/core/checks-config.js";
import { TimingMap } from "../js/core/timing.js";

function modelWithPatterns(patternOverrides = {}) {
	const base = {
		channels: [{ id: 0, name: "A" }],
		editor: { currentChannel: 0 },
		events: [
			{
				id: 1,
				type: "grid",
				channel: 0,
				time: [0, 0, 1],
				duration: [0, 2, 1],
				x: 0,
				y: 0,
				...patternOverrides.first,
			},
			{
				id: 2,
				type: "hexagon",
				channel: 0,
				time: [1, 0, 1],
				duration: [0, 2, 1],
				x: 50,
				y: 0,
				...patternOverrides.second,
			},
		],
	};
	return new ChartModel(base);
}

test("overlapping background patterns are reported with both events", () => {
	const model = modelWithPatterns();
	const violations = runChecks(model);
	const conflicting = violations.filter(violation => violation.check === "conflictingBgPatterns");
	assert.equal(conflicting.length, 1, "grid (0..2) and hexagon (1..3) overlap");
	assert.deepEqual(conflicting[0].eventIds, [1, 2], "clicking selects both patterns");
});

test("non-overlapping background patterns pass the check", () => {
	const model = modelWithPatterns({ second: { time: [3, 0, 1], duration: [0, 1, 1] } });
	const violations = runChecks(model);
	assert.equal(violations.filter(violation => violation.check === "conflictingBgPatterns").length, 0);
});

test("strict mode treats touching ranges as conflicting; the relaxed mode allows them", () => {
	// grid ends exactly when hexagon starts: strict says conflict, relaxed says fine.
	const strict = defaultChecks();
	strict.conflictingBgPatterns = { enabled: true, strict: true };
	const relaxed = defaultChecks();
	relaxed.conflictingBgPatterns = { enabled: true, strict: false };
	const model = modelWithPatterns({ second: { time: [2, 0, 1], duration: [0, 2, 1] } });
	const strictViolations = runChecks(model, { checks: strict });
	const relaxedViolations = runChecks(model, { checks: relaxed });
	assert.equal(
		strictViolations.some(violation => violation.check === "conflictingBgPatterns"),
		true,
	);
	assert.equal(
		relaxedViolations.filter(violation => violation.check === "conflictingBgPatterns").length,
		0,
	);
});

test("the check is enabled by default and exposes the strict parameter", () => {
	const defaults = defaultChecks();
	assert.equal(defaults.conflictingBgPatterns.enabled, true);
	assert.equal(defaults.conflictingBgPatterns.strict, true);
	const normalized = normalizeChecks({ conflictingBgPatterns: { enabled: true, strict: false } });
	assert.equal(normalized.conflictingBgPatterns.strict, false);
	const { steps } = createChecksSteps(modelWithPatterns(), { checks: defaults });
	assert.ok(steps.length > 0);
	void TimingMap;
});
