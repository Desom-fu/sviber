// Tempo analysis from FMP Section 6.2.
//   Fourier tempogram         -> (6.25) / (6.26)
//   autocorrelation tempogram -> (6.29) - (6.31)
//   global tempo estimate     -> (6.32) / (6.33)
//
// Both tempograms are evaluated through the FFT: the Fourier one by zero-padding
// each windowed section, the autocorrelation one via the power spectrum. Direct
// evaluation of (6.25) over a fine tempo grid is quadratic and cannot meet the
// "a few seconds for ten minutes of audio" requirement.

import { NDArray } from "../core/ndarray.js";
import { createCenteredWindow, windowSum } from "./window.js";
import { autocorrelateInPlace, fftInPlace, nextPowerOfTwo } from "./fft.js";

export const TEMPOGRAM_ALGORITHMS = Object.freeze(["fourier", "autocorrelation"]);

export const DEFAULT_TEMPOGRAM_PARAMETERS = Object.freeze({
	fourier: Object.freeze({
		windowSeconds: 8,
		hopSeconds: 0.25,
		windowType: "hann",
		minimumTempo: 60,
		maximumTempo: 200,
		tempoStep: 1,
	}),
	autocorrelation: Object.freeze({
		windowSeconds: 8,
		hopSeconds: 0.25,
		windowType: "rectangular",
		minimumTempo: 60,
		maximumTempo: 200,
		tempoStep: 1,
	}),
});

export function tempoSet(parameters) {
	const minimum = Math.max(1, Number(parameters.minimumTempo) || 30);
	const maximum = Math.max(minimum + 1, Number(parameters.maximumTempo) || 600);
	const step = Math.max(0.1, Number(parameters.tempoStep) || 1);
	const tempi = [];
	for (let tempo = minimum; tempo <= maximum + 1e-9; tempo += step) {
		tempi.push(tempo);
	}
	return Float64Array.from(tempi);
}

function tempogramGeometry(novelty, frameRate, parameters) {
	const radius = Math.max(2, Math.round((parameters.windowSeconds * frameRate) / 2));
	const window = createCenteredWindow(radius, parameters.windowType);
	const hop = Math.max(1, Math.round(parameters.hopSeconds * frameRate));
	const frames = Math.max(1, Math.floor(Math.max(0, novelty.length - 1) / hop) + 1);
	return { radius, window, hop, frames, length: window.length };
}

function fillWindowedSection(target, novelty, center, radius, window) {
	for (let offset = -radius; offset <= radius; offset += 1) {
		const position = center + offset;
		const inside = position >= 0 && position < novelty.length;
		target[offset + radius] = inside ? novelty[position] * window[offset + radius] : 0;
	}
}

// Exact complex coefficient of FMP (6.25) at a single tempo, used by the PLP step
// where the phase must be accurate.
export function fourierCoefficient(novelty, frameRate, center, radius, window, tempo) {
	const rate = tempo / 60 / frameRate;
	const step = -2 * Math.PI * rate;
	let sumReal = 0;
	let sumImaginary = 0;
	for (let offset = -radius; offset <= radius; offset += 1) {
		const position = center + offset;
		if (position < 0 || position >= novelty.length) {
			continue;
		}
		const weighted = novelty[position] * window[offset + radius];
		const angle = step * position;
		sumReal += weighted * Math.cos(angle);
		sumImaginary += weighted * Math.sin(angle);
	}
	return { real: sumReal, imaginary: sumImaginary };
}

export function fourierTempogram(novelty, frameRate, overrides = {}) {
	const parameters = { ...DEFAULT_TEMPOGRAM_PARAMETERS.fourier, ...overrides };
	const tempi = tempoSet(parameters);
	const geometry = tempogramGeometry(novelty, frameRate, parameters);
	const { radius, window, hop, frames, length } = geometry;
	const normalization = Math.max(1e-9, windowSum(window) / 2);
	const size = nextPowerOfTwo(Math.max(2 * length, 4096));
	const real = new Float64Array(size);
	const imaginary = new Float64Array(size);
	const spectrum = new Float64Array(size / 2 + 1);
	const magnitude = new NDArray([frames, tempi.length], null, { storage: Float32Array });
	const binsPerBpm = size / (60 * frameRate);
	for (let frame = 0; frame < frames; frame += 1) {
		real.fill(0);
		imaginary.fill(0);
		fillWindowedSection(real, novelty, frame * hop, radius, window);
		fftInPlace(real, imaginary);
		for (let bin = 0; bin < spectrum.length; bin += 1) {
			spectrum[bin] = Math.sqrt(real[bin] * real[bin] + imaginary[bin] * imaginary[bin]) / normalization;
		}
		const base = frame * tempi.length;
		for (let index = 0; index < tempi.length; index += 1) {
			const position = tempi[index] * binsPerBpm;
			const lower = Math.floor(position);
			if (lower < 0 || lower + 1 >= spectrum.length) {
				magnitude.data[base + index] = 0;
				continue;
			}
			const weight = position - lower;
			magnitude.data[base + index] = spectrum[lower] * (1 - weight) + spectrum[lower + 1] * weight;
		}
	}
	return { magnitude, tempi, frames, hop, frameRate, radius, window, algorithm: "fourier", parameters };
}

export function autocorrelationTempogram(novelty, frameRate, overrides = {}) {
	const parameters = { ...DEFAULT_TEMPOGRAM_PARAMETERS.autocorrelation, ...overrides };
	const tempi = tempoSet(parameters);
	const geometry = tempogramGeometry(novelty, frameRate, parameters);
	const { radius, window, hop, frames, length } = geometry;
	const size = nextPowerOfTwo(2 * length);
	const real = new Float64Array(size);
	const imaginary = new Float64Array(size);
	const maximumLag = Math.min(length - 1, Math.max(2, Math.ceil((60 * frameRate) / parameters.minimumTempo)));
	const minimumLag = Math.max(1, Math.floor((60 * frameRate) / parameters.maximumTempo));
	const magnitude = new NDArray([frames, tempi.length], null, { storage: Float32Array });
	const lags = new Float64Array(maximumLag + 2);
	for (let frame = 0; frame < frames; frame += 1) {
		real.fill(0);
		fillWindowedSection(real, novelty, frame * hop, radius, window);
		autocorrelateInPlace(real, imaginary, length);
		for (let lag = 0; lag <= maximumLag + 1; lag += 1) {
			// Balance out the windowing: only length - lag summands are nonzero.
			lags[lag] = real[lag] / Math.max(1, length - lag);
		}
		const base = frame * tempi.length;
		for (let index = 0; index < tempi.length; index += 1) {
			const lag = (60 * frameRate) / tempi[index];
			if (lag < minimumLag || lag > maximumLag) {
				magnitude.data[base + index] = 0;
				continue;
			}
			const lower = Math.floor(lag);
			const weight = lag - lower;
			magnitude.data[base + index] = Math.max(0, lags[lower] * (1 - weight) + lags[lower + 1] * weight);
		}
	}
	return { magnitude, tempi, frames, hop, frameRate, radius, window, algorithm: "autocorrelation", parameters };
}

// FMP (6.32).
export function averageTempogram(tempogram) {
	const { magnitude, tempi, frames } = tempogram;
	const average = new Float64Array(tempi.length);
	for (let frame = 0; frame < frames; frame += 1) {
		const base = frame * tempi.length;
		for (let index = 0; index < tempi.length; index += 1) {
			average[index] += magnitude.data[base + index];
		}
	}
	for (let index = 0; index < average.length; index += 1) {
		average[index] /= Math.max(1, frames);
	}
	return average;
}

// FMP (6.33).
export function globalTempo(tempogram) {
	const average = averageTempogram(tempogram);
	let best = -Infinity;
	let bestIndex = 0;
	for (let index = 0; index < average.length; index += 1) {
		if (average[index] > best) {
			best = average[index];
			bestIndex = index;
		}
	}
	return tempogram.tempi[bestIndex];
}

export function computeTempogram(novelty, frameRate, algorithm = "fourier", overrides = {}) {
	if (algorithm === "autocorrelation") {
		return autocorrelationTempogram(novelty, frameRate, overrides);
	}
	return fourierTempogram(novelty, frameRate, overrides);
}
