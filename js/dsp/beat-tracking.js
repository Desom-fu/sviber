// Beat and pulse tracking from FMP Section 6.3.
//   predominant local pulse  -> (6.36) - (6.39)
//   dynamic programming beat -> (6.40) - (6.48) and Table 6.1

import { halfWaveRectify } from "../core/ndarray.js";
import { fourierCoefficient, fourierTempogram, globalTempo } from "./tempogram.js";

export const BEAT_ALGORITHMS = Object.freeze(["plp", "dynamicProgramming"]);

export const DEFAULT_BEAT_PARAMETERS = Object.freeze({
	plp: Object.freeze({
		peakThreshold: 0.1,
	}),
	dynamicProgramming: Object.freeze({
		lambda: 10,
		tempoSource: "tempogram",
		manualTempo: 120,
	}),
});

// FMP (6.36) - (6.39). The overlap-add is normalized by the accumulated window
// weight so that perfectly aligned sinusoids peak at 1, turning the peak height
// into a confidence value.
export function predominantLocalPulse(novelty, frameRate, tempogram) {
	const { magnitude, tempi, frames, hop, radius, window } = tempogram;
	const accumulator = new Float64Array(novelty.length);
	const overlapWeight = new Float64Array(novelty.length);
	for (let frame = 0; frame < frames; frame += 1) {
		const base = frame * tempi.length;
		let best = -Infinity;
		let bestIndex = 0;
		for (let index = 0; index < tempi.length; index += 1) {
			if (magnitude.data[base + index] > best) {
				best = magnitude.data[base + index];
				bestIndex = index;
			}
		}
		const center = frame * hop;
		const tempo = tempi[bestIndex];
		const coefficient = fourierCoefficient(novelty, frameRate, center, radius, window, tempo);
		const rate = tempo / 60 / frameRate;
		const phase = Math.atan2(coefficient.imaginary, coefficient.real) / (2 * Math.PI);
		for (let offset = -radius; offset <= radius; offset += 1) {
			const position = center + offset;
			if (position < 0 || position >= novelty.length) {
				continue;
			}
			const weight = window[offset + radius];
			accumulator[position] += weight * Math.cos(2 * Math.PI * (rate * position + phase));
			overlapWeight[position] += weight;
		}
	}
	const pulse = new Float64Array(novelty.length);
	for (let index = 0; index < pulse.length; index += 1) {
		const weight = overlapWeight[index];
		pulse[index] = weight > 1e-9 ? halfWaveRectify(accumulator[index] / weight) : 0;
	}
	return pulse;
}

export function pickPeaks(values, threshold = 0) {
	const peaks = [];
	for (let index = 1; index + 1 < values.length; index += 1) {
		if (values[index] <= threshold) {
			continue;
		}
		if (values[index] >= values[index - 1] && values[index] > values[index + 1]) {
			peaks.push(index);
		}
	}
	return peaks;
}

// FMP (6.40): P(delta) = -(log2(delta / idealDelta))^2
export function beatPeriodPenalty(delta, idealDelta) {
	if (delta <= 0 || idealDelta <= 0) {
		return -Infinity;
	}
	const ratio = Math.log2(delta / idealDelta);
	return -(ratio * ratio);
}

// FMP Table 6.1 with a bounded search window (Exercise 6.13) so that a ten
// minute recording stays within a linear-ish amount of work.
export function dynamicProgrammingBeats(novelty, idealDelta, lambda) {
	const length = novelty.length;
	const accumulated = new Float64Array(length + 1);
	const predecessor = new Int32Array(length + 1);
	const searchLow = Math.max(1, Math.floor(idealDelta / 2));
	const searchHigh = Math.max(searchLow + 1, Math.ceil(idealDelta * 2));
	for (let n = 1; n <= length; n += 1) {
		let best = 0;
		let bestIndex = 0;
		const lowest = Math.max(1, n - searchHigh);
		const highest = n - searchLow;
		for (let m = lowest; m <= highest; m += 1) {
			const score = accumulated[m] + lambda * beatPeriodPenalty(n - m, idealDelta);
			if (score > best) {
				best = score;
				bestIndex = m;
			}
		}
		accumulated[n] = novelty[n - 1] + best;
		predecessor[n] = bestIndex;
	}
	let last = 0;
	let bestScore = 0;
	for (let n = 1; n <= length; n += 1) {
		if (accumulated[n] > bestScore) {
			bestScore = accumulated[n];
			last = n;
		}
	}
	const beats = [];
	let cursor = last;
	while (cursor > 0) {
		beats.push(cursor - 1);
		cursor = predecessor[cursor];
	}
	beats.reverse();
	return { beats, accumulated, score: bestScore };
}

// Confidence for DP beats: p_l = tilde p_l / max{tilde p_l} with
// tilde p_l = |Delta(b_l) + lambda/2 * (P(b_l - b_{l-1}) + P(b_{l+1} - b_l))|_{>=0}
function dynamicProgrammingConfidence(beats, novelty, idealDelta, lambda) {
	const raw = new Float64Array(beats.length);
	for (let index = 0; index < beats.length; index += 1) {
		let value = novelty[beats[index]] || 0;
		if (index > 0) {
			value += (lambda / 2) * beatPeriodPenalty(beats[index] - beats[index - 1], idealDelta);
		}
		if (index + 1 < beats.length) {
			value += (lambda / 2) * beatPeriodPenalty(beats[index + 1] - beats[index], idealDelta);
		}
		raw[index] = halfWaveRectify(value);
	}
	let maximum = 0;
	for (let index = 0; index < raw.length; index += 1) {
		maximum = Math.max(maximum, raw[index]);
	}
	if (maximum <= 1e-12) {
		return raw.fill(1);
	}
	for (let index = 0; index < raw.length; index += 1) {
		raw[index] /= maximum;
	}
	return raw;
}

export function trackBeats(novelty, frameRate, options = {}) {
	const algorithm = options.algorithm === "dynamicProgramming" ? "dynamicProgramming" : "plp";
	const frameOffset = Number(options.frameOffset) || 0;
	const toSeconds = index => index / frameRate + frameOffset;
	if (algorithm === "plp") {
		const parameters = { ...DEFAULT_BEAT_PARAMETERS.plp, ...options.parameters };
		let tempogram = options.tempogram;
		if (tempogram?.algorithm !== "fourier") {
			tempogram = fourierTempogram(novelty, frameRate, options.tempogramParameters);
		}
		const pulse = predominantLocalPulse(novelty, frameRate, tempogram);
		const peaks = pickPeaks(pulse, parameters.peakThreshold);
		return {
			algorithm,
			beats: peaks.map(toSeconds),
			beatFrames: peaks,
			confidences: peaks.map(index => Math.min(1, pulse[index])),
			pulse,
			tempo: globalTempo(tempogram),
		};
	}
	const parameters = { ...DEFAULT_BEAT_PARAMETERS.dynamicProgramming, ...options.parameters };
	const manual = Number(parameters.manualTempo);
	const fallback = Number(options.estimatedTempo) > 0 ? Number(options.estimatedTempo) : 120;
	const estimated = parameters.tempoSource === "manual" && manual > 0 ? manual : fallback;
	const idealDelta = Math.max(1, (60 * frameRate) / estimated);
	const lambda = Math.max(0, Number(parameters.lambda) || 0);
	const result = dynamicProgrammingBeats(novelty, idealDelta, lambda);
	const confidences = dynamicProgrammingConfidence(result.beats, novelty, idealDelta, lambda);
	return {
		algorithm,
		beats: result.beats.map(toSeconds),
		beatFrames: result.beats,
		confidences: Array.from(confidences),
		tempo: estimated,
	};
}
