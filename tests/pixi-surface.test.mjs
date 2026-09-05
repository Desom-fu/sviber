import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	canvas2dContextAttributes,
	canvasBufferSize,
	canvasHostSize,
	clampDevicePixelRatio,
	createResizeCoalescer,
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

test("canvas2dContextAttributes disables desynchronized presentation", () => {
	assert.deepEqual(canvas2dContextAttributes(), { alpha: false, desynchronized: false });
});

test("createResizeCoalescer collapses many schedules into one animation-frame flush", () => {
	const queue = [];
	const schedule = fn => {
		queue.push(fn);
		return queue.length;
	};
	let runs = 0;
	const coalesced = createResizeCoalescer(() => {
		runs += 1;
	}, schedule);
	coalesced();
	coalesced();
	coalesced();
	assert.equal(queue.length, 1);
	assert.equal(runs, 0);
	assert.ok(coalesced.pending());
	queue[0]();
	assert.equal(runs, 1);
	assert.equal(coalesced.pending(), 0);
	coalesced();
	assert.equal(queue.length, 2);
	queue[1]();
	assert.equal(runs, 2);
});

test("createResizeCoalescer cancel drops a pending flush", () => {
	const ids = new Map();
	let next = 1;
	const schedule = fn => {
		const id = next;
		next += 1;
		ids.set(id, fn);
		return id;
	};
	const cancel = id => ids.delete(id);
	let runs = 0;
	const coalesced = createResizeCoalescer(() => {
		runs += 1;
	}, schedule);
	coalesced();
	assert.equal(ids.size, 1);
	coalesced.cancel(cancel);
	assert.equal(ids.size, 0);
	assert.equal(coalesced.pending(), 0);
	assert.equal(runs, 0);
});

test("pixi surface coalesces ResizeObserver and avoids desynchronized + style-size churn", async () => {
	const [surface, css] = await Promise.all([
		readFile(new URL("../js/render/pixi-surface.js", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
	]);
	assert.match(surface, /createResizeCoalescer/);
	assert.match(surface, /desynchronized:\s*false/);
	assert.doesNotMatch(surface, /desynchronized:\s*true/);
	assert.doesNotMatch(surface, /canvas\.style\.width/);
	assert.doesNotMatch(surface, /canvas\.style\.height/);
	assert.match(css, /\.render-surface canvas\s*\{[^}]*position:\s*absolute/s);
	assert.match(css, /\.render-surface canvas\s*\{[^}]*width:\s*100%/s);
	assert.match(css, /\.render-surface canvas\s*\{[^}]*height:\s*100%/s);
});
