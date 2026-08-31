import assert from "node:assert/strict";
import test from "node:test";
import { scrollbarHeatmapColors, scrollbarNoteDensity } from "../js/render/timeline-helpers.js";

test("scrollbar heatmap maps note density from dark gray to bright red", () => {
	const records = [
		{ event: { type: "tap" }, start: 0.1 },
		{ event: { type: "hold" }, start: 0.1 },
		{ event: { type: "comment" }, start: 0.1 },
	];
	const density = scrollbarNoteDensity(records, [0, 1], 2);
	assert.deepEqual(density, [4, 0]);
	assert.deepEqual(scrollbarHeatmapColors(density), ["#7f1f1f", "#1f1f1f"]);
});
