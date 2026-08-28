// Synthesizes click tracks for the end-to-end automatic timing tests. Not a *.test.mjs file so
// the runner does not pick it up as a suite of its own.

// One percussive click: a short burst of decaying noise plus a tone, which is what the energy
// novelty of the pipeline is designed to pick out. The noise uses a seeded generator so the
// synthesized audio — and therefore the assertions below — are identical on every run.
function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let result = Math.imul(state ^ (state >>> 15), 1 | state);
		result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
		return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Renders clicks at the given times into a mono buffer.
 *
 * @param {number[]} times click positions in seconds
 * @param {object} [options]
 * @param {number} [options.sampleRate]
 * @param {number} [options.duration] total length in seconds; defaults to just past the last click
 * @param {number} [options.decay] click envelope time constant in seconds
 * @param {number} [options.frequency] click tone frequency in Hz
 * @param {number} [options.noise] amount of broadband noise mixed into each click
 * @param {number} [options.seed]
 * @returns {{samples: Float32Array, sampleRate: number}}
 */
export function renderClickTrack(times, options = {}) {
	const sampleRate = options.sampleRate ?? 22050;
	const decay = options.decay ?? 0.02;
	const frequency = options.frequency ?? 1800;
	const noise = options.noise ?? 0.6;
	const duration = options.duration ?? (times.at(-1) ?? 0) + 0.5;
	const samples = new Float32Array(Math.max(1, Math.round(duration * sampleRate)));
	const random = mulberry32(options.seed ?? 1);
	// Pre-render one click and stamp it at each position: identical clicks make the onset
	// positions the only thing the pipeline can key on.
	const clickLength = Math.min(samples.length, Math.round(decay * 6 * sampleRate));
	const click = new Float32Array(clickLength);
	for (let index = 0; index < clickLength; index += 1) {
		const seconds = index / sampleRate;
		const envelope = Math.exp(-seconds / decay);
		const tone = Math.sin(2 * Math.PI * frequency * seconds);
		click[index] = envelope * ((1 - noise) * tone + noise * (random() * 2 - 1));
	}
	for (const time of times) {
		const start = Math.round(time * sampleRate);
		for (let index = 0; index < clickLength && start + index < samples.length; index += 1) {
			samples[start + index] += click[index];
		}
	}
	let peak = 0;
	for (const value of samples) {
		peak = Math.max(peak, Math.abs(value));
	}
	if (peak > 0) {
		for (let index = 0; index < samples.length; index += 1) {
			samples[index] /= peak;
		}
	}
	return { samples, sampleRate };
}

/** Click times for `beats` beats at a constant tempo, the first one at `offset` seconds. */
export function steadyBeatTimes(bpm, beats, offset = 0) {
	const interval = 60 / bpm;
	return Array.from({ length: beats }, (_, index) => offset + index * interval);
}

/** Click times that run at `firstBpm` for `firstBeats` beats and then switch to `secondBpm`. */
export function tempoChangeBeatTimes(firstBpm, firstBeats, secondBpm, secondBeats, offset = 0) {
	const times = steadyBeatTimes(firstBpm, firstBeats, offset);
	let time = times.at(-1) ?? offset;
	for (let index = 0; index < secondBeats; index += 1) {
		time += 60 / secondBpm;
		times.push(time);
	}
	return times;
}
