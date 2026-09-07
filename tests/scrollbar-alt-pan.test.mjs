import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TimelinePointerTrait } from "../js/render/timeline-pointer.js";

function altPanView() {
	// The move dispatch calls handlers with `{ point, project, layout, drag }`; build a
	// bare view that exercises that contract without a DOM or Pixi surface.
	const view = Object.create(TimelinePointerTrait.prototype);
	const ranges = [];
	view.callbacks = { onVisibleRange: (beginning, ending) => ranges.push([beginning, ending]) };
	view.state = { editor: { visibleRangeBeginning: 10, visibleRangeEnd: 20 } };
	view.surface = {
		width: 800,
		height: 120,
		toLocal: () => ({ x: 400, y: 110 }),
	};
	view._layout = () => ({
		waveform: { x: 0, y: 0, width: 800, height: 40 },
		channels: { x: 0, y: 40, width: 800, height: 55 },
		scroll: { x: 0, y: 95, width: 800, height: 25 },
		channelHeight: 13.75,
		visibleCount: 3,
	});
	view.pointerMoved = false;
	return { view, ranges };
}

test("Alt drag on the scrollbar moves the visible-range center without seeking", async () => {
	const source = await readFile(new URL("../js/render/timeline-pointer.js", import.meta.url), "utf8");
	assert.match(source, /_scrollbarAltPan/);
	assert.match(source, /event\.altKey && !event\.ctrlKey/);
	assert.match(source, /onVisibleRange/);
	assert.doesNotMatch(source, /_scrollbarAltPan[\s\S]{0,400}onSeek/);
});

test("Alt scrollbar pan follows pointer moves through the move-handler dispatch", () => {
	const { view, ranges } = altPanView();
	const project = view.state;
	const hit = {
		type: "scroll-range",
		x: 100,
		y: 95,
		width: 600,
		height: 25,
		bounds: [0, 60],
		rectangle: { x: 100, width: 600, y: 95, height: 25 },
	};
	const drag = view._scrollbarAltPan({ x: 400, y: 110 }, hit, project);
	assert.equal(drag.type, "scroll-alt");
	// `_pointerMove` measures the drag distance against `drag.start` for every drag type;
	// a scroll-alt drag without `start` throws on every move (can click but not drag).
	assert.deepEqual(drag.start, { x: 400, y: 110 });
	// The press itself already centers the range on the pointer.
	assert.ok(ranges.length === 1, "press did not apply the initial pan");
	// A pointer move with the same payload shape _pointerMove dispatches must keep moving
	// the range instead of throwing on the old positional signature.
	view._moveScrollAlt({ point: { x: 200, y: 110 }, drag, project });
	assert.ok(ranges.length === 2, "move did not apply the pan");
	const [beginning, ending] = ranges[1];
	assert.ok(beginning < ranges[0][0] && ending < ranges[0][1], "moving left did not move the range left");
});

test("Alt scrollbar pan survives the full _pointerMove threshold path", () => {
	const { view, ranges } = altPanView();
	const project = view.state;
	const hit = {
		type: "scroll-track",
		x: 0,
		y: 95,
		width: 800,
		height: 25,
		bounds: [0, 60],
		rectangle: { x: 0, width: 800, y: 95, height: 25 },
	};
	const drag = view._scrollbarAltPan({ x: 400, y: 110 }, hit, project);
	view.drag = drag;
	view.pointerMoved = false;
	// Map client coordinates into canvas space so the move covers real distance.
	view.surface.toLocal = event => ({ x: event.clientX - 100, y: event.clientY - 190 });
	// The real dispatch path: _pointerMove reads drag.start before handing off to the
	// handler; this used to throw "Cannot read properties of undefined (reading 'x')".
	view._pointerMove({ clientX: 600, clientY: 300 });
	assert.equal(view.pointerMoved, true);
	assert.ok(ranges.length === 2, "pointer move did not apply the pan");
	const [beginning, ending] = ranges[1];
	// Canvas x 500 of 800 → progress 0.625 → center 37.5 of [0, 60], span 10.
	assert.ok(Math.abs(beginning - 32.5) < 1e-9 && Math.abs(ending - 42.5) < 1e-9);
});

test("every timeline move handler accepts the dispatch payload", async () => {
	const source = await readFile(new URL("../js/render/timeline-pointer.js", import.meta.url), "utf8");
	// Handlers are dispatched as _handler({ point, project, layout, drag }); guard against
	// reintroducing a positional signature like the _moveScrollAlt regression.
	const registry = source.match(/const TIMELINE_MOVE_HANDLERS = \{[\s\S]*?\n\};/)[0];
	const handlers = [...registry.matchAll(/"[\w-]+": "(_move[A-Za-z]+)"/g)].map(match => match[1]);
	assert.ok(handlers.length >= 10, "move handler registry was not found");
	for (const handler of handlers) {
		const definition = source.match(new RegExp(`\\n\\t${handler}\\\\?\\((.+?)\\) \\{`));
		assert.ok(definition, `${handler} definition was not found`);
		assert.match(
			definition[1],
			/^\{/,
			`${handler} must destructure the dispatch payload instead of positional arguments`,
		);
	}
});
