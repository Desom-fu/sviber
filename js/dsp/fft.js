// In-place iterative radix-2 FFT plus a short-time Fourier transform tailored to
// the onset-detection pipeline. Only power-of-two transform sizes are used so
// that a 10 minute 44.1 kHz signal can be analysed in a couple of seconds.

import { NDArray } from "../core/ndarray.js";
import { createWindow } from "./window.js";

export function nextPowerOfTwo(value) {
	let size = 1;
	while (size < value) {
		size *= 2;
	}
	return size;
}

const twiddleCache = new Map();

function twiddles(size) {
	const cached = twiddleCache.get(size);
	if (cached) {
		return cached;
	}
	const cosines = new Float64Array(size / 2);
	const sines = new Float64Array(size / 2);
	for (let index = 0; index < size / 2; index += 1) {
		const angle = (-2 * Math.PI * index) / size;
		cosines[index] = Math.cos(angle);
		sines[index] = Math.sin(angle);
	}
	const entry = { cosines, sines };
	twiddleCache.set(size, entry);
	return entry;
}

function bitReverse(real, imaginary) {
	const size = real.length;
	for (let index = 1, position = 0; index < size; index += 1) {
		let bit = size >> 1;
		while (position & bit) {
			position ^= bit;
			bit >>= 1;
		}
		position ^= bit;
		if (index < position) {
			const swapReal = real[index];
			real[index] = real[position];
			real[position] = swapReal;
			const swapImaginary = imaginary[index];
			imaginary[index] = imaginary[position];
			imaginary[position] = swapImaginary;
		}
	}
}

export function fftInPlace(real, imaginary) {
	const size = real.length;
	if (size <= 1) {
		return;
	}
	if ((size & (size - 1)) !== 0) {
		throw new RangeError("fft size must be a power of two");
	}
	bitReverse(real, imaginary);
	const { cosines, sines } = twiddles(size);
	for (let length = 2; length <= size; length *= 2) {
		const step = size / length;
		const half = length / 2;
		for (let start = 0; start < size; start += length) {
			for (let offset = 0; offset < half; offset += 1) {
				const twiddleIndex = offset * step;
				const cosine = cosines[twiddleIndex];
				const sine = sines[twiddleIndex];
				const upper = start + offset + half;
				const lower = start + offset;
				const productReal = real[upper] * cosine - imaginary[upper] * sine;
				const productImaginary = real[upper] * sine + imaginary[upper] * cosine;
				real[upper] = real[lower] - productReal;
				imaginary[upper] = imaginary[lower] - productImaginary;
				real[lower] += productReal;
				imaginary[lower] += productImaginary;
			}
		}
	}
}

export function ifftInPlace(real, imaginary) {
	const size = real.length;
	fftInPlace(imaginary, real);
	for (let index = 0; index < size; index += 1) {
		real[index] /= size;
		imaginary[index] /= size;
	}
}

// Circular autocorrelation of the first `length` samples of `real`, computed with
// the FFT so that FMP (6.29) stays affordable for long recordings. `real` and
// `imaginary` must be zero-padded to at least twice `length`.
export function autocorrelateInPlace(real, imaginary, length) {
	const size = real.length;
	if (size < 2 * length) {
		throw new RangeError("autocorrelation needs at least double zero padding");
	}
	imaginary.fill(0);
	real.fill(0, length);
	fftInPlace(real, imaginary);
	for (let index = 0; index < size; index += 1) {
		const power = real[index] * real[index] + imaginary[index] * imaginary[index];
		real[index] = power;
		imaginary[index] = 0;
	}
	ifftInPlace(real, imaginary);
	return real;
}

export function spectraGeometry(samples, options = {}) {
	const windowLength = nextPowerOfTwo(Math.max(4, Math.floor(options.windowLength || 1024)));
	const hopSize = Math.max(1, Math.floor(options.hopSize || windowLength / 4));
	const sampleRate = Number(options.sampleRate) || 44100;
	const length = samples?.length ?? Number(samples) ?? 0;
	const frames = length >= windowLength ? Math.floor((length - windowLength) / hopSize) + 1 : 1;
	return { windowLength, hopSize, sampleRate, bins: windowLength / 2 + 1, frames, frameRate: sampleRate / hopSize };
}

// Streaming variant: invokes `visit(frame, magnitude, phase)` with reused buffers so
// that a ten minute recording does not need a few hundred megabytes of spectrogram.
export function streamSpectra(samples, options = {}, visit = () => {}) {
	const geometry = spectraGeometry(samples, options);
	const { windowLength, hopSize, bins, frames } = geometry;
	const window = createWindow(windowLength, options.windowType || "hann");
	const real = new Float64Array(windowLength);
	const imaginary = new Float64Array(windowLength);
	const magnitude = new Float64Array(bins);
	const phase = new Float64Array(bins);
	for (let frame = 0; frame < frames; frame += 1) {
		const start = frame * hopSize;
		imaginary.fill(0);
		for (let index = 0; index < windowLength; index += 1) {
			const position = start + index;
			real[index] = position < samples.length ? samples[position] * window[index] : 0;
		}
		fftInPlace(real, imaginary);
		for (let bin = 0; bin < bins; bin += 1) {
			const re = real[bin];
			const im = imaginary[bin];
			magnitude[bin] = Math.sqrt(re * re + im * im);
			let normalized = Math.atan2(im, re) / (2 * Math.PI);
			if (normalized < 0) {
				normalized += 1;
			}
			phase[bin] = normalized;
		}
		visit(frame, magnitude, phase);
	}
	return geometry;
}

// Returns magnitude and phase (normalized to [0, 1) as in FMP (6.9)) arrays of
// shape [frames, bins] together with the frame times in seconds.
export function shortTimeFourierTransform(samples, options = {}) {
	const windowLength = nextPowerOfTwo(Math.max(4, Math.floor(options.windowLength || 1024)));
	const hopSize = Math.max(1, Math.floor(options.hopSize || windowLength / 4));
	const sampleRate = Number(options.sampleRate) || 44100;
	const window = createWindow(windowLength, options.windowType || "hann");
	const bins = windowLength / 2 + 1;
	const frames = samples.length >= windowLength ? Math.floor((samples.length - windowLength) / hopSize) + 1 : 1;
	const magnitude = new NDArray([frames, bins], null, { storage: Float32Array });
	const phase = new NDArray([frames, bins], null, { storage: Float32Array });
	const real = new Float64Array(windowLength);
	const imaginary = new Float64Array(windowLength);
	for (let frame = 0; frame < frames; frame += 1) {
		const start = frame * hopSize;
		imaginary.fill(0);
		for (let index = 0; index < windowLength; index += 1) {
			const position = start + index;
			real[index] = position < samples.length ? samples[position] * window[index] : 0;
		}
		fftInPlace(real, imaginary);
		const base = frame * bins;
		for (let bin = 0; bin < bins; bin += 1) {
			const re = real[bin];
			const im = imaginary[bin];
			magnitude.data[base + bin] = Math.sqrt(re * re + im * im);
			let normalized = Math.atan2(im, re) / (2 * Math.PI);
			if (normalized < 0) {
				normalized += 1;
			}
			phase.data[base + bin] = normalized;
		}
	}
	return {
		magnitude,
		phase,
		frames,
		bins,
		hopSize,
		windowLength,
		sampleRate,
		frameRate: sampleRate / hopSize,
		frameTime: index => (index * hopSize + windowLength / 2) / sampleRate,
	};
}
