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

test("finishing an arc opens the segments dialog like bezier and pen", async () => {
	const forms = [];
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
		async form(spec) {
			forms.push(spec);
			return { ...spec.values };
		},
	};
	app.startCurveDraft("circularArcCurve");
	app.addCurvePoint({ x: 0, y: 0 });
	app.addCurvePoint({ x: 20, y: 0 });
	await app.addCurvePoint({ x: 0, y: 20 });
	assert.equal(app.curveDraft, null);
	assert.equal(forms.length, 1);
	assert.equal(forms[0].focusField, "segments");
	assert.equal(
		app.model.snappees.some(snappee => snappee.type === "circularArcCurve"),
		true,
	);
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

test("Enter or double-click on a pen draft creates the snappee and opens the dialog", async () => {
	const forms = [];
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
		async form(spec) {
			forms.push(spec);
			return { ...spec.values };
		},
	};
	app.startCurveDraft("penCurve");
	app.startPenNode({ x: -20, y: 0 });
	app.startPenNode({ x: 20, y: 10 });
	await app.finishCurveDraft();
	assert.equal(app.curveDraft, null);
	const pen = app.model.snappees.find(snappee => snappee.type === "penCurve");
	assert.ok(pen);
	assert.equal(pen.closed, false);
	assert.deepEqual(pen.commands, [
		{ type: "M", x: -20, y: 0 },
		{ type: "L", x: 20, y: 10 },
	]);
	assert.equal(forms.length, 1);
	assert.equal(forms[0].focusField, "segments");
});

test("closing a pen loop keeps the first point and appends the closing segment", async () => {
	const forms = [];
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
		async form(spec) {
			forms.push(spec);
			return { ...spec.values };
		},
	};
	// Clicking the first point (activateCurveDraftPoint(0)) closes the loop.
	app.startCurveDraft("penCurve");
	app.startPenNode({ x: -20, y: 0 });
	app.startPenNode({ x: 20, y: 10 });
	assert.equal(app.activateCurveDraftPoint(0), true);
	assert.equal(app.curveDraft, null);
	const closed = app.model.snappees.find(snappee => snappee.type === "penCurve");
	assert.ok(closed);
	assert.equal(closed.closed, true);
	assert.deepEqual(closed.commands, [
		{ type: "M", x: -20, y: 0 },
		{ type: "L", x: 20, y: 10 },
		{ type: "L", x: -20, y: 0 },
	]);
	// A click near the first point (startPenNode close branch) closes too.
	app.startCurveDraft("penCurve");
	app.startPenNode({ x: 0, y: 0 });
	app.startPenNode({ x: 30, y: 0 });
	assert.equal(app.startPenNode({ x: 1, y: 0 }), null);
	const nearClosed = app.model.snappees.filter(snappee => snappee.type === "penCurve").at(-1);
	assert.equal(nearClosed.closed, true);
	assert.deepEqual(nearClosed.commands.at(-1), { type: "L", x: 0, y: 0 });
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
