import assert from "node:assert/strict";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import {
	DEFAULT_SPECTROGRAM,
	normalizeSpectrogram,
	renderSpectrogramGrid,
	spectrogramColor,
} from "../js/core/spectrogram.js";
import { createWindow } from "../js/dsp/window.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";
import { blitSpectrogram } from "../js/render/spectrogram-blit.js";
import { readFile } from "node:fs/promises";

test("spectrogram defaults match PROMPT-v26", () => {
	const settings = normalizeSpectrogram({});
	assert.equal(settings.show, false);
	assert.equal(settings.blackAsHigh, false);
	assert.equal(settings.windowWidth, 0.005);
	assert.equal(settings.windowShape, "gaussian");
	assert.deepEqual(settings.frequencyRange, [0, 5000]);
	assert.equal(settings.dynamicRange, 50);
	assert.equal(DEFAULT_SPECTROGRAM.windowWidth, 0.005);
});

test("spectrogram color is 1 + intensity_dB / dynamic_range with clamp and black-as-high", () => {
	assert.equal(spectrogramColor(0, 50), 1);
	assert.equal(spectrogramColor(-50, 50), 0);
	assert.equal(spectrogramColor(-25, 50), 0.5);
	assert.equal(spectrogramColor(-100, 50), 0);
	assert.equal(spectrogramColor(0, 50, true), 0);
	assert.equal(spectrogramColor(-50, 50, true), 1);
});

test("Gaussian window is the spectrogram default and is peaked at the centre", () => {
	const window = createWindow(11, "gaussian");
	assert.ok(window[5] > window[0]);
	assert.ok(window[5] > window[10]);
});

test("STFT of a sine peaks near the source frequency in the visible grid", () => {
	const sampleRate = 44100;
	const frequency = 440;
	const samples = Float32Array.from({ length: sampleRate }, (_, index) =>
		Math.sin((2 * Math.PI * frequency * index) / sampleRate),
	);
	const grid = renderSpectrogramGrid({
		samples,
		sampleRate,
		timeStart: 0.2,
		timeEnd: 0.4,
		width: 4,
		height: 32,
		settings: {
			windowWidth: 0.05,
			windowShape: "gaussian",
			frequencyRange: [0, 1000],
			dynamicRange: 50,
			blackAsHigh: false,
			show: true,
		},
	});
	let peakRow = 0;
	let peak = -1;
	for (let row = 0; row < grid.height; row += 1) {
		let sum = 0;
		for (let column = 0; column < grid.width; column += 1) {
			sum += grid.values[row * grid.width + column];
		}
		if (sum > peak) {
			peak = sum;
			peakRow = row;
		}
	}
	const peakHz = ((grid.height - 1 - peakRow + 0.5) / grid.height) * 1000;
	assert.ok(Math.abs(peakHz - 440) < 80, `peak ${peakHz} Hz should be near 440`);
});

test("chart JSON round-trips spectrogram settings", () => {
	const model = ChartModel.createDefault({
		editor: {
			spectrogram: {
				show: true,
				blackAsHigh: true,
				windowWidth: 0.01,
				windowShape: "hann",
				frequencyRange: [100, 2000],
				dynamicRange: 40,
			},
		},
	});
	const restored = ChartModel.import({ metadata: model.metadata, sviber: model.serializeSviber() });
	assert.deepEqual(restored.editor.spectrogram, {
		show: true,
		blackAsHigh: true,
		windowWidth: 0.01,
		windowShape: "hann",
		frequencyRange: [100, 2000],
		dynamicRange: 40,
	});
});

test("Music menu contains Spectrogram and Timing contains subdivisions", () => {
	assert.ok(COMMAND_DEFINITIONS["music.spectrogram"]);
	const music = MENU_DEFINITION.find(menu => menu.id === "music");
	const timing = MENU_DEFINITION.find(menu => menu.id === "timing");
	assert.ok(music.items.some(item => item.command === "music.spectrogram"));
	assert.ok(!music.items.some(item => item.command === "music.subdivision1"));
	assert.ok(timing.items.some(item => item.command === "music.subdivision1"));
	assert.ok(timing.items.some(item => item.command === "music.subdivisionOther"));
});

test("blitSpectrogram uses drawImage so dpr setTransform scales the CSS destination", () => {
	const destinationPuts = [];
	const draws = [];
	const sourcePuts = [];
	const context = {
		putImageData(...args) {
			destinationPuts.push(args);
		},
		drawImage(...args) {
			draws.push(args);
		},
	};
	const image = { data: new Uint8ClampedArray(8 * 4 * 4), width: 8, height: 4 };
	const rectangle = { x: 0, y: 12, width: 200, height: 80 };
	const painted = blitSpectrogram(context, rectangle, image, {
		createCanvas: (width, height) => ({
			width,
			height,
			getContext: () => ({
				putImageData(data, x, y) {
					sourcePuts.push({ width, height, x, y, bytes: data?.data?.length ?? data?.length });
				},
			}),
		}),
	});
	assert.equal(destinationPuts.length, 0);
	assert.equal(draws.length, 1);
	assert.equal(draws[0][1], rectangle.x);
	assert.equal(draws[0][2], rectangle.y);
	assert.equal(draws[0][3], rectangle.width);
	assert.equal(draws[0][4], rectangle.height);
	assert.equal(sourcePuts.length, 1);
	assert.equal(sourcePuts[0].width, 8);
	assert.equal(sourcePuts[0].height, 4);
	assert.deepEqual(painted, rectangle);
});

test("timeline spectrogram paint goes through blitSpectrogram, not destination putImageData", async () => {
	const drawing = await readFile(new URL("../js/render/timeline-drawing.js", import.meta.url), "utf8");
	const surface = await readFile(new URL("../js/render/pixi-surface.js", import.meta.url), "utf8");
	assert.match(drawing, /blitSpectrogram\(context, rectangle, image\)/);
	assert.doesNotMatch(drawing, /putImageData/);
	assert.match(surface, /setTransform\(dpr, 0, 0, dpr, 0, 0\)/);
});
