import assert from "node:assert/strict";
import test from "node:test";
import { scrollbarNoteDensity } from "../js/render/timeline-helpers.js";

test("scrollbar heatmap counts tap hold flick and excludes drag", () => {
	const records = [
		{ event: { type: "tap" }, start: 0.1 },
		{ event: { type: "hold" }, start: 0.1 },
		{ event: { type: "flick" }, start: 0.1 },
		{ event: { type: "drag" }, start: 0.1 },
	];
	const density = scrollbarNoteDensity(records, [0, 1], 2);
	assert.deepEqual(density, [6, 0]);
});
