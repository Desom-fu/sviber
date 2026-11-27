import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { CHECK_DEFINITIONS, CHECK_IDS, defaultChecks, normalizeChecks, runChecks } from "../js/core/checks.js";
import { withChecks } from "../js/app/app-checks.js";
import { History } from "../js/core/history.js";

function requiredFingersViolations(model, params = {}) {
	const checks = defaultChecks();
	for (const id of CHECK_IDS) {
		checks[id].enabled = id === "requiredFingers";
	}
	Object.assign(checks.requiredFingers, params);
	return runChecks(model, { checks }).filter(item => item.check === "requiredFingers");
}

test("requiredFingers.ignoreDrag defaults to false and round-trips through JSON normalization", () => {
	assert.equal(defaultChecks().requiredFingers.ignoreDrag, false);
	const normalized = normalizeChecks({ requiredFingers: { enabled: true, fingers: 2, ignoreDrag: true } });
	assert.equal(normalized.requiredFingers.ignoreDrag, true);

	const model = ChartModel.createDefault({
		checks: { requiredFingers: { enabled: true, fingers: 2, ignoreDrag: true } },
	});
	assert.equal(model.checks.requiredFingers.ignoreDrag, true);
	const restored = ChartModel.import({ metadata: model.metadata, sviber: model.serializeSviber() });
	assert.equal(restored.checks.requiredFingers.ignoreDrag, true);
});

test("requiredFingers ignores drag events when ignoreDrag is true", () => {
	const model = ChartModel.createDefault();
	model.addEvent("tap", { time: [2, 0, 1], x: -20, y: 0 });
	model.addEvent("tap", { time: [2, 0, 1], x: 0, y: 0 });
	model.addEvent("drag", { time: [2, 0, 1], x: 20, y: 0 });

	// With ignoreDrag: false (default), 2 taps + 1 drag at beat 2 needs 3 fingers (> 2).
	const defaultViolations = requiredFingersViolations(model, { fingers: 2, ignoreDrag: false });
	assert.equal(defaultViolations.length, 1);

	// With ignoreDrag: true, drag is ignored, so only 2 taps (2 fingers <= 2) count.
	const ignoredViolations = requiredFingersViolations(model, { fingers: 2, ignoreDrag: true });
	assert.equal(ignoredViolations.length, 0);

	// Simultaneous drags alone never trigger violations when ignoreDrag is true.
	const dragOnly = ChartModel.createDefault();
	dragOnly.addEvent("drag", { time: [1, 0, 1], x: -20, y: 0 });
	dragOnly.addEvent("drag", { time: [1, 0, 1], x: 0, y: 0 });
	dragOnly.addEvent("drag", { time: [1, 0, 1], x: 20, y: 0 });
	assert.equal(requiredFingersViolations(dragOnly, { fingers: 2, ignoreDrag: false }).length, 1);
	assert.equal(requiredFingersViolations(dragOnly, { fingers: 2, ignoreDrag: true }).length, 0);
});

test("Checks settings dialog persists requiredFingers.ignoreDrag as a boolean", async () => {
	const definition = CHECK_DEFINITIONS.find(item => item.id === "requiredFingers");
	const ignoreDragParam = definition.parameters.find(param => param.id === "ignoreDrag");
	assert.equal(ignoreDragParam?.type, "checkbox");

	const App = withChecks(class {});
	const app = new App();
	app.model = ChartModel.createDefault();
	app.history = new History(app.model.snapshot());
	app.commit = (label, mutator) => {
		mutator(app.model);
		app.history.record(label, app.model.snapshot());
	};
	app.refreshChecks = () => {};
	app.dialogs = {
		async form(options) {
			return {
				...options.values,
				requiredFingers: { ...options.values.requiredFingers, ignoreDrag: true },
			};
		},
	};
	const saved = await app.showChecksDialog();
	assert.ok(saved);
	assert.strictEqual(app.model.checks.requiredFingers.ignoreDrag, true);
});
