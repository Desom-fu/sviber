import assert from "node:assert/strict";
import test from "node:test";
import { assertClose } from "./assert-close.mjs";

import { WaveformPeaks } from "../js/audio/waveform.js";
import { TimelineDrawingTrait } from "../js/render/timeline-drawing.js";
import {
	WAVEFORM_CACHE_OVERSCAN,
	WAVEFORM_STROKE,
	WaveformViewCache,
	waveformBlitOffset,
} from "../js/render/waveform-blit.js";

// Playback re-renders the timeline every clock tick. The waveform cache must blit the
// same canvas while the view is still, sample only the entering strip on a pan, and
// drawImage at a fractional offset so the waveform walks with the beat lines.

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
			save() {},
			restore() {},
			rect() {},
			clip() {},
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

function destination() {
	const drawn = [];
	return {
		drawn,
		context: {
			save() {},
			restore() {},
			beginPath() {},
			rect() {},
			clip() {},
			drawImage(canvas, x, y, width, height) {
				drawn.push({ canvas, x, y, width, height });
			},
		},
	};
}

test("the waveform stroke color stays the documented gray", () => {
	assert.equal(WAVEFORM_STROKE, "#8c9298");
});

test("the waveform grid is cached until the audio, the view or the size change", () => {
	const { cache } = cacheWithCanvases();
	const dest = destination();
	const rectangle = { x: 0, y: 0, width: 20, height: 8 };
	const waveform = mockWaveform();
	const canvasWidth = 20 + WAVEFORM_CACHE_OVERSCAN * 2;

	cache.blit(dest.context, rectangle, waveform, 0, 1);
	const first = cache.canvas;
	assert.ok(first, "the first draw paints and caches a canvas");
	assert.equal(dest.drawn.at(-1).canvas, first);
	assert.equal(waveform.calls.length, 1);
	assert.equal(waveform.calls[0].width, canvasWidth);

	cache.blit(dest.context, rectangle, waveform, 0, 1);
	assert.equal(dest.drawn.at(-1).canvas, first, "an unchanged view blits the cached canvas");
	assert.equal(waveform.calls.length, 1, "an unchanged view does not resample peaks");

	cache.blit(dest.context, rectangle, waveform, 0.05, 1.05);
	assert.equal(waveform.calls.length, 2, "a one-pixel pan samples only the entering strip");
	assert.equal(waveform.calls[1].width, 1);
	assert.equal(dest.drawn.at(-1).canvas, cache.canvas);

	cache.blit(dest.context, rectangle, waveform, 0.05, 1.05);
	assert.equal(waveform.calls.length, 2, "the panned view is cached too");

	const other = mockWaveform();
	cache.blit(dest.context, rectangle, other, 0.05, 1.05);
	assert.equal(other.calls.length, 1, "new audio recomputes the whole view");
	assert.equal(other.calls[0].width, canvasWidth);
});

test("a zoom or a seek past one screen rebuilds the whole waveform", () => {
	const { cache } = cacheWithCanvases();
	const dest = destination();
	const rectangle = { x: 0, y: 0, width: 20, height: 8 };
	const waveform = mockWaveform();
	const canvasWidth = 20 + WAVEFORM_CACHE_OVERSCAN * 2;
	cache.blit(dest.context, rectangle, waveform, 0, 1);
	cache.blit(dest.context, rectangle, waveform, 0, 2);
	assert.equal(waveform.calls.at(-1).width, canvasWidth, "a zoom rebuilds");
	cache.blit(dest.context, rectangle, waveform, 4, 5);
	assert.equal(waveform.calls.at(-1).width, canvasWidth, "a seek past the view rebuilds");
});

test("play-follow keeps the waveform on the same x as the visible range", () => {
	const { cache } = cacheWithCanvases();
	const dest = destination();
	const rectangle = { x: 0, y: 0, width: 20, height: 8 };
	const waveform = mockWaveform();
	cache.blit(dest.context, rectangle, waveform, 0, 1);
	const samplesBefore = waveform.calls.length;
	// 0.02s is 0.4px at 20px/s. Ten frames total 4px; the leftover must not be dropped.
	for (let step = 1; step <= 10; step += 1) {
		const start = step * 0.02;
		cache.blit(dest.context, rectangle, waveform, start, start + 1);
		const offset = waveformBlitOffset(0, start, cache.viewStart, 1, 20);
		assert.equal(dest.drawn.at(-1).x, offset);
		assertClose(offset, -WAVEFORM_CACHE_OVERSCAN - (start - cache.viewStart) * 20);
	}
	assertClose(cache.viewStart, 0.2);
	assertClose(dest.drawn.at(-1).x, -WAVEFORM_CACHE_OVERSCAN);
	assert.ok(waveform.calls.length - samplesBefore <= 4, "only whole entering pixels are sampled");
});

test("a sub-pixel pan does not resample peaks and still shifts the blit", () => {
	const { cache } = cacheWithCanvases();
	const dest = destination();
	const rectangle = { x: 0, y: 0, width: 20, height: 8 };
	const waveform = mockWaveform();
	cache.blit(dest.context, rectangle, waveform, 0, 1);
	const samples = waveform.calls.length;
	cache.blit(dest.context, rectangle, waveform, 0.01, 1.01);
	assert.equal(waveform.calls.length, samples);
	assert.equal(dest.drawn.at(-1).x, waveformBlitOffset(0, 0.01, 0, 1, 20));
});

test("timeline waveform paint goes through the view cache", () => {
	const dest = destination();
	const context = {
		...dest.context,
		fillRect() {},
		moveTo() {},
		lineTo() {},
		stroke() {},
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
	assert.equal(dest.drawn.at(-1).canvas, first);
	trait._drawWaveform(context, rectangle, editor);
	assert.equal(dest.drawn.at(-1).canvas, first);
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
