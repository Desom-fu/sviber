import assert from "node:assert/strict";
import test from "node:test";

import { withCurveDraft } from "../js/app/app-curve-draft.js";
import { withFreeTransform } from "../js/app/app-free-transform.js";
import { TimelineMarkersTrait } from "../js/render/timeline-markers.js";
import { ChartModel } from "../js/core/chart-model.js";

test("selecting a snappee renders the timeline so the scrollbar marks follow", () => {
	const renders = [];
	const App = withCurveDraft(withFreeTransform(class {}));
	const app = new App();
	app.model = ChartModel.createDefault({ channels: [{ id: 0 }] });
	app.timeline = { requestRender: () => renders.push("timeline") };
	app.stage = { requestRender: () => renders.push("stage") };
	app.scrollView = null;
	app._rebuildRenderIndex = () => {};
	app.requestStatusUpdate = () => {};
	const target = app.model.snappees[0];
	assert.equal(app.selectSnappee(target.id), true);
	assert.ok(renders.includes("timeline"), "the timeline renders so the scrollbar marks update");
	assert.ok(renders.includes("stage"));
	// Clearing the selection (the panel toggles a row off) renders the timeline as well.
	renders.length = 0;
	assert.equal(app.selectSnappee(null), true);
	assert.ok(renders.includes("timeline"));
});

test("snappee scrollbar marks read the render index and fall back to flattening", () => {
	const strokes = [];
	const context = {
		strokeStyle: "",
		globalAlpha: 1,
		lineWidth: 1,
		beginPath() {},
		moveTo() {},
		lineTo() {},
		stroke() {
			strokes.push(this.strokeStyle);
		},
	};
	const trait = Object.create(TimelineMarkersTrait.prototype);
	trait.timing = { beatToSeconds: () => 5 };
	const attached = { attached: true, snappee: 7, time: [5, 0, 1], type: "tap", channel: 0 };
	const otherSnappee = { attached: true, snappee: 8, time: [6, 0, 1], type: "tap", channel: 0 };
	const project = {
		snappees: [{ id: 7, selected: true, color: "#ff0000" }],
		events: [{ type: "group", events: [attached, otherSnappee] }],
	};
	const rectangle = { x: 0, y: 0, width: 100, height: 10 };
	trait.renderIndex = { eventRecords: [{ event: attached }, { event: otherSnappee }] };
	trait._drawSnappeeScrollbarMarks(context, rectangle, project, [0, 10]);
	assert.deepEqual(strokes, ["#ff0000"]);
	assert.equal(context.globalAlpha, 1, "the alpha is restored after drawing");
	// Without a render index the same marks come from flattening the chart.
	trait.renderIndex = undefined;
	trait._drawSnappeeScrollbarMarks(context, rectangle, project, [0, 10]);
	assert.deepEqual(strokes, ["#ff0000", "#ff0000"]);
});
