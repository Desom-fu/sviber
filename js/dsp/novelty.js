// Novelty (onset-detection) functions from FMP Section 6.1.
//   energy  -> (6.3) / (6.4)
//   spectral -> (6.5) - (6.8)
//   phase    -> (6.13) with (6.15) / (6.16)
//   complex  -> (6.17) - (6.21)

import { halfWaveRectify, normalizeMaximum } from "../core/ndarray.js";
import { createCenteredWindow } from "./window.js";
import { spectraGeometry, streamSpectra } from "./fft.js";

export const NOVELTY_ALGORITHMS = Object.freeze(["energy", "spectral", "phase", "complex"]);

export const DEFAULT_NOVELTY_PARAMETERS = Object.freeze({
	energy: Object.freeze({
		windowLength: 1024,
		hopSize: 256,
		windowType: "hann",
		logarithmic: true,
		gamma: 10,
		localAverageWindow: 5,
	}),
	spectral: Object.freeze({
		windowLength: 1024,
		hopSize: 512,
		windowType: "hann",
		gamma: 100,
		localAverageWindow: 10,
	}),
	phase: Object.freeze({
		windowLength: 1024,
		hopSize: 512,
		windowType: "hann",
		localAverageWindow: 10,
	}),
	complex: Object.freeze({
		windowLength: 1024,
		hopSize: 512,
		windowType: "hann",
		localAverageWindow: 10,
	}),
});

// FMP (6.7) / (6.8): subtract a local average and half-wave rectify.
export function subtractLocalAverage(values, halfWidth) {
	const radius = Math.max(0, Math.floor(halfWidth));
	if (!radius) {
		return values;
	}
	const result = new Float64Array(values.length);
	for (let index = 0; index < values.length; index += 1) {
		let total = 0;
		let count = 0;
		for (let offset = -radius; offset <= radius; offset += 1) {
			const position = index + offset;
			if (position < 0 || position >= values.length) {
				continue;
			}
			total += values[position];
			count += 1;
		}
		result[index] = halfWaveRectify(values[index] - total / Math.max(1, count));
	}
	return result;
}

// FMP (6.14): principal argument mapping phase differences into [-0.5, 0.5].
export function principalArgument(value) {
	return value - Math.round(value);
}

function energyNovelty(samples, sampleRate, parameters) {
	const hopSize = Math.max(1, Math.floor(parameters.hopSize));
	const radius = Math.max(1, Math.floor(parameters.windowLength / 2));
	const window = createCenteredWindow(radius, parameters.windowType);
	const frames = Math.max(1, Math.floor((samples.length - 1) / hopSize) + 1);
	const energy = new Float64Array(frames);
	for (let frame = 0; frame < frames; frame += 1) {
		const center = frame * hopSize;
		let total = 0;
		for (let offset = -radius; offset <= radius; offset += 1) {
			const position = center + offset;
			if (position < 0 || position >= samples.length) {
				continue;
			}
			const value = samples[position] * window[offset + radius];
			total += value * value;
		}
		energy[frame] = total;
	}
	const gamma = Math.max(1, Number(parameters.gamma) || 1);
	const novelty = new Float64Array(frames);
	for (let frame = 0; frame + 1 < frames; frame += 1) {
		if (parameters.logarithmic) {
			const next = Math.log(1 + gamma * energy[frame + 1]);
			const current = Math.log(1 + gamma * energy[frame]);
			novelty[frame] = halfWaveRectify(next - current);
		} else {
			novelty[frame] = halfWaveRectify(energy[frame + 1] - energy[frame]);
		}
	}
	return { novelty, hopSize, frames };
}

function spectralNovelty(samples, sampleRate, parameters, geometry) {
	const gamma = Math.max(1, Number(parameters.gamma) || 1);
	const novelty = new Float64Array(geometry.frames);
	const previous = new Float64Array(geometry.bins);
	streamSpectra(samples, { ...parameters, sampleRate }, (frame, magnitude) => {
		if (frame > 0) {
			let total = 0;
			for (let bin = 0; bin < magnitude.length; bin += 1) {
				total += halfWaveRectify(Math.log(1 + gamma * magnitude[bin]) - previous[bin]);
			}
			novelty[frame - 1] = total;
		}
		for (let bin = 0; bin < magnitude.length; bin += 1) {
			previous[bin] = Math.log(1 + gamma * magnitude[bin]);
		}
	});
	return novelty;
}

function phaseNovelty(samples, sampleRate, parameters, geometry) {
	const novelty = new Float64Array(geometry.frames);
	const previousPhase = new Float64Array(geometry.bins);
	const previousFirstOrder = new Float64Array(geometry.bins);
	streamSpectra(samples, { ...parameters, sampleRate }, (frame, magnitude, phase) => {
		if (frame > 0) {
			let total = 0;
			for (let bin = 0; bin < phase.length; bin += 1) {
				const firstOrder = principalArgument(phase[bin] - previousPhase[bin]);
				if (frame > 1) {
					total += Math.abs(principalArgument(firstOrder - previousFirstOrder[bin]));
				}
				previousFirstOrder[bin] = firstOrder;
			}
			novelty[frame] = total;
		}
		previousPhase.set(phase);
	});
	return novelty;
}

// FMP (6.17) - (6.21) for one frame.
function complexFrameNovelty(magnitude, phase, previousMagnitude, previousPhase, earlierPhase) {
	let total = 0;
	for (let bin = 0; bin < magnitude.length; bin += 1) {
		if (magnitude[bin] <= previousMagnitude[bin]) {
			continue;
		}
		const firstOrder = principalArgument(previousPhase[bin] - earlierPhase[bin]);
		const predictedPhase = 2 * Math.PI * (previousPhase[bin] + firstOrder);
		const estimateReal = previousMagnitude[bin] * Math.cos(predictedPhase);
		const estimateImaginary = previousMagnitude[bin] * Math.sin(predictedPhase);
		const actualPhase = 2 * Math.PI * phase[bin];
		const deltaReal = estimateReal - magnitude[bin] * Math.cos(actualPhase);
		const deltaImaginary = estimateImaginary - magnitude[bin] * Math.sin(actualPhase);
		total += Math.sqrt(deltaReal * deltaReal + deltaImaginary * deltaImaginary);
	}
	return total;
}

function complexNovelty(samples, sampleRate, parameters, geometry) {
	const novelty = new Float64Array(geometry.frames);
	const previousMagnitude = new Float64Array(geometry.bins);
	const previousPhase = new Float64Array(geometry.bins);
	const earlierPhase = new Float64Array(geometry.bins);
	streamSpectra(samples, { ...parameters, sampleRate }, (frame, magnitude, phase) => {
		if (frame > 1) {
			novelty[frame] = complexFrameNovelty(magnitude, phase, previousMagnitude, previousPhase, earlierPhase);
		}
		earlierPhase.set(previousPhase);
		previousPhase.set(phase);
		previousMagnitude.set(magnitude);
	});
	return novelty;
}

export function computeNovelty(samples, sampleRate, algorithm = "energy", overrides = {}) {
	const base = DEFAULT_NOVELTY_PARAMETERS[algorithm] || DEFAULT_NOVELTY_PARAMETERS.energy;
	const parameters = { ...base, ...overrides };
	if (algorithm === "energy") {
		const result = energyNovelty(samples, sampleRate, parameters);
		const enhanced = subtractLocalAverage(result.novelty, parameters.localAverageWindow);
		return {
			novelty: normalizeMaximum(enhanced),
			hopSize: result.hopSize,
			frameRate: sampleRate / result.hopSize,
			// Frames are centred on multiples of the hop and the derivative in (6.3)
			// sits between frame n and n + 1, so index n localizes t = (n + 1/2) * hop.
			frameOffset: (0.5 * result.hopSize) / sampleRate,
			frames: result.frames,
			algorithm,
			parameters,
		};
	}
	const geometry = spectraGeometry(samples, { ...parameters, sampleRate });
	let raw;
	if (algorithm === "spectral") {
		raw = spectralNovelty(samples, sampleRate, parameters, geometry);
	} else if (algorithm === "phase") {
		raw = phaseNovelty(samples, sampleRate, parameters, geometry);
	} else {
		raw = complexNovelty(samples, sampleRate, parameters, geometry);
	}
	const enhanced = subtractLocalAverage(raw, parameters.localAverageWindow);
	return {
		novelty: normalizeMaximum(enhanced),
		hopSize: geometry.hopSize,
		frameRate: geometry.frameRate,
		// STFT frame n is centred at n * hop + windowLength / 2 and the difference to
		// frame n + 1 localizes half a hop later.
		frameOffset: (geometry.windowLength / 2 + geometry.hopSize / 2) / sampleRate,
		frames: geometry.frames,
		algorithm,
		parameters,
	};
}
