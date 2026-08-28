import assert from "node:assert/strict";
import test from "node:test";
import { STAGE_INTERACTION_MODULES, readSources } from "./module-source.mjs";
import { findNearestSnapPoint } from "../js/core/geometry.js";
import { TimingMap } from "../js/core/timing.js";

test("snap-to-point uses the v12 6.25 boundary exactly", async () => {
	const snappee = {
		id: 1,
		type: "rectangularMesh",
		active: true,
		transformation: [1, 0, 0, 1, 0, 0],
		topLeftX: -10,
		topLeftY: 10,
		bottomRightX: 10,
		bottomRightY: -10,
		horizontalTiles: 1,
		verticalTiles: 1,
	};
	assert.equal(findNearestSnapPoint({ x: -3.75, y: 10 }, [snappee], { maxDistance: 6.25 })?.snappeeId, 1);
	assert.equal(findNearestSnapPoint({ x: -3.749999, y: 10 }, [snappee], { maxDistance: 6.25 }), null);
	const source = await readSources(STAGE_INTERACTION_MODULES);
	assert.match(source, /maxDistance: 6\.25/);
});

test("bar lines drive rational beat lines and snapping", () => {
	const timing = new TimingMap({ initialBpm: 120, barLines: [{ time: [1, 2, 3] }] });
	const lines = timing.beatLinesBetween([0, 0, 1], [3, 0, 1], 2);
	assert.ok(lines.some(line => line.barLine && line.beat.equals([1, 2, 3])));
	assert.equal(lines.find(line => line.beat.equals([2, 1, 6])).relative.toString(), "1/2");
	assert.equal(lines.find(line => line.barLine).beat.toString(), "1+2/3");
	assert.equal(timing.snapBeat([2, 1, 6], 2).toString(), "2+1/6");
	assert.deepEqual(timing.toJSON().barLines, [{ time: [1, 2, 3] }]);
});
