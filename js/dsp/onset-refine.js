// Sub-frame onset refinement.
//
// FMP notes that onset detection is accurate to roughly 10 ms, which is far too
// coarse for a rhythm game chart. Music written for rhythm games however tends to
// have very sharp onsets, so each tracked beat is re-localized against a fine
// energy-rise function computed directly from the waveform. The residual noise of
// the refined positions is then averaged away by the taut-string denoising, which
// is what makes millisecond accuracy achievable for the whole beat sequence.

export const DEFAULT_REFINE_PARAMETERS = Object.freeze({
	searchSeconds: 0.03,
	stepSamples: 16,
	windowSamples: 256,
});

function localEnergy(samples, from, to) {
	let total = 0;
	const start = Math.max(0, from);
	const end = Math.min(samples.length - 1, to);
	for (let index = start; index <= end; index += 1) {
		total += samples[index] * samples[index];
	}
	return total;
}

// Parabolic interpolation of three samples around a maximum.
function parabolicOffset(previous, current, next) {
	const denominator = previous - 2 * current + next;
	if (Math.abs(denominator) < 1e-18) {
		return 0;
	}
	const offset = (0.5 * (previous - next)) / denominator;
	return Math.abs(offset) <= 1 ? offset : 0;
}

// Causal attack strength: the log-energy of the window starting at `position`
// against the log-energy of the window ending there. It peaks exactly at the onset,
// unlike a centred window, which is biased by half its width.
function attackStrength(samples, position, width) {
	const after = localEnergy(samples, position, position + width - 1);
	const before = localEnergy(samples, position - width, position - 1);
	return Math.log(1 + 1e4 * after) - Math.log(1 + 1e4 * before);
}

export function refineBeatTime(samples, sampleRate, time, overrides = {}) {
	const parameters = { ...DEFAULT_REFINE_PARAMETERS, ...overrides };
	const step = Math.max(1, Math.floor(parameters.stepSamples));
	const width = Math.max(16, Math.floor(parameters.windowSamples));
	const span = Math.max(step, Math.floor(parameters.searchSeconds * sampleRate));
	const center = Math.round(time * sampleRate);
	const count = Math.floor((2 * span) / step) + 1;
	if (count < 3) {
		return time;
	}
	const strength = new Float64Array(count);
	for (let index = 0; index < count; index += 1) {
		strength[index] = attackStrength(samples, center - span + index * step, width);
	}
	let bestIndex = -1;
	let best = 0;
	for (let index = 1; index + 1 < count; index += 1) {
		if (strength[index] > best) {
			best = strength[index];
			bestIndex = index;
		}
	}
	if (bestIndex < 0) {
		return time;
	}
	const offset = parabolicOffset(strength[bestIndex - 1], strength[bestIndex], strength[bestIndex + 1]);
	return (center - span + (bestIndex + offset) * step) / sampleRate;
}

export function refineBeatTimes(samples, sampleRate, beats, overrides = {}) {
	return beats.map(time => refineBeatTime(samples, sampleRate, time, overrides));
}
