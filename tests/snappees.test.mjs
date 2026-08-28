import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EVENT_EDITING_MODULES, STAGE_INTERACTION_MODULES, readSources } from "./module-source.mjs";
import { withChartTools } from "../js/app/app-chart-tools.js";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { withFreeTransform } from "../js/app/app-free-transform.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { CommandRegistry } from "../js/app/commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { CHART_BOUNDS, sampleSnappee } from "../js/core/geometry.js";

test("snaps dragged pen handles and orients snappee previews like the stage", async () => {
	const [interactions, panels, editing, tools, transform, history] = await Promise.all([
		readSources(STAGE_INTERACTION_MODULES),
		readFile(new URL("../js/ui/panels.js", import.meta.url), "utf8"),
		readSources(EVENT_EDITING_MODULES),
		readFile(new URL("../js/app/app-curve-draft.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-free-transform.js", import.meta.url), "utf8"),
		readFile(new URL("../js/core/history.js", import.meta.url), "utf8"),
	]);
	assert.match(interactions, /_snapChartPoint\(chart, project, mapping\)/);
	// Both pen drags resolve their point through the shared snapper, and both drag kinds are
	// still routed to those handlers.
	assert.match(interactions, /_movePenNode\([\s\S]*?_snapChartPoint\(chart, project, mapping\)/);
	assert.match(interactions, /_movePenHandle\([\s\S]*?_snapChartPoint\(chart, project, mapping\)/);
	assert.match(interactions, /"pen-new": "_movePenNode"/);
	assert.match(interactions, /"draft-pen-handle": "_movePenHandle"/);
	assert.match(panels, /y: offsetY \+ \(maxY - point\.y\) \* scale/);
	assert.doesNotMatch(panels, /y: offsetY \+ \(point\.y - minY\) \* scale/);
	assert.match(history, /recordView\(view, label/);
	assert.match(transform, /history\.recordView\(\s*captureHistoryView\(this\.model[\s\S]*?selectedEventIds/);
	assert.match(editing, /this\.history\.recordView\(captureHistoryView\(this\.model\)/);
	assert.doesNotMatch(editing, /history\.record\(this\.model\.snapshot\(\), i18n\.t\("history\.selection"\)/);
	assert.match(
		editing,
		/viewOnly: true,\s*snappeeOnly: true,\s*rebuildIndex: false,\s*skipInspector: true,\s*scheduleDirty: false/,
	);
	assert.match(tools, /snappeesPanel\?\.syncFlags\?/);
	assert.match(tools, /selectSnappee\(id\) \{[\s\S]*?refreshInteractionPreview\?/);
	assert.doesNotMatch(tools, /selectSnappee\(id\) \{[\s\S]*?this\.refresh\(\);[\s\S]*?toggleSnappee/);
	assert.match(
		tools,
		/viewOnly: true,\s*snappeeOnly: true,\s*rebuildIndex: false,\s*skipInspector: true,\s*scheduleDirty: false/,
	);
	assert.match(tools, /moveSnappeeInList[\s\S]*?scheduleDirty: false/);
	assert.match(
		await readFile(new URL("../js/app/app-channel-commands.js", import.meta.url), "utf8"),
		/moveChannel[\s\S]*?channelOnly: true[\s\S]*?scheduleDirty: false/,
	);
	assert.match(panels, /syncFlags\(model, context = \{\}\)/);
	// The history panel now lives in js/panel-history.js, re-exported from js/panels.js.
	assert.match(await readFile(new URL("../js/ui/panel-history.js", import.meta.url), "utf8"), /dataset\.historyId/);
});

test("selected pen snappees support flips, translation, and free-transform bounds", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [
			{
				id: 12,
				type: "penCurve",
				name: "Pen line",
				active: true,
				selected: true,
				transformation: [1, 0, 0, 1, 0, 0],
				commands: [
					{ type: "M", x: 10, y: 0 },
					{ type: "C", x1: 14, y1: 0, x2: 18, y2: 0, x: 22, y: 0 },
				],
				segments: 8,
				closed: false,
			},
		],
	});
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	assert.equal(app.transformationAvailable(model), true);
	assert.equal(app._applyTransformMutation(model, [-1, 0, 0, 1, 0, 0]), true);
	assert.deepEqual(model.snappees[0].transformation, [-1, 0, 0, 1, 0, 0]);
	assert.equal(app._applyTransformMutation(model, [1, 0, 0, -1, 0, 0]), true);
	assert.deepEqual(
		model.snappees[0].transformation.map(value => (value === 0 ? 0 : value)),
		[-1, 0, 0, -1, 0, 0],
	);
	assert.ok(app.transformSelectionBounds(model).maxY > app.transformSelectionBounds(model).minY);
	assert.equal(app._applyTransformMutation(model, [1, 0, 0, 1, 5, 7]), true);
	assert.deepEqual(
		model.snappees[0].transformation.map(value => (value === 0 ? 0 : value)),
		[-1, 0, 0, -1, 5, 7],
	);
});

test("transform commands are enabled for a selected snappee without selected events", () => {
	const model = ChartModel.createDefault({
		events: [],
		snappees: [
			{
				id: 20,
				type: "bezierCurve",
				name: "Curve",
				active: true,
				selected: true,
				transformation: [1, 0, 0, 1, 0, 0],
				controlPoints: [
					{ x: -20, y: -10 },
					{ x: 20, y: 10 },
				],
				segments: 4,
				closed: false,
			},
		],
	});
	const CommandApp = withHistoryCommands(withEventEditing(class {}));
	const app = new CommandApp();
	app.model = model;
	app.registry = new CommandRegistry();
	app._registerCommands();
	for (const id of [
		"transform.moveLeft",
		"transform.flipHorizontal",
		"transform.flipVertical",
		"transform.free",
		"transform.matrix",
	]) {
		assert.equal(app.registry.isEnabled(id, app), true, `${id} should be enabled`);
	}
});

test("a duplicated circular arc remains movable and serializable in the composed app", () => {
	const model = ChartModel.createDefault();
	const source = model.addSnappee("circularArcCurve", {
		name: "Arc",
		centerX: -20,
		centerY: 0,
		radius: 20,
		beginningAngle: 0,
		endAngle: 0,
		closed: true,
		segments: 24,
	});
	const TestApp = withChartTools(
		withEventEditing(
			class {
				constructor() {
					this.model = model;
				}

				commit(_label, mutation) {
					return mutation(this.model);
				}

				preview(_label, mutation) {
					return mutation(this.model);
				}
			},
		),
	);
	const app = new TestApp();

	app.duplicateSnappee(source.id);
	const copy = model.snappees.at(-1);
	assert.equal(copy.type, "circularArcCurve");
	app.moveSnappee(copy.id, { x: 5, y: 0 });
	assert.deepEqual(copy.transformation, [1, 0, 0, 1, 5, 0]);
	assert.ok(model.snappees.every(snappee => snappee && typeof snappee === "object"));
	assert.doesNotThrow(() => model.serialize());

	app.moveSnappeeInList(copy.id, -1);
	assert.equal(model.snappees.at(-2).id, copy.id);
	app.moveSnappeeInList(copy.id, { x: 1, y: 0 });
	assert.ok(model.snappees.every(snappee => snappee && typeof snappee === "object"));
});

test("snappee body movement clamps at the chart boundary instead of snapping back", () => {
	const model = ChartModel.createDefault();
	const arc = model.addSnappee("circularArcCurve", {
		name: "Near edge",
		centerX: -49.60404751429828,
		centerY: 0.13060513713539224,
		radius: 49.868015838099424,
		beginningAngle: 0,
		endAngle: 0,
		closed: true,
		segments: 24,
	});
	const TestApp = withEventEditing(
		class {
			constructor() {
				this.model = model;
			}

			commit(_label, mutation) {
				return mutation(this.model);
			}

			preview(_label, mutation) {
				return mutation(this.model);
			}
		},
	);
	const app = new TestApp();

	app.moveSnappee(arc.id, { x: -5, y: 0 });
	const transformed = sampleSnappee(arc);
	assert.ok(
		transformed.every(
			point =>
				point.x >= CHART_BOUNDS.minX &&
				point.x <= CHART_BOUNDS.maxX &&
				point.y >= CHART_BOUNDS.minY &&
				point.y <= CHART_BOUNDS.maxY,
		),
	);
	assert.ok(arc.transformation[4] < 0);
	assert.ok(arc.transformation[4] > -1);
});

test("snappee pan preview publishes moved snappees so the stage follows the pointer", () => {
	const model = ChartModel.createDefault();
	const snappee = model.addSnappee("rectangularMesh", {
		name: "Small",
		selected: true,
		topLeftX: -10,
		topLeftY: 10,
		bottomRightX: 10,
		bottomRightY: -10,
		horizontalTiles: 2,
		verticalTiles: 2,
	});
	const App = withEventEditing(
		class {
			preview(_label, mutation, options = {}) {
				this.lastPreviewOptions = options;
				return mutation(this.model);
			}
		},
	);
	const app = new App();
	app.model = model;
	const before = [...snappee.transformation];
	app.previewSnappeeMove(snappee.id, { x: 12.5, y: -4 });
	assert.equal(app.lastPreviewOptions.snappees, true);
	assert.equal(app.lastPreviewOptions.snappeeId, snappee.id);
	assert.equal(app.lastPreviewOptions.stageOnly, true);
	assert.equal(app.lastPreviewOptions.positionOnly, undefined);
	const moved = model.snappees.find(item => item.id === snappee.id);
	assert.equal(moved.transformation[4], before[4] + 12.5);
	assert.equal(moved.transformation[5], before[5] - 4);
});

test("snappee preview refresh swaps the live snappee list onto the stage", () => {
	const App = withFreeTransform(class {});
	const app = new App();
	const snappees = [{ id: 7, transformation: [1, 0, 0, 1, 8, 2] }];
	app.model = { snappees };
	app.timeline = { state: { snappees: [] }, requestRender() {} };
	app.stage = { state: { snappees: [] }, requestRender() {} };
	app.scrollView = { state: { snappees: [] }, requestRender() {} };
	app.renderIndex = {
		snappeeSamples: new Map([["stale", true]]),
		snappeePaths: new Map([["stale", true]]),
		eventRecords: [],
	};
	app._rebuildRenderIndex = () => {};
	app.requestStatusUpdate = () => {};
	app.refreshInteractionPreview({ rebuildIndex: false, snappees: true, snappeeId: 7, stageOnly: true });
	assert.equal(app.stage.state.snappees, snappees);
	assert.equal(app.timeline.state.snappees, snappees);
	assert.equal(app.renderIndex.snappeeSamples.size, 0);
	assert.equal(app.renderIndex.snappeePaths.size, 0);
});
