import assert from "node:assert/strict";
import test from "node:test";

import { renderSpectrogramGridCached } from "../js/core/spectrogram.js";
import { TimelineDrawingTrait } from "../js/render/timeline-drawing.js";

// The STFT over the visible range is the per-frame cost the caches remove: the same audio,
// view, size and settings must reuse the rendered canvas, any change of one of them must
// recompute (a recompute always builds a fresh canvas, which is what the assertions observe),
// and a panning view must reuse its STFT columns instead of recomputing them.

const editor = {
	visibleRangeBeginning: 0,
	visibleRangeEnd: 1,
	spectrogram: {
		show: true,
		windowWidth: 0.005,
		windowShape: "gaussian",
		frequencyRange: [0, 2000],
		dynamicRange: 50,
		blackAsHigh: false,
	},
};

const audio = () => ({
	channels: [Float32Array.from({ length: 64 }, (_, index) => Math.sin(index / 3))],
	sampleRate: 8000,
});

test("the spectrogram grid is cached until the audio, the view or the settings change", () => {
	globalThis.ImageData = class {
		constructor(data, width, height) {
			this.data = data;
			this.width = width;
			this.height = height;
		}
	};
	globalThis.document = {
		createElement: () => ({
			width: 0,
			height: 0,
			getContext: () => ({ putImageData() {} }),
		}),
	};
	const drawn = [];
	const context = {
		fillRect() {},
		drawImage(canvas) {
			drawn.push(canvas);
		},
	};
	const rectangle = { x: 0, y: 0, width: 12, height: 8 };
	const trait = Object.create(TimelineDrawingTrait.prototype);
	// The decoded audio keeps one waveform reference for its lifetime; the cache keys on it.
	const waveform = audio();
	trait.callbacks = { getWaveform: () => waveform };

	trait._drawSpectrogram(context, rectangle, editor);
	const first = trait._spectrogramCache.canvas;
	assert.ok(first, "the first draw renders and caches a canvas");
	assert.equal(drawn.at(-1), first);
	trait._drawSpectrogram(context, rectangle, editor);
	assert.equal(drawn.at(-1), first, "an unchanged view blits the cached canvas");

	trait._drawSpectrogram(context, rectangle, { ...editor, visibleRangeEnd: 2 });
	const second = trait._spectrogramCache.canvas;
	assert.notEqual(second, first, "a moved view recomputes");
	assert.equal(drawn.at(-1), second);
	trait._drawSpectrogram(context, rectangle, { ...editor, visibleRangeEnd: 2 });
	assert.equal(drawn.at(-1), second, "the new view is cached too");

	// Fresh audio identity invalidates even with an unchanged view (a redecode reuses nothing).
	trait.callbacks = { getWaveform: () => ({ channels: [new Float32Array(64)], sampleRate: 8000 }) };
	trait._drawSpectrogram(context, rectangle, { ...editor, visibleRangeEnd: 2 });
	const third = trait._spectrogramCache.canvas;
	assert.notEqual(third, second, "new audio recomputes");

	trait._drawSpectrogram(context, rectangle, {
		...editor,
		visibleRangeEnd: 2,
		spectrogram: { ...editor.spectrogram, dynamicRange: 40 },
	});
	assert.notEqual(trait._spectrogramCache.canvas, third, "changed settings recompute");
});

test("a panning view reuses its STFT columns and only computes the entering edge", () => {
	const cache = new Map();
	const common = {
		channels: [Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index / 5))],
		sampleRate: 8000,
		width: 24,
		height: 8,
		settings: { ...editor.spectrogram },
		columnCache: cache,
		columnCacheLimit: 64,
	};
	renderSpectrogramGridCached({ ...common, timeStart: 0, timeEnd: 1 });
	const afterFirst = cache.size;
	assert.ok(afterFirst > 0 && afterFirst <= 24, "the first view fills one bucket per column at most");
	renderSpectrogramGridCached({ ...common, timeStart: 0.05, timeEnd: 1.05 });
	const growth = cache.size - afterFirst;
	assert.ok(
		growth <= Math.ceil(24 * 0.05) + 2,
		`a 5% pan reuses ~95% of the columns (grew by ${growth})`,
	);
	// Buckets are anchored at time zero with one-column spacing: the column drawn at time 0.5
	// reads bucket round(0.5 / (1/24)) from any view that shows it, never recomputed.
	const bucket = Math.round(0.5 * 24);
	const before = cache.get(bucket);
	assert.ok(before, "the bucket under time 0.5 is cached by the first view");
	renderSpectrogramGridCached({ ...common, timeStart: 0.4, timeEnd: 1.4 });
	assert.equal(cache.get(bucket), before, "an already computed bucket is never recomputed");
});

test("the column cache evicts its oldest buckets at the limit", () => {
	const cache = new Map();
	const common = {
		channels: [Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index / 5))],
		sampleRate: 8000,
		width: 8,
		height: 8,
		settings: { ...editor.spectrogram },
		columnCache: cache,
		columnCacheLimit: 4,
	};
	// Six disjoint views over distant times force far more distinct buckets than the limit.
	for (let view = 0; view < 6; view += 1) {
		renderSpectrogramGridCached({ ...common, timeStart: view * 10, timeEnd: view * 10 + 1 });
	}
	assert.ok(cache.size <= 4, `the cache stays capped (size ${cache.size})`);
});
