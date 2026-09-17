import assert from "node:assert/strict";
import test from "node:test";

import { TimelineDrawingTrait } from "../js/render/timeline-drawing.js";

// The STFT over the visible range is the per-frame cost the cache removes: the same audio,
// view, size and settings must reuse the rendered canvas, and any change of one of them must
// recompute (a recompute always builds a fresh canvas, which is what the assertions observe).

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
