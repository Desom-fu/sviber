import assert from "node:assert/strict";
import test from "node:test";

import {
	canvasBufferSize,
	canvasHostSize,
	clampDevicePixelRatio,
} from "../js/render/pixi-surface.js";

test("canvasHostSize ignores a collapsed host so a 1px playhead cannot fill the panel", () => {
	assert.equal(canvasHostSize({ clientWidth: 0, clientHeight: 480 }), null);
	assert.equal(canvasHostSize({ clientWidth: 180, clientHeight: 0 }), null);
	assert.equal(canvasHostSize({ clientWidth: 0, clientHeight: 0 }), null);
	assert.deepEqual(canvasHostSize({ clientWidth: 180.4, clientHeight: 640.6 }), {
		width: 180,
		height: 641,
	});
});

test("clampDevicePixelRatio rejects non-finite values and caps at max", () => {
	assert.equal(clampDevicePixelRatio(Number.NaN), 1);
	assert.equal(clampDevicePixelRatio(0), 1);
	assert.equal(clampDevicePixelRatio(-2), 1);
	assert.equal(clampDevicePixelRatio(1.5), 1.5);
	assert.equal(clampDevicePixelRatio(4), 3);
	assert.equal(clampDevicePixelRatio(8, 2), 2);
});

test("canvasBufferSize scales CSS pixels by clamped dpr", () => {
	assert.deepEqual(canvasBufferSize(100, 50, 2), { width: 200, height: 100, ratio: 2 });
	assert.deepEqual(canvasBufferSize(100, 50, 4), { width: 300, height: 150, ratio: 3 });
	assert.deepEqual(canvasBufferSize(10.4, 20.6, 1), { width: 10, height: 21, ratio: 1 });
});
