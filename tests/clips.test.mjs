import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TIMELINE_EVENT_COLORS } from "../js/render/timeline-helpers.js";
import { drawClipThumbnail } from "../js/ui/panels.js";

test("clip thumbnails resolve attached content and use the dedicated five-action layout", async () => {
	// The clips panel and its thumbnail painter now live in js/panel-clips.js, re-exported
	// from js/panels.js; the assertions below are unchanged apart from the module they read.
	const [panels, styles] = await Promise.all([
		readFile(new URL("../js/ui/panel-clips.js", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
	]);
	assert.match(panels, /drawClipThumbnail[\s\S]*resolveAttachedPosition\(event, data\?\.snappees/);
	assert.match(panels, /drawTimelineEventIcon\(context, event, 0, 0, TIMELINE_EVENT_COLORS\[event\.type\]/);
	assert.match(
		styles,
		/\.snappee-item\.clip-item\s*\{[\s\S]*grid-template-columns:\s*42px minmax\(0, 1fr\) repeat\(5, 25px\)/,
	);
	assert.match(styles, /\.snappee-item\.clip-item \.snappee-name\s*\{[^}]*padding-inline-start:\s*8px/);
});

test("clip thumbnails draw timeline icons and colors for each note type", () => {
	const fills = [];
	const strokes = [];
	const context = {
		fillStyle: "",
		strokeStyle: "",
		save() {},
		restore() {},
		scale() {},
		translate() {},
		fillRect() {},
		beginPath() {},
		arc() {},
		moveTo() {},
		lineTo() {},
		closePath() {},
		fill() {
			fills.push(this.fillStyle);
		},
		stroke() {
			strokes.push(this.strokeStyle);
		},
		fillText() {},
	};
	const canvas = { style: {}, getContext: () => context };
	drawClipThumbnail(canvas, {
		events: [
			{ type: "tap", x: 0, y: 0 },
			{ type: "hold", x: 20, y: 0 },
			{ type: "drag", x: 40, y: 0 },
			{ type: "flick", x: 0, y: 20 },
		],
	});
	assert.ok(fills.includes(TIMELINE_EVENT_COLORS.tap));
	assert.ok(fills.includes(TIMELINE_EVENT_COLORS.hold));
	assert.ok(fills.includes(TIMELINE_EVENT_COLORS.flick));
	assert.ok(strokes.includes(TIMELINE_EVENT_COLORS.drag));
});
