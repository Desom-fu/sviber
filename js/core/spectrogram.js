// Spectrogram settings stored on the chart JSON (`editor.spectrogram`) and the STFT
// colouring used to replace the timeline waveform (PROMPT-v26).

import { fftInPlace, nextPowerOfTwo } from "../dsp/fft.js";
import { createWindow } from "../dsp/window.js";

export const DEFAULT_SPECTROGRAM = Object.freeze({
	show: false,
	blackAsHigh: false,
	windowWidth: 0.005,
	windowShape: "gaussian",
	frequencyRange: Object.freeze([0, 5000]),
	dynamicRange: 50,
});

export const SPECTROGRAM_WINDOW_SHAPES = Object.freeze([
	"gaussian",
	"hann",
	"hamming",
	"blackman",
	"rectangular",
]);

export function normalizeSpectrogram(source = {}) {
	const windowShape = String(source.windowShape || DEFAULT_SPECTROGRAM.windowShape);
	const range = Array.isArray(source.frequencyRange) ? source.frequencyRange : DEFAULT_SPECTROGRAM.frequencyRange;
	const low = Number(range[0]);
	const high = Number(range[1]);
	const width = Number(source.windowWidth);
	const dynamicRange = Number(source.dynamicRange);
	return {
		show: source.show === true,
		blackAsHigh: source.blackAsHigh === true,
		windowWidth: width > 0 && Number.isFinite(width) ? width : DEFAULT_SPECTROGRAM.windowWidth,
		windowShape: SPECTROGRAM_WINDOW_SHAPES.includes(windowShape) ? windowShape : "gaussian",
		frequencyRange: [
			Number.isFinite(low) ? Math.max(0, low) : 0,
			Number.isFinite(high) && high > 0 ? high : 5000,
		],
		dynamicRange: dynamicRange > 0 && Number.isFinite(dynamicRange) ? dynamicRange : 50,
	};
}

export function spectrogramColor(intensityDb, dynamicRange, blackAsHigh = false) {
	const range = Number(dynamicRange);
	const safeRange = range > 0 && Number.isFinite(range) ? range : 50;
	const intensity = Number(intensityDb);
	let value = 1 + (Number.isFinite(intensity) ? intensity : -Infinity) / safeRange;
	if (value < 0) {
		value = 0;
	} else if (value > 1) {
		value = 1;
	}
	return blackAsHigh ? 1 - value : value;
}

function sampleMixed(channels, index) {
	if (!channels?.length) {
		return 0;
	}
	const length = channels[0].length;
	if (index < 0 || index >= length) {
		return 0;
	}
	let sum = 0;
	for (const channel of channels) {
		sum += channel[index] || 0;
	}
	return sum / channels.length;
}

export function spectrogramMagnitudes(channels, sampleRate, timeSeconds, settings, fftSizeHint = 0) {
	const windowWidth = Math.max(1e-6, Number(settings.windowWidth) || DEFAULT_SPECTROGRAM.windowWidth);
	const rate = Number(sampleRate) || 1;
	const windowSamples = Math.max(4, Math.round(windowWidth * rate));
	const fftSize = nextPowerOfTwo(Math.max(windowSamples, fftSizeHint));
	const window = createWindow(windowSamples, settings.windowShape || "gaussian");
	const real = new Float64Array(fftSize);
	const imaginary = new Float64Array(fftSize);
	const center = Math.round(Number(timeSeconds) * rate);
	const start = center - Math.floor(windowSamples / 2);
	for (let index = 0; index < windowSamples; index += 1) {
		real[index] = sampleMixed(channels, start + index) * window[index];
	}
	fftInPlace(real, imaginary);
	const bins = fftSize / 2 + 1;
	const magnitude = new Float64Array(bins);
	for (let bin = 0; bin < bins; bin += 1) {
		magnitude[bin] = Math.hypot(real[bin], imaginary[bin]);
	}
	return { magnitude, fftSize, sampleRate: rate };
}

function interpolatedMagnitude(magnitude, fftSize, sampleRate, frequency) {
	const bin = (frequency * fftSize) / sampleRate;
	if (bin <= 0) {
		return magnitude[0] || 0;
	}
	if (bin >= magnitude.length - 1) {
		return magnitude[magnitude.length - 1] || 0;
	}
	const lower = Math.floor(bin);
	const mix = bin - lower;
	return magnitude[lower] * (1 - mix) + magnitude[lower + 1] * mix;
}

export function renderSpectrogramGrid(options = {}) {
	const settings = normalizeSpectrogram(options.settings);
	const width = Math.max(1, Math.floor(Number(options.width) || 1));
	const height = Math.max(1, Math.floor(Number(options.height) || 1));
	const timeStart = Number(options.timeStart) || 0;
	const timeEnd = Number(options.timeEnd);
	const span = Math.max(1e-9, (Number.isFinite(timeEnd) ? timeEnd : timeStart + 1) - timeStart);
	const channels = options.channels || (options.samples ? [options.samples] : []);
	const sampleRate = Number(options.sampleRate) || 44100;
	const [freqMin, freqMax] = settings.frequencyRange;
	const freqSpan = Math.max(1e-9, freqMax - freqMin);
	const values = new Float32Array(width * height);
	let peak = 0;
	const columns = [];
	for (let x = 0; x < width; x += 1) {
		const time = timeStart + ((x + 0.5) / width) * span;
		const { magnitude, fftSize } = spectrogramMagnitudes(
			channels,
			sampleRate,
			time,
			settings,
			height * 2,
		);
		columns.push({ magnitude, fftSize });
		for (let y = 0; y < height; y += 1) {
			const frequency = freqMin + ((y + 0.5) / height) * freqSpan;
			const mag = interpolatedMagnitude(magnitude, fftSize, sampleRate, frequency);
			if (mag > peak) {
				peak = mag;
			}
		}
	}
	const peakSafe = peak > 0 ? peak : 1;
	for (let x = 0; x < width; x += 1) {
		const { magnitude, fftSize } = columns[x];
		for (let y = 0; y < height; y += 1) {
			const frequency = freqMin + ((y + 0.5) / height) * freqSpan;
			const mag = interpolatedMagnitude(magnitude, fftSize, sampleRate, frequency);
			const intensityDb = 20 * Math.log10(Math.max(mag, 1e-20) / peakSafe);
			const row = height - 1 - y;
			values[row * width + x] = spectrogramColor(intensityDb, settings.dynamicRange, settings.blackAsHigh);
		}
	}
	return { width, height, values, peak: peakSafe };
}

export function spectrogramPixels(grid) {
	const { width, height, values } = grid;
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let index = 0; index < values.length; index += 1) {
		const level = Math.round(Math.max(0, Math.min(1, values[index])) * 255);
		const offset = index * 4;
		pixels[offset] = level;
		pixels[offset + 1] = level;
		pixels[offset + 2] = level;
		pixels[offset + 3] = 255;
	}
	return pixels;
}
