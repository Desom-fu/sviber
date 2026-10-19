import assert from "node:assert/strict";
import test from "node:test";

import { drawTipPointTrail, tipPointVisualState } from "../js/render/stage-helpers.js";

function recordingContext(withGradient = false) {
	const polygons = [];
	let points;
	return {
		polygons,
		...(withGradient ? {
			createLinearGradient() {
				const stops = [];
				return {
					stops,
					addColorStop(offset, color) {
						stops.push({ offset, color });
					},
				};
			},
		} : {}),
		save() {},
		restore() {},
		beginPath() { points = []; },
		moveTo(x, y) { points.push([x, y]); },
		lineTo(x, y) { points.push([x, y]); },
		closePath() {},
		fill() { polygons.push({ points, fillStyle: this.fillStyle }); },
	};
}

test("a teleport draws its same-time trail bridge like Sunniesnow's mesh", () => {
	const checkpoints = [
		{ time: 0, x: 0, y: 50 },
		{ time: 1, x: 20, y: 50 },
		{ time: 1, x: 100, y: 50 },
		{ time: 2, x: 120, y: 50 },
	];
	const visual = tipPointVisualState(checkpoints, 1.1);
	// Sunniesnow TipPoint.drawTrailThrough connects every adjacent checkpoint pair,
	// including teleports. The UV shader gives both ends opacity 0.4 in this fixture.
	for (const withGradient of [false, true]) {
		const context = recordingContext(withGradient);
		drawTipPointTrail(context, visual.trail, 6, visual.scale, visual.alpha);
		const bridge = context.polygons.find(polygon =>
			polygon.points.some(([x]) => x === 20) && polygon.points.some(([x]) => x === 100),
		);
		assert.ok(bridge, "the trail must not leave a gap between simultaneous checkpoints");
		assert.deepEqual(bridge.points, [[20, 47], [100, 47], [100, 53], [20, 53]]);
		const colors = withGradient ? bridge.fillStyle.stops.map(stop => stop.color) : [bridge.fillStyle];
		for (const color of colors) {
			const opacity = Number(color.match(/,([^,]+)\)$/)[1]);
			assert.ok(Math.abs(opacity - 0.4) < 1e-12);
		}
	}
});

test("an entirely zero-duration trail remains empty without invalid gradients", () => {
	const visual = tipPointVisualState([
		{ time: 1, x: 0, y: 50 },
		{ time: 1, x: 100, y: 50 },
	], 1.15);
	const context = recordingContext(true);
	drawTipPointTrail(context, visual.trail, 6, visual.scale, visual.alpha);
	assert.deepEqual(context.polygons, []);
});

test("a teleport bridge follows the trail fade and disappears after its trail window", () => {
	const checkpoints = [
		{ time: 0, x: 0, y: 50 },
		{ time: 1, x: 20, y: 50 },
		{ time: 1, x: 100, y: 50 },
	];
	const visual = tipPointVisualState(checkpoints, 1.15);
	const context = recordingContext(true);
	drawTipPointTrail(context, visual.trail, 6, visual.scale, visual.alpha);
	const bridge = context.polygons.at(-1);
	assert.ok(bridge.points.some(([x]) => x === 20));
	assert.ok(bridge.points.some(([x]) => x === 100));
	for (const { color } of bridge.fillStyle.stops) {
		const opacity = Number(color.match(/,([^,]+)\)$/)[1]);
		assert.ok(Math.abs(opacity - 0.25) < 1e-12);
	}
	assert.equal(tipPointVisualState(checkpoints, 1.501), null);
});
