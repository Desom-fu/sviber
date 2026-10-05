import assert from "node:assert/strict";
import test from "node:test";

import { WaveformPeaks } from "../js/audio/waveform.js";
import { TimelineDrawingTrait } from "../js/render/timeline-drawing.js";
import { WAVEFORM_STROKE, WaveformViewCache } from "../js/render/waveform-blit.js";

// Playback re-renders the timeline every clock tick. The waveform cache must blit the
// same canvas while the view is still, and a play-follow pan must only sample the
// entering strip instead of rescanning the whole visible range.

function fakeCanvas(width = 0, height = 0) {
	const canvas = { width, height };
	canvas.getContext = () => {
		canvas.context ||= {
			fillStyle: "",
			strokeStyle: "",
			globalAlpha: 1,
			lineWidth: 1,
			fillRect() {},
			beginPath() {},
			moveTo() {},
			lineTo() {},
			stroke() {},
			drawImage() {},
		};
		return canvas.context;
	};
	return canvas;
}

function cacheWithCanvases() {
	const canvases = [];
	const cache = new WaveformViewCache({
		createCanvas(width, height) {
			const canvas = fakeCanvas(width, height);
			canvases.push(canvas);
			return canvas;
		},
	});
	return { cache, canvases };
}

function mockWaveform() {
	const channels = [new Float32Array(64)];
	const calls = [];
	return {
		channels,
		calls,
		getColumns(start, end, width) {
			calls.push({ start, end, width });
			const count = Math.max(1, Math.floor(width));
			return Array.from({ length: count }, () => ({ min: -0.25, max: 0.5 }));
		},
	};
}

test("the waveform stroke color stays the documented gray", () => {
	assert.equal(WAVEFORM_STROKE, "#8c9298");
});

test("the waveform grid is cached until the audio, the view or the size change", () => {
	const { cache } = cacheWithCanvases();
	const drawn = [];
	const context = {
		drawImage(canvas) {
			drawn.push(canvas);
		},
	};
	const rectangle = { x: 0, y: 0, width: 20, height: 8 };
	const waveform = mockWaveform();

	cache.blit(context, rectangle, waveform, 0, 1);
	const first = cache.canvas;
	assert.ok(first, "the first draw paints and caches a canvas");
	assert.equal(drawn.at(-1), first);
	assert.equal(waveform.calls.length, 1);
	assert.equal(waveform.calls[0].width, 20);

	cache.blit(context, rectangle, waveform, 0, 1);
	assert.equal(drawn.at(-1), first, "an unchanged view blits the cached canvas");
	assert.equal(waveform.calls.length, 1, "an unchanged view does not resample peaks");

	cache.blit(context, rectangle, waveform, 0.05, 1.05);
	assert.equal(waveform.calls.length, 2, "a one-pixel pan samples only the entering strip");
	assert.equal(waveform.calls[1].width, 1);
	assert.equal(drawn.at(-1), cache.canvas);

	cache.blit(context, rectangle, waveform, 0.05, 1.05);
	assert.equal(waveform.calls.length, 2, "the panned view is cached too");

	const other = mockWaveform();
	cache.blit(context, rectangle, other, 0.05, 1.05);
	assert.equal(other.calls.length, 1, "new audio recomputes the whole view");
	assert.equal(other.calls[0].width, 20);
});

test("a zoom or a seek past one screen rebuilds the whole waveform", () => {
	const { cache } = cacheWithCanvases();
	const context = { drawImage() {} };
	const rectangle = { x: 0, y: 0, width: 20, height: 8 };
	const waveform = mockWaveform();
	cache.blit(context, rectangle, waveform, 0, 1);
	cache.blit(context, rectangle, waveform, 0, 2);
	assert.equal(waveform.calls.at(-1).width, 20, "a zoom rebuilds");
	cache.blit(context, rectangle, waveform, 4, 5);
	assert.equal(waveform.calls.at(-1).width, 20, "a seek past the view rebuilds");
});

test("timeline waveform paint goes through the view cache", () => {
	const drawn = [];
	const context = {
		fillRect() {},
		beginPath() {},
		moveTo() {},
		lineTo() {},
		stroke() {},
		drawImage(canvas) {
			drawn.push(canvas);
		},
	};
	const rectangle = { x: 0, y: 0, width: 16, height: 8 };
	const trait = Object.create(TimelineDrawingTrait.prototype);
	const waveform = mockWaveform();
	trait.callbacks = { getWaveform: () => waveform };
	trait._waveformCache = cacheWithCanvases().cache;
	const editor = { visibleRangeBeginning: 0, visibleRangeEnd: 1, spectrogram: { show: false } };

	trait._drawWaveform(context, rectangle, editor);
	const first = trait._waveformCache.canvas;
	assert.ok(first);
	assert.equal(drawn.at(-1), first);
	trait._drawWaveform(context, rectangle, editor);
	assert.equal(drawn.at(-1), first);
	assert.equal(waveform.calls.length, 1);
});

test("WaveformPeaks columns report min and max of mixed samples per pixel", () => {
	const samples = new Float32Array([0, 1, -1, 0.5, -0.5, 0]);
	const peaks = new WaveformPeaks([samples], 2);
	const columns = peaks.getColumns(0, 3, 3).map(column => ({ min: column.min, max: column.max }));
	assert.deepEqual(columns, [
		{ min: 0, max: 1 },
		{ min: -1, max: 0.5 },
		{ min: -0.5, max: 0 },
	]);
});

test("WaveformPeaks mixes channels and uses the pyramid above eight samples per pixel", () => {
	const left = Float32Array.from({ length: 64 }, (_, index) => (index < 8 ? 1 : 0));
	const right = Float32Array.from({ length: 64 }, (_, index) => (index < 8 ? -1 : 0.5));
	const peaks = new WaveformPeaks([left, right], 32);
	assert.equal(peaks.levels[0].bucketSize, 8);
	const zoomed = peaks.getColumns(0, 0.25, 4).map(column => ({ min: column.min, max: column.max }));
	assert.equal(zoomed[0].min, 0);
	assert.equal(zoomed[0].max, 0);
	const overview = peaks.getColumns(0, 2, 4);
	assert.ok(overview[0].max > 0);
	assert.ok(overview[0].min <= 0);
});
