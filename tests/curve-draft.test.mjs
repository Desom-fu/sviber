import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STAGE_NOTE_MODULES, readSources } from "./module-source.mjs";
import { withChartTools } from "../js/app/app-chart-tools.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { sampleSnappee } from "../js/core/geometry.js";
import { History } from "../js/core/history.js";

test("curve-draft overlay is painted onto an offscreen static layer instead of copying the live canvas", async () => {
	const [core, notes] = await Promise.all([
		readFile(new URL("../js/render/stage-core.js", import.meta.url), "utf8"),
		readSources(STAGE_NOTE_MODULES),
	]);
	assert.match(core, /_ensureStaticLayer\(width, height\)/);
	assert.match(core, /const scene = draft \? this\._ensureStaticLayer\(width, height\) : context;/);
	assert.doesNotMatch(core, /drawImage\(context\.canvas/);
	assert.doesNotMatch(core, /_captureStaticLayer/);
	assert.match(notes, /draft\.type === "bezierCurve"/);
	assert.match(notes, /draft\.type === "circularArcCurve"/);
	assert.match(notes, /draft\.type === "penCurve"/);
	assert.match(notes, /_drawCurveDraft\(context, mapping\)/);
});

test("undoing a bezier control point restores the previous curve draft", () => {
	const App = withHistoryCommands(
		withChartTools(
			class {
				exitModes() {
					this.creationMode = null;
				}

				refresh() {}

				refreshInteractionPreview() {}

				_refreshLightweight() {}

				updateDirty() {}

				queueMediaSync() {}

				restoreHistorySnapshot(snapshot) {
					this.model.restore(snapshot);
				}

				cancelPreview() {}

				cancelFreeTransform() {}
			},
		),
	);
	const app = new App();
	app.model = ChartModel.createDefault();
	app.history = new History(app.model.snapshot(), { initialLabel: "initial" });
	app.freeTransform = null;
	app.creationMode = null;
	app.startCurveDraft("bezierCurve");
	app.addCurvePoint({ x: -20, y: 0 });
	app.addCurvePoint({ x: 0, y: 10 });
	const twoPoints = app.curveDraft.points.map(point => ({ ...point }));
	app.addCurvePoint({ x: 20, y: 0 });
	assert.equal(app.curveDraft.type, "bezierCurve");
	assert.equal(app.curveDraft.points.length, 3);
	app.undo();
	assert.equal(app.curveDraft.points.length, 2);
	assert.deepEqual(app.curveDraft.points, twoPoints);
	app.startCurveDraft("circularArcCurve");
	app.addCurvePoint({ x: 0, y: 0 });
	app.addCurvePoint({ x: 10, y: 0 });
	assert.equal(app.curveDraft.points.length, 2);
	app.undo();
	assert.equal(app.curveDraft.type, "circularArcCurve");
	assert.equal(app.curveDraft.points.length, 1);
});

test("finishing an arc opens the segments dialog like bezier and pen", () => {
	const dialogs = [];
	const App = withHistoryCommands(
		withChartTools(
			class {
				exitModes() {
					this.creationMode = null;
				}

				refresh() {}

				refreshInteractionPreview() {}

				_refreshLightweight() {}

				updateDirty() {}

				queueMediaSync() {}

				restoreHistorySnapshot(snapshot) {
					this.model.restore(snapshot);
				}

				cancelPreview() {}

				cancelFreeTransform() {}

				async showSnappeeDialog(type, id, options = {}) {
					dialogs.push({ type, id, options });
				}

				commit(_label, mutation) {
					mutation(this.model);
					return { ok: true };
				}
			},
		),
	);
	const app = new App();
	app.model = ChartModel.createDefault();
	app.history = new History(app.model.snapshot(), { initialLabel: "initial" });
	app.freeTransform = null;
	app.creationMode = null;
	app.startCurveDraft("circularArcCurve");
	app.addCurvePoint({ x: 0, y: 0 });
	app.addCurvePoint({ x: 20, y: 0 });
	app.addCurvePoint({ x: 0, y: 20 });
	assert.equal(app.curveDraft, null);
	assert.equal(dialogs.length, 1);
	assert.equal(dialogs[0].type, "circularArcCurve");
	assert.equal(dialogs[0].options.focusField, "segments");
});

test("Enter on a one-point pen draft does not cancel the draft", () => {
	const App = withHistoryCommands(
		withChartTools(
			class {
				exitModes() {
					this.creationMode = null;
				}

				refresh() {}

				refreshInteractionPreview() {}

				_refreshLightweight() {}

				updateDirty() {}

				queueMediaSync() {}

				restoreHistorySnapshot(snapshot) {
					this.model.restore(snapshot);
				}

				cancelPreview() {}

				cancelFreeTransform() {}
			},
		),
	);
	const app = new App();
	app.model = ChartModel.createDefault();
	app.history = new History(app.model.snapshot(), { initialLabel: "initial" });
	app.freeTransform = null;
	app.startCurveDraft("penCurve");
	app.startPenNode({ x: -10, y: 0 });
	assert.equal(app.curveDraft.penNodes.length, 1);
	app.finishCurveDraft();
	assert.ok(app.curveDraft);
	assert.equal(app.curveDraft.type, "penCurve");
	assert.equal(app.curveDraft.penNodes.length, 1);
});

test("undo during curve draft does not blank curveDraft before restore", () => {
	const refreshes = [];
	const App = withHistoryCommands(
		withChartTools(
			class {
				exitModes() {
					this.creationMode = null;
				}

				refresh() {
					refreshes.push({ type: "full", draft: this.curveDraft ? this.curveDraft.points.length : null });
				}

				refreshInteractionPreview(options = {}) {
					refreshes.push({
						type: "light",
						stageOnly: Boolean(options.stageOnly),
						draft: this.curveDraft ? this.curveDraft.points.length : null,
					});
				}

				_refreshLightweight() {}

				updateDirty() {}

				queueMediaSync() {}

				restoreHistorySnapshot(snapshot) {
					this.model.restore(snapshot);
					refreshes.push({ type: "restore" });
				}

				cancelPreview() {}

				cancelFreeTransform() {}
			},
		),
	);
	const app = new App();
	app.model = ChartModel.createDefault();
	app.history = new History(app.model.snapshot(), { initialLabel: "initial" });
	app.historyPanel = { render() {} };
	app.freeTransform = null;
	app.creationMode = null;
	app.startCurveDraft("circularArcCurve");
	app.addCurvePoint({ x: 0, y: 0 });
	app.addCurvePoint({ x: 10, y: 0 });
	refreshes.length = 0;
	app.undo();
	assert.equal(app.curveDraft.type, "circularArcCurve");
	assert.equal(app.curveDraft.points.length, 1);
	assert.equal(refreshes.some(item => item.type === "restore"), false);
	assert.equal(refreshes.some(item => item.type === "full"), false);
	assert.equal(refreshes.some(item => item.type === "light" && item.stageOnly), true);
});

test("confirming the bezier segments dialog keeps the entered count", async () => {
	const App = withHistoryCommands(
		withChartTools(
			class {
				exitModes() {
					this.creationMode = null;
				}

				refresh() {}

				refreshInteractionPreview() {}

				_refreshLightweight() {}

				updateDirty() {}

				queueMediaSync() {}

				restoreHistorySnapshot(snapshot) {
					this.model.restore(snapshot);
				}

				cancelPreview() {}

				cancelFreeTransform() {}

				preview() {}

				commit(_label, mutation) {
					mutation(this.model);
					return { ok: true };
				}
			},
		),
	);
	const app = new App();
	app.model = ChartModel.createDefault();
	app.history = new History(app.model.snapshot(), { initialLabel: "initial" });
	app.freeTransform = null;
	app.creationMode = null;
	app.dialogs = {
		async form({ values }) {
			return { ...values, segments: 5 };
		},
	};
	app.startCurveDraft("bezierCurve");
	app.addCurvePoint({ x: -40, y: 0 });
	app.addCurvePoint({ x: 40, y: 10 });
	await app.finishCurveDraft();
	const bezier = app.model.snappees.find(snappee => snappee.type === "bezierCurve");
	assert.ok(bezier);
	assert.equal(bezier.segments, 5);
	assert.equal(sampleSnappee(bezier).length, 6);
	assert.equal(bezier.selected, true);
});
