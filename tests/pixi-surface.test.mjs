import assert from "node:assert/strict";
import test from "node:test";

import { canvasHostSize } from "../js/render/pixi-surface.js";

test("canvasHostSize ignores a collapsed host so a 1px playhead cannot fill the panel", () => {
	assert.equal(canvasHostSize({ clientWidth: 0, clientHeight: 480 }), null);
	assert.equal(canvasHostSize({ clientWidth: 180, clientHeight: 0 }), null);
	assert.equal(canvasHostSize({ clientWidth: 0, clientHeight: 0 }), null);
	assert.deepEqual(canvasHostSize({ clientWidth: 180.4, clientHeight: 640.6 }), {
		width: 180,
		height: 641,
	});
});
