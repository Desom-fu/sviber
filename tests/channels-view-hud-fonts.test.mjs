import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HUD_FONT_FAMILY } from "../js/render/stage-hud.js";
import { TimelineDrawingTrait } from "../js/render/timeline-drawing.js";
import { drawTimelineEventIcon } from "../js/render/timeline-helpers.js";
import { ChartModel } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";

function createRecordingContext() {
	const drawn = [];
	const stack = [];
	let currentFont = "";
	const context = {
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
		globalAlpha: 1,
		textAlign: "left",
		textBaseline: "alphabetic",
		lineCap: "butt",
		get font() {
			return currentFont;
		},
		set font(value) {
			currentFont = value;
		},
		save() {
			stack.push(currentFont);
		},
		restore() {
			if (stack.length) {
				currentFont = stack.pop();
			}
		},
		beginPath() {},
		moveTo() {},
		lineTo() {},
		arc() {},
		closePath() {},
		fill() {},
		stroke() {},
		fillRect() {},
		strokeRect() {},
		clip() {},
		rect() {},
		translate() {},
		rotate() {},
		measureText(text) {
			return { width: String(text).length * 6 };
		},
		fillText(text) {
			drawn.push({ text: String(text), font: currentFont });
		},
	};
	return { context, drawn };
}

test("channels view texts use the main editor HUD font families", async () => {
	const [drawingSource, helpersSource] = await Promise.all([
		readFile(new URL("../js/render/timeline-drawing.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/timeline-helpers.js", import.meta.url), "utf8"),
	]);
	assert.doesNotMatch(drawingSource, /sans-serif/);
	assert.doesNotMatch(helpersSource, /sans-serif/);

	const model = ChartModel.createDefault({
		channels: [{ id: 0, name: "Melody", color: "#55aaff", active: true }],
		timing: {
			offset: 0,
			initialBpm: 120,
			bpmChanges: [{ time: [1, 0, 1], bpm: 150 }],
			barLines: [],
		},
		editor: { visibleRangeBeginning: 0, visibleRangeEnd: 4, subdivision: 4 },
	});
	const hold = model.addEvent("hold", {
		time: [1, 0, 1],
		duration: [2, 0, 1],
		channel: 0,
		x: 0,
		y: 0,
		text: "A",
	});
	const comment = model.addEvent("comment", {
		time: [2, 0, 1],
		duration: [1, 0, 1],
		channel: 0,
		text: "note",
	});

	const drawer = Object.create(TimelineDrawingTrait.prototype);
	drawer.timing = new TimingMap(model.timing);
	drawer.hitRegions = [];
	drawer._timeToX = (seconds, width) => (seconds / 4) * width;
	drawer._visibleChannels = project => project.channels;
	drawer._channelBand = () => ({ top: 40, height: 32, center: 56 });
	drawer.callbacks = {};

	const { context, drawn } = createRecordingContext();
	const layout = {
		waveform: { x: 0, y: 0, width: 400, height: 40 },
		channels: { x: 0, y: 40, width: 400, height: 96 },
		scroll: { x: 0, y: 136, width: 400, height: 14 },
	};
	drawer._drawBeatLines(context, layout, model.editor);
	drawer._drawChannels(context, layout, model);
	drawer._drawEventLabel(context, hold, 100, 56, 200, 1, 1);
	drawer._drawEventLabel(context, comment, 200, 56, 260, 1, 1);
	drawer._drawBpmChanges(context, layout.waveform, model);
	drawTimelineEventIcon(context, { type: "tap", text: "Z" }, 80, 56, "#ffffff", 1);
	drawTimelineEventIcon(context, { type: "grid", text: "" }, 120, 56, "#ffffff", 1);
	drawTimelineEventIcon(context, { type: "comment", text: "hi" }, 160, 56, "#ffffff", 1);

	assert.ok(drawn.length >= 6);
	assert.ok(drawn.some(entry => entry.text === "Melody"));
	assert.ok(drawn.some(entry => entry.text === "A"));
	assert.ok(drawn.some(entry => entry.text === "Z"));
	assert.ok(drawn.some(entry => entry.text === "150"));
	for (const entry of drawn) {
		assert.ok(
			entry.font.includes(HUD_FONT_FAMILY),
			`Expected HUD font family for "${entry.text}", got "${entry.font}"`,
		);
	}
});
