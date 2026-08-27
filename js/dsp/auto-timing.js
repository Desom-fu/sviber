// Full automatic timing pipeline: audio samples -> offset, initial BPM, BPM changes.
// Follows FMP Chapter 6 (onset detection -> tempo analysis -> beat tracking) and
// then denoises the beat sequence so that the result is expressible as a handful of
// BPM changes instead of one per beat.

import { computeNovelty, DEFAULT_NOVELTY_PARAMETERS, NOVELTY_ALGORITHMS } from "./novelty.js";
import { computeTempogram, DEFAULT_TEMPOGRAM_PARAMETERS, globalTempo, TEMPOGRAM_ALGORITHMS } from "./tempogram.js";
import { BEAT_ALGORITHMS, DEFAULT_BEAT_PARAMETERS, trackBeats } from "./beat-tracking.js";
import { DEFAULT_DENOISE_PARAMETERS, denoiseBeats, timingFromDenoisedBeats } from "./beat-denoise.js";
import { DEFAULT_REFINE_PARAMETERS, refineBeatTimes } from "./onset-refine.js";

export const AUTO_TIMING_ALGORITHMS = Object.freeze({
	novelty: NOVELTY_ALGORITHMS,
	tempogram: TEMPOGRAM_ALGORITHMS,
	beat: BEAT_ALGORITHMS,
});

export const AUTO_TIMING_DEFAULTS = Object.freeze({
	novelty: "energy",
	tempogram: "fourier",
	beat: "plp",
	refine: true,
	noveltyParameters: DEFAULT_NOVELTY_PARAMETERS,
	tempogramParameters: DEFAULT_TEMPOGRAM_PARAMETERS,
	beatParameters: DEFAULT_BEAT_PARAMETERS,
	denoiseParameters: DEFAULT_DENOISE_PARAMETERS,
	refineParameters: DEFAULT_REFINE_PARAMETERS,
});

// Down-mixes an AudioBuffer-like object (or plain channel arrays) to mono.
export function toMonoSamples(channels, length) {
	const list = Array.isArray(channels) ? channels : [channels];
	const size = Number(length) || list[0]?.length || 0;
	if (list.length === 1) {
		return list[0];
	}
	const mono = new Float32Array(size);
	for (const channel of list) {
		for (let index = 0; index < size; index += 1) {
			mono[index] += channel[index] / list.length;
		}
	}
	return mono;
}

export function runAutoTiming(samples, sampleRate, options = {}) {
	const noveltyAlgorithm = NOVELTY_ALGORITHMS.includes(options.novelty) ? options.novelty : "energy";
	const tempogramAlgorithm = TEMPOGRAM_ALGORITHMS.includes(options.tempogram) ? options.tempogram : "fourier";
	const beatAlgorithm = BEAT_ALGORITHMS.includes(options.beat) ? options.beat : "plp";
	const noveltyResult = computeNovelty(
		samples,
		sampleRate,
		noveltyAlgorithm,
		options.noveltyParameters?.[noveltyAlgorithm],
	);
	const tempogramParameters = options.tempogramParameters?.[tempogramAlgorithm];
	// PLP needs complex Fourier coefficients, so it always analyses with a Fourier
	// tempogram; the chosen tempogram still drives the global tempo estimate.
	const tempogram = computeTempogram(
		noveltyResult.novelty,
		noveltyResult.frameRate,
		tempogramAlgorithm,
		tempogramParameters,
	);
	const estimatedTempo = globalTempo(tempogram);
	const tracked = trackBeats(noveltyResult.novelty, noveltyResult.frameRate, {
		algorithm: beatAlgorithm,
		parameters: options.beatParameters?.[beatAlgorithm],
		tempogram,
		tempogramParameters: options.tempogramParameters?.fourier,
		frameOffset: noveltyResult.frameOffset,
		estimatedTempo,
	});
	let refined = tracked.beats;
	if (options.refine !== false) {
		refined = refineBeatTimes(samples, sampleRate, tracked.beats, options.refineParameters);
	}
	const denoised = denoiseBeats(refined, tracked.confidences, options.denoiseParameters);
	const timing = timingFromDenoisedBeats(denoised);
	return {
		timing,
		estimatedTempo,
		beatCount: tracked.beats.length,
		keptBeatCount: denoised.rawBeats?.length ?? 0,
		frameRate: noveltyResult.frameRate,
		algorithms: { novelty: noveltyAlgorithm, tempogram: tempogramAlgorithm, beat: beatAlgorithm },
		rawBeats: tracked.beats,
		refinedBeats: refined,
		confidences: tracked.confidences,
		denoisedBeats: denoised.beats,
	};
}
