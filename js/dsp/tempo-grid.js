// Tempo-grid fitting for automatic timing.
//
// A tempogram is useful for finding plausible tempi, but its magnitude is
// inherently ambiguous (half/double tempo and harmonics).  This module scores
// candidate beat grids directly against the onset novelty and then follows the
// best candidate through short overlapping windows.  The grid phase is fitted
// independently in each window; the final timing map keeps one continuous beat
// origin and only emits sustained tempo changes.

export const DEFAULT_TEMPO_GRID_PARAMETERS = Object.freeze({
	minimumTempo: 40,
	maximumTempo: 280,
	phaseSteps: 36,
	windowSeconds: 8,
	strideSeconds: 2,
	changeMargin: 0.25,
	changeWindows: 3,
	minimumSegmentSeconds: 10,
	maximumChanges: 2,
});

function peakValue(novelty, position, radius) {
	let value = 0;
	const lower = Math.max(0, Math.floor(position - radius));
	const upper = Math.min(novelty.length - 1, Math.ceil(position + radius));
	for (let index = lower; index <= upper; index += 1) {
		value = Math.max(value, novelty[index]);
	}
	return value;
}

function validRange(novelty, frameRate, start, end) {
	const duration = novelty.length / frameRate;
	const startValue = Number(start);
	const endValue = Number(end);
	const from = Math.max(0, Number.isFinite(startValue) ? startValue : 0);
	const to = Math.min(duration, Number.isFinite(endValue) ? endValue : duration);
	return { start: from, end: Math.max(from, to) };
}

function scoreTempoGridAtPhase(novelty, frameRate, tempo, start, end, phase) {
	const bpm = Number(tempo);
	if (!(bpm > 0) || !(frameRate > 0) || !novelty.length) {
		return { score: 0, phase: 0, beats: 0 };
	}
	const range = validRange(novelty, frameRate, start, end);
	const period = 60 / bpm;
	const radius = Math.max(1, Math.round(frameRate * 0.012));
	let total = 0;
	let count = 0;
	const first = phase + Math.ceil((range.start - phase - 1e-9) / period) * period;
	for (let time = first; time < range.end; time += period) {
		total += peakValue(novelty, time * frameRate, radius);
		count += 1;
	}
	return { score: count ? total / Math.sqrt(count) : 0, phase, beats: count };
}

/** Score the best phase of a tempo grid in a time range. */
export function scoreTempoGrid(novelty, frameRate, tempo, start = 0, end = novelty.length / frameRate, overrides = {}) {
	const bpm = Number(tempo);
	if (!(bpm > 0) || !(frameRate > 0) || !novelty.length) {
		return { score: 0, phase: 0, beats: 0 };
	}
	const period = 60 / bpm;
	const phaseSteps = Math.max(8, Math.floor(overrides.phaseSteps || DEFAULT_TEMPO_GRID_PARAMETERS.phaseSteps));
	let best = { score: -Infinity, phase: 0, beats: 0 };
	for (let phaseIndex = 0; phaseIndex < phaseSteps; phaseIndex += 1) {
		const phase = (phaseIndex * period) / phaseSteps;
		const candidate = scoreTempoGridAtPhase(novelty, frameRate, bpm, start, end, phase);
		if (candidate.score > best.score) {
			best = candidate;
		}
	}
	// The coarse phase grid is intentionally cheap. A short local search recovers the
	// sub-frame onset position without making every tempo candidate expensive.
	const step = period / phaseSteps;
	for (let phase = best.phase - step; phase <= best.phase + step + 1e-9; phase += step / 4) {
		const candidate = scoreTempoGridAtPhase(novelty, frameRate, bpm, start, end, phase);
		if (candidate.score > best.score) {
			best = candidate;
		}
	}
	return best;
}

function addCandidate(candidates, tempo, minimum, maximum, separation = 2) {
	const value = Number(tempo);
	if (!(value >= minimum && value <= maximum)) {
		return;
	}
	if (candidates.some(candidate => Math.abs(candidate - value) < separation)) {
		return;
	}
	candidates.push(value);
}

function rankedTempi(novelty, frameRate, start, end, parameters) {
	const ranked = [];
	const minimum = Math.max(1, Number(parameters.minimumTempo) || 50);
	const maximum = Math.max(minimum + 1, Number(parameters.maximumTempo) || 280);
	for (let tempo = Math.ceil(minimum); tempo <= maximum; tempo += 1) {
		ranked.push({ tempo, ...scoreTempoGrid(novelty, frameRate, tempo, start, end, parameters) });
	}
	ranked.sort((left, right) => right.score - left.score);
	return ranked;
}

function topTempi(novelty, frameRate, start, end, parameters, count = 4) {
	const ranked = rankedTempi(novelty, frameRate, start, end, parameters);
	const result = [];
	for (const candidate of ranked) {
		if (result.every(existing => Math.abs(existing.tempo - candidate.tempo) >= 8)) {
			result.push(candidate);
		}
		if (result.length >= count) {
			break;
		}
	}
	return result;
}

function refineTempo(novelty, frameRate, tempo, start, end, parameters) {
	const center = Number(tempo);
	if (!(center > 0)) {
		return 120;
	}
	let best = { tempo: center, ...scoreTempoGrid(novelty, frameRate, center, start, end, parameters) };
	for (let value = center - 3; value <= center + 3.0001; value += 0.25) {
		if (value < parameters.minimumTempo || value > parameters.maximumTempo) {
			continue;
		}
		const candidate = { tempo: value, ...scoreTempoGrid(novelty, frameRate, value, start, end, parameters) };
		if (candidate.score > best.score) {
			best = candidate;
		}
	}
	return best;
}

function chooseInitialTempo(novelty, frameRate, globalTempo, parameters) {
	const duration = novelty.length / frameRate;
	const earlyEnd = Math.min(duration, 20);
	const global = Math.min(parameters.maximumTempo, Math.max(parameters.minimumTempo, Number(globalTempo) || 120));
	const early = topTempi(novelty, frameRate, 0, earlyEnd, parameters, 12);
	const shortEarly = topTempi(novelty, frameRate, 0, Math.min(duration, 12), parameters, 8);
	const globalEarly = scoreTempoGrid(novelty, frameRate, global, 0, earlyEnd, parameters).score;
	const globalFull = scoreTempoGrid(novelty, frameRate, global, 0, duration, parameters).score;
	if (global < 120 && global * 2 <= parameters.maximumTempo) {
		const doubled = scoreTempoGrid(novelty, frameRate, global * 2, 0, duration, parameters);
		if (doubled.score > globalFull * 1.12) {
			return refineTempo(novelty, frameRate, global * 2, 0, earlyEnd, parameters).tempo;
		}
	}
	let selected = global;
	const candidate = early[0] || shortEarly[0];
	if (candidate) {
		let effective = candidate;
		if (candidate.tempo > 220) {
			const half = {
				tempo: candidate.tempo / 2,
				...scoreTempoGrid(novelty, frameRate, candidate.tempo / 2, 0, earlyEnd, parameters),
			};
			if (half.score >= candidate.score * 0.65 && half.score > globalEarly * 1.03) {
				effective = half;
			}
		}
		// A global tempogram can land on a nearby subdivision. A modest early-grid
		// advantage is enough to promote the musically coherent candidate, while the
		// full-song check below rejects isolated intro transients.
		if (effective.score > globalEarly * 1.04) {
			const full = scoreTempoGrid(novelty, frameRate, effective.tempo, 0, duration, parameters);
			const likelyIntroTempo = effective.tempo < global * 0.95;
			if (full.score >= globalFull * 0.95 || likelyIntroTempo) {
				selected = effective.tempo;
			}
		}
	}
	if (Math.abs(selected - global) < 8) {
		return roundTempo(global);
	}
	return refineTempo(novelty, frameRate, selected, 0, earlyEnd, parameters).tempo;
}

function collectCandidates(novelty, frameRate, globalTempo, initialTempo, parameters) {
	const minimum = Math.max(1, Number(parameters.minimumTempo) || 50);
	const maximum = Math.max(minimum + 1, Number(parameters.maximumTempo) || 280);
	const duration = novelty.length / frameRate;
	const candidates = [];
	const baseTempi = [globalTempo, initialTempo, globalTempo / 2, globalTempo * 2, initialTempo / 2, initialTempo * 2];
	for (const center of [globalTempo, initialTempo]) {
		for (const ratio of [2 / 3, 3 / 4, 4 / 5, 5 / 6, 6 / 5, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 7 / 5, 5 / 7, 3 / 5]) {
			addCandidate(candidates, Number(center) * ratio, minimum, maximum);
		}
	}
	for (const tempo of baseTempi) {
		addCandidate(candidates, tempo, minimum, maximum);
	}
	// Local tempograms can miss a short transition completely. Keep a dense band
	// around the established starting tempo so ordinary changes (roughly +/- 45 BPM)
	// remain discoverable, while avoiding a full 50..280 BPM scan for every window.
	for (let start = 0; start < duration; start += 16) {
		const end = Math.min(duration, start + 20);
		for (const candidate of topTempi(novelty, frameRate, start, end, parameters, 3)) {
			addCandidate(candidates, candidate.tempo, minimum, maximum);
		}
	}
	const anchors = [
		[0, Math.min(duration, 20)],
		[Math.max(0, duration / 2 - 6), Math.min(duration, duration / 2 + 6)],
		[Math.max(0, duration - 12), duration],
	];
	for (const [start, end] of anchors) {
		for (const candidate of topTempi(novelty, frameRate, start, end, parameters, 5)) {
			addCandidate(candidates, candidate.tempo, minimum, maximum);
		}
	}
	return candidates;
}

// The state machine is intentionally kept together so pending changes and
// segment boundaries share the same evidence.
// eslint-disable-next-line max-lines-per-function
function chooseSegments(novelty, frameRate, candidates, initialTempo, parameters) {
	const duration = novelty.length / frameRate;
	const window = Math.max(2, Number(parameters.windowSeconds) || 8);
	const stride = Math.max(0.5, Number(parameters.strideSeconds) || 2);
	const configuredMinimum = Number(parameters.minimumSegmentSeconds) || 10;
	// Long tracks still need to represent brief, intentional tempo regions (for
	// example a two-bar slowdown before a return). Keep the floor conservative,
	// but do not make it longer than the configured ten-second default.
	const minimumSegment = duration < 40 ? Math.max(6, configuredMinimum) : Math.max(8, configuredMinimum);
	const observations = [];
	for (let start = 0; start < duration; start += stride) {
		const end = Math.min(duration, start + window);
		observations.push({ start, end });
	}
	if (!observations.length) {
		return [{ start: 0, end: duration, tempo: initialTempo }];
	}
	let currentTempo = initialTempo;
	let pendingTempo = null;
	let pendingCount = 0;
	let pendingAnchors = [];
	const segments = [{ start: 0, end: duration, tempo: initialTempo }];
	for (const observation of observations) {
		const anchor = observation.start;
		const scores = candidates.map(tempo => ({
			tempo,
			...scoreTempoGrid(novelty, frameRate, tempo, observation.start, observation.end, parameters),
		}));
		const current = scores.reduce((best, item) =>
			Math.abs(item.tempo - currentTempo) < Math.abs(best.tempo - currentTempo) ? item : best,
		);
		let winner = scores
			.filter(item => item.beats >= 2)
			.sort((left, right) => right.score - left.score)[0] || current;
		// Keep a pending change alive when a harmonic or transient candidate briefly
		// outranks it. This matters for short, real tempo regions.
		if (pendingTempo != null) {
			const continuation = scores
				.filter(item => Math.abs(item.tempo - pendingTempo) < 3 && item.beats >= 2)
				.sort((left, right) => right.score - left.score)[0];
			const pendingReturn =
				currentTempo < initialTempo * 0.9 && Math.abs(pendingTempo - initialTempo) < 4;
			const continuationMargin = pendingReturn ? 0.78 : 0.9;
			if (continuation && continuation.score >= winner.score * continuationMargin) {
				winner = continuation;
			}
		}
		if (winner.tempo > currentTempo * 1.2 && winner.tempo / 2 >= parameters.minimumTempo) {
			const half = scores
				.filter(item => Math.abs(item.tempo - winner.tempo / 2) < 4)
			.sort((left, right) => right.score - left.score)[0];
			if (half && half.score >= winner.score * 0.8) {
				winner = half;
			}
		}
		const margin = Math.max(0.03, Number(parameters.changeMargin) || 0.18);
		const isDifferent = Math.abs(winner.tempo - currentTempo) > 3;
		const ratioToCurrent = winner.tempo / Math.max(1, currentTempo);
		const isReturningToInitial = Math.abs(winner.tempo - initialTempo) < 4 && currentTempo < initialTempo * 0.9;
		const isShortSlowdown = ratioToCurrent > 0.7 && ratioToCurrent < 0.9;
		const effectiveMargin = isReturningToInitial ? 0.1 : isShortSlowdown ? 0.04 : margin;
		const isBetter = winner.score > current.score * (1 + effectiveMargin) && winner.score > 0.35;
		const isHarmonic =
			(ratioToCurrent > 1.9 && ratioToCurrent < 2.1) ||
			(ratioToCurrent > 0.48 && ratioToCurrent < 0.53);
		// A half/double grid is musically equivalent, but a change between the
		// two units is not evidence of a real tempo change. Keeping it out of the
		// change tracker prevents constant songs with a strong subdivision from
		// acquiring a spurious BPM event.
		// A return from a slow section can first appear as the exact double of the
		// slow tempo. If that harmonic grid is weaker than the original tempo grid,
		// treat it as evidence for the return instead of discarding the observation.
		if (
			currentTempo < initialTempo * 0.9 &&
			pendingTempo != null &&
			Math.abs(pendingTempo - initialTempo) < 4 &&
			winner.tempo > currentTempo * 1.7
		) {
			const initial = scores
				.filter(item => Math.abs(item.tempo - initialTempo) < 4)
				.sort((left, right) => right.score - left.score)[0];
			if (initial) {
				winner = pendingTempo === initial.tempo ? initial : { ...initial, tempo: pendingTempo };
			}
		}
		if (isHarmonic && currentTempo < initialTempo * 0.9 && winner.tempo > currentTempo * 1.7) {
			const initial = scores
				.filter(item => Math.abs(item.tempo - initialTempo) < 4)
				.sort((left, right) => right.score - left.score)[0];
			const pendingInitial =
				pendingTempo != null && Math.abs(pendingTempo - initialTempo) < 4 ? initial : null;
			if (
				pendingInitial ||
				(initial && initial.score >= current.score * 1.08 && initial.score >= winner.score * 0.82)
			) {
				winner = pendingInitial || initial;
			}
		}
		const harmonicReturn =
			isHarmonic && currentTempo < initialTempo * 0.9 && Math.abs(winner.tempo - initialTempo) < 4;
		if (isHarmonic && !harmonicReturn) {
			pendingTempo = null;
			pendingCount = 0;
			pendingAnchors = [];
			continue;
		}
		const pendingReturnEvidence =
			pendingTempo != null &&
			currentTempo < initialTempo * 0.9 &&
			Math.abs(pendingTempo - initialTempo) < 4 &&
			Math.abs(winner.tempo - initialTempo) < 4 &&
			winner.score >= current.score * 0.9;
		if (isDifferent && (isBetter || pendingReturnEvidence)) {
			if (pendingTempo != null && Math.abs(pendingTempo - winner.tempo) < 3) {
				pendingCount += 1;
				pendingAnchors.push(anchor);
			} else {
				pendingTempo = winner.tempo;
				pendingCount = 1;
				pendingAnchors = [anchor];
			}
			const proposedBoundary = pendingAnchors[Math.floor(pendingAnchors.length / 2)] ?? anchor;
			const segmentAge = proposedBoundary - segments.at(-1).start;
			const strongShortChange =
				segments.length > 1 &&
				segmentAge >= Math.max(6, minimumSegment * 0.55) &&
				winner.score > current.score * 1.15;
			const canChange = segmentAge >= minimumSegment || strongShortChange;
			const configuredChangeWindows = Math.max(1, Math.floor(parameters.changeWindows || 2));
			let requiredChangeWindows = configuredChangeWindows;
			if (isShortSlowdown) {
				requiredChangeWindows = Math.min(2, configuredChangeWindows);
			}
			const canUseChange =
				canChange &&
				pendingCount >= requiredChangeWindows &&
				segments.length - 1 < Math.max(1, Math.floor(parameters.maximumChanges || 2));
			if (canUseChange) {
				const shortSpeedup =
					segments.length > 1 &&
					winner.tempo < currentTempo * 0.8 &&
					proposedBoundary - segments.at(-1).start < 12;
				let boundary = proposedBoundary;
				if (!shortSpeedup) {
					boundary = refineTempoBoundary(
						novelty,
						frameRate,
						segments.at(-1).start,
						proposedBoundary,
						currentTempo,
						winner.tempo,
						duration,
						parameters,
					);
				}
				segments.at(-1).end = boundary;
				segments.push({ start: boundary, end: duration, tempo: winner.tempo });
				currentTempo = winner.tempo;
				pendingTempo = null;
				pendingCount = 0;
				pendingAnchors = [];
			}
		} else if (!pendingReturnEvidence) {
			pendingTempo = null;
			pendingCount = 0;
			pendingAnchors = [];
		}
	}
	return segments.filter(segment => segment.end - segment.start > 0.5);
}

function refineTempoBoundary(
	novelty,
	frameRate,
	segmentStart,
	proposed,
	previousTempo,
	nextTempo,
	duration,
	parameters,
) {
	const search = Math.max(2, Math.min(8, Number(parameters.windowSeconds) || 8));
	const contextStart = Math.max(segmentStart, proposed - search);
	const contextEnd = Math.min(duration, proposed + search);
	if (contextEnd - contextStart < 4) {
		return proposed;
	}
	const scoreAt = boundary =>
		scoreTempoGrid(novelty, frameRate, previousTempo, contextStart, boundary, parameters).score +
		scoreTempoGrid(novelty, frameRate, nextTempo, boundary, contextEnd, parameters).score;
	let bestBoundary = proposed;
	let bestScore = scoreAt(proposed);
	for (let boundary = contextStart; boundary <= contextEnd + 1e-9; boundary += 0.5) {
		const score = scoreAt(boundary);
		if (score > bestScore) {
			bestScore = score;
			bestBoundary = boundary;
		}
	}
	// A boundary is only moved when the local two-tempo fit has a measurable
	// advantage. This avoids chasing a single loud onset in otherwise steady music.
	const ratio = nextTempo / Math.max(1, previousTempo);
	if (ratio > 1.35 && bestScore < scoreAt(proposed) * 1.04) {
		return (proposed + bestBoundary) / 2;
	}
	return bestScore > scoreAt(proposed) * 1.015 ? bestBoundary : proposed;
}

function pruneWeakSpeedups(segments) {
	const result = segments.map(segment => ({ ...segment }));
	for (let index = 1; index < result.length; index += 1) {
		const previous = result[index - 1];
		const current = result[index];
		const next = result[index + 1];
		if (!next && current.end - current.start < 8) {
			previous.end = current.end;
			result.splice(index, 1);
			index -= 1;
			continue;
		}
		const returnsToPrevious = next && Math.abs(next.tempo - previous.tempo) <= Math.max(5, previous.tempo * 0.04);
		const ratio = current.tempo / Math.max(1, previous.tempo);
		if (!returnsToPrevious || current.end - current.start >= 40 || ratio <= 1.15) {
			continue;
		}
		const merged = { start: previous.start, end: next.end, tempo: previous.tempo };
		result.splice(index - 1, 3, merged);
		index -= 1;
	}
	return result.filter((segment, segmentIndex) => {
		if (segment.end - segment.start <= 0.5) {
			return false;
		}
		if (segmentIndex > 0) {
			segment.start = result[segmentIndex - 1].end;
		}
		return segment.end > segment.start;
	});
}

// A short slowdown immediately before a confirmed speedup can be hidden by an
// overlapping analysis window. Recover it only when two adjacent windows show a
// slower grid with a meaningful absolute score; this keeps weak alternatives in
// steady passages from becoming changes.
function recoverShortSlowdowns(segments, novelty, frameRate, candidates, initialTempo, parameters) {
	const result = segments.map(segment => ({ ...segment }));
	const window = Math.max(6, Number(parameters.windowSeconds) || 8);
	const stride = Math.max(1, Number(parameters.strideSeconds) || 2);
	for (let index = 1; index < result.length; index += 1) {
		const previous = result[index - 1];
		const current = result[index];
		if (previous.tempo < initialTempo * 0.8 || current.tempo <= previous.tempo * 1.1) {
			continue;
		}
		const searchStart = Math.max(previous.start + 8, current.start - 16);
		const searchEnd = current.start - 2;
		if (searchEnd - searchStart < stride * 2) {
			continue;
		}
		const slower = candidates.filter(
			tempo => tempo < previous.tempo * 0.86 && tempo > previous.tempo * 0.72,
		);
		let best = null;
		for (const tempo of slower) {
			let run = 0;
			let runStart = searchStart;
			let runScore = 0;
			for (let start = searchStart; start <= searchEnd + 1e-9; start += stride) {
				const end = Math.min(current.start, start + window);
				const candidateScore = scoreTempoGrid(novelty, frameRate, tempo, start, end, parameters).score;
				const previousScore = scoreTempoGrid(
					novelty,
					frameRate,
					previous.tempo,
					start,
					end,
					parameters,
				).score;
				if (candidateScore >= 0.5 && candidateScore >= previousScore * 0.8) {
					run = run ? run + 1 : 1;
					runStart = start;
					runScore = run ? runScore + candidateScore : candidateScore;
					const averageScore = runScore / run;
					if (
						run >= 2 &&
						(!best || averageScore > best.score + 0.01 ||
							(Math.abs(averageScore - best.score) <= 0.01 && runStart < best.start))
					) {
						best = { start: Math.max(searchStart, runStart - stride * 2), tempo, score: averageScore };
					}
				} else {
					run = 0;
					runScore = 0;
				}
			}
		}
		if (!best || best.start <= previous.start + 4 || current.start - best.start < 6) {
			continue;
		}
		previous.end = best.start;
		result.splice(index, 0, { start: best.start, end: current.start, tempo: best.tempo, recovered: true });
		index += 1;
	}
	return result;
}

// When a slowdown returns to the opening tempo, the state machine may place the
// return several windows late because subdivision candidates interrupt its
// pending state. Find the first sustained two-window advantage for the opening
// grid and move that return boundary earlier.
function refineReturnBoundaries(segments, novelty, frameRate, parameters) {
	const result = segments.map(segment => ({ ...segment }));
	const window = Math.max(6, Number(parameters.windowSeconds) || 8);
	const stride = Math.max(1, Number(parameters.strideSeconds) || 2);
	for (let index = 1; index < result.length - 1; index += 1) {
		const previous = result[index - 1];
		const current = result[index];
		const next = result[index + 1];
		if (
			current.tempo >= previous.tempo * 0.8 ||
			Math.abs(next.tempo - previous.tempo) > Math.max(6, previous.tempo * 0.06)
		) {
			continue;
		}
		const searchStart = current.start + 2;
		const searchEnd = current.end - 2;
		if (searchEnd - searchStart < window) {
			continue;
		}
		let run = 0;
		let runStart = searchStart;
		let boundary = null;
		const period = 60 / Math.max(1, previous.tempo);
		const openingPhase = scoreTempoGrid(
			novelty,
			frameRate,
			previous.tempo,
			0,
			Math.min(30, novelty.length / frameRate),
			parameters,
		).phase;
		let lastPhase = null;
		for (let start = searchStart; start + window <= searchEnd + 1e-9; start += stride) {
			const phaseScore = scoreTempoGrid(novelty, frameRate, previous.tempo, start, start + window, parameters);
			if (
				lastPhase != null &&
				phaseDistance(phaseScore.phase, lastPhase, period) > period * 0.18 &&
				phaseDistance(phaseScore.phase, openingPhase, period) < period * 0.3 &&
				phaseScore.score >= 0.4
			) {
				boundary = start + stride;
				break;
			}
			lastPhase = phaseScore.phase;
		}
		if (boundary != null) {
			const refined = Math.min(current.end - 0.5, Math.max(current.start + 4, boundary));
			if (refined < current.end - 2) {
				current.end = refined;
				next.start = refined;
			}
			continue;
		}
		for (let start = searchStart; start + window <= searchEnd + 1e-9; start += stride) {
			const end = start + window;
			const returnScore = scoreTempoGrid(
				novelty,
				frameRate,
				previous.tempo,
				start,
				end,
				parameters,
			).score;
			const slowScore = scoreTempoGrid(novelty, frameRate, current.tempo, start, end, parameters).score;
			if (returnScore >= 0.45 && returnScore >= slowScore * 1.05) {
				run = run ? run + 1 : 1;
				runStart = run === 1 ? start : runStart;
				if (run >= 2) {
					boundary = runStart + window;
					break;
				}
			} else {
				run = 0;
			}
		}
		if (boundary == null) {
			continue;
		}
		const refined = Math.min(current.end - 0.5, Math.max(current.start + 4, boundary));
		if (refined < current.end - 2) {
			current.end = refined;
			next.start = refined;
		}
	}
	return result;
}

function normalizeTempoSegments(segments, initialTempo, novelty, frameRate, parameters) {
	const result = segments.map(segment => ({ ...segment }));
	for (const segment of result.slice(1)) {
		const double = segment.tempo * 2;
		if (Math.abs(double - initialTempo) <= Math.max(5, initialTempo * 0.035)) {
			segment.tempo = initialTempo;
			continue;
		}
		if (double <= parameters.maximumTempo) {
			const halfScore = scoreTempoGrid(
				novelty,
				frameRate,
				segment.tempo,
				segment.start,
				segment.end,
				parameters,
			).score;
			const doubleScore = scoreTempoGrid(
				novelty,
				frameRate,
				double,
				segment.start,
				segment.end,
				parameters,
			).score;
			if (
				doubleScore > halfScore * 1.05 &&
				double > result[0].tempo * 1.05 &&
				segment.tempo < result[0].tempo * 0.6
			) {
				segment.tempo = double;
			}
		}
	}
	for (let index = 1; index < result.length; index += 1) {
		if (Math.abs(result[index].tempo - result[index - 1].tempo) <= 5) {
			result[index - 1].end = result[index].end;
			result.splice(index, 1);
			index -= 1;
		}
	}
	return result;
}

function canonicalPhase(value, period) {
	let phase = Number(value) || 0;
	phase -= Math.round(phase / period) * period;
	return phase;
}

function phaseDistance(left, right, period) {
	return Math.abs(canonicalPhase(left - right, period));
}

function chooseOffset(phase, tempo, parameters, novelty, frameRate) {
	const period = 60 / Math.max(1, Number(tempo) || 120);
	const duration = novelty.length / frameRate;
	const windows = [
		{ start: 0, end: Math.min(30, duration), weight: 2 },
		{ start: 0, end: duration, weight: 1 },
		{ start: Math.min(20, duration), end: duration, weight: 1 },
	];
	const candidates = [phase];
	for (const window of windows) {
		candidates.push(scoreTempoGrid(novelty, frameRate, tempo, window.start, window.end, parameters).phase);
	}
	const hint = Number(parameters.offsetHint);
	const unique = [];
	for (const candidate of candidates) {
		const normalized = canonicalPhase(candidate, period);
		if (unique.every(existing => phaseDistance(existing, normalized, period) > period / 36)) {
			unique.push(normalized);
		}
	}
	const scored = unique.map(candidate => ({
		phase: candidate,
		score: windows.reduce(
			(total, window) =>
				total +
					window.weight *
						scoreTempoGridAtPhase(novelty, frameRate, tempo, window.start, window.end, candidate).score,
			0,
		),
	}));
	const strongest = scored.reduce((best, candidate) => (candidate.score > best.score ? candidate : best));
	let selected = strongest;
	if (Number.isFinite(hint) && scored.length) {
		const nearest = scored.reduce((best, candidate) => {
			if (phaseDistance(candidate.phase, hint, period) < phaseDistance(best.phase, hint, period)) {
				return candidate;
			}
			return best;
		});
		const nearestDistance = phaseDistance(nearest.phase, hint, period);
		const strongestDistance = phaseDistance(strongest.phase, hint, period);
		// A very close onset hint wins outright. Otherwise only prefer the hint when
		// the grid fit is materially weaker; this rejects isolated intro transients.
		const closeToHint = nearestDistance < Math.max(0.06, period * 0.1);
		const compatibleHint =
			nearestDistance < period * 0.24 && strongestDistance - nearestDistance < period * 0.15;
		if (nearest.score >= strongest.score * 0.8 && (closeToHint || compatibleHint)) {
			selected = nearest;
		}
	}
	let offset = selected?.phase ?? canonicalPhase(phase, period);
	const hintDistance = selected && Number.isFinite(hint) ? phaseDistance(selected.phase, hint, period) : Infinity;
	// Preserve the absolute onset hint when the fitted phase is only a small
	// fraction of a beat away. The phase search is quantized by the novelty
	// frame grid, so a relative threshold is more stable across tempi than a
	// fixed number of seconds; larger disagreements still use the global grid.
	const hintPhaseIsReliable = selected === strongest || selected.score >= strongest.score * 0.995;
	if (selected && hintPhaseIsReliable && Number.isFinite(hint) && hintDistance < period * 0.08) {
		offset = hint;
	}
	return offset;
}

function roundTempo(value) {
	return Math.round(value * 1e6) / 1e6;
}

/** Fit timing directly from novelty and a global tempogram estimate. */
export function timingFromTempoGrid(novelty, frameRate, globalTempo, overrides = {}) {
	const parameters = { ...DEFAULT_TEMPO_GRID_PARAMETERS, ...overrides };
	if (!novelty?.length || !(frameRate > 0)) {
		return { offset: 0, initialBpm: 120, bpmChanges: [], beatCount: 0 };
	}
	const initialBpm = chooseInitialTempo(novelty, frameRate, globalTempo, parameters);
	const candidates = collectCandidates(novelty, frameRate, globalTempo, initialBpm, parameters);
	const chosenSegments = chooseSegments(novelty, frameRate, candidates, initialBpm, parameters);
	const prunedSegments = pruneWeakSpeedups(chosenSegments);
	const recoveredSegments = recoverShortSlowdowns(
		prunedSegments,
		novelty,
		frameRate,
		candidates,
		initialBpm,
		parameters,
	);
	const returnedSegments = refineReturnBoundaries(recoveredSegments, novelty, frameRate, parameters);
	const segments = normalizeTempoSegments(returnedSegments, initialBpm, novelty, frameRate, parameters);
	const fittedInitialBpm = roundTempo(
		refineTempo(
			novelty,
			frameRate,
			initialBpm,
			0,
			segments[0]?.end ?? Math.min(30, novelty.length / frameRate),
			parameters,
		).tempo,
	);
	const initialGrid = scoreTempoGrid(
		novelty,
		frameRate,
		fittedInitialBpm,
		0,
		Math.min(30, novelty.length / frameRate),
		parameters,
	);
	const offset = chooseOffset(initialGrid.phase, fittedInitialBpm, parameters, novelty, frameRate);
	const bpmChanges = [];
	const segmentTempi = segments.map((segment, index) => {
		if (index === 0) {
			return fittedInitialBpm;
		}
		if (segment.recovered) {
			return roundTempo(segment.tempo);
		}
		return roundTempo(refineTempo(novelty, frameRate, segment.tempo, segment.start, segment.end, parameters).tempo);
	});
	let previous = segmentTempi[0] ?? roundTempo(initialBpm);
	let changeCursor = offset;
	let beatCursor = 0;
	for (let index = 1; index < segments.length; index += 1) {
		const segment = segments[index];
		const boundary = Math.max(offset, segment.start);
		if (boundary > changeCursor) {
			beatCursor += ((boundary - changeCursor) * previous) / 60;
		}
		const bpm = segmentTempi[index];
		if (Math.abs(bpm - previous) >= 0.5) {
			bpmChanges.push({ beat: Math.max(0, beatCursor), time: segment.start, bpm, betweenBeats: false });
		}
		previous = bpm;
		changeCursor = boundary;
	}
	let beatCount = 0;
	let countCursor = offset;
	for (const [index, segment] of segments.entries()) {
		const start = Math.max(countCursor, segment.start);
		const end = Math.max(start, segment.end);
		beatCount += Math.max(0, Math.floor((end - start) / (60 / (segmentTempi[index] || segment.tempo))));
		countCursor = end;
	}
	return { offset, initialBpm: fittedInitialBpm, bpmChanges, beatCount, candidates, segments };
}
