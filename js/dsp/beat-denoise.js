// Turning a raw beat sequence into chart timing (offset, initial BPM, BPM changes).
//
// The raw sequence {b_l} with confidences {p_l} is denoised by minimizing
//   1/2 * sum_l |p_l (bt_l - b_l)^2 - q|_{>=0} + lambda * TV{dt_l},
// where dt_l = bt_l - bt_{l-1}. The minimizer is found with a taut-string variant:
// the tolerance q defines a tube of radius sqrt(q / p_l) around every beat, and the
// taut string through that tube is piecewise linear, so {dt_l} has exact constant
// runs (segments of constant BPM). A greedy merge pass afterwards trades data cost
// against total variation according to lambda.

import { halfWaveRectify } from "../core/ndarray.js";

export const DEFAULT_DENOISE_PARAMETERS = Object.freeze({
	tolerance: 0.00001,
	lambda: 0.05,
	minimumConfidence: 0.1,
});

function tubeRadius(confidence, tolerance) {
	const weight = Math.max(1e-6, Number(confidence) || 0);
	return Math.sqrt(Math.max(0, tolerance) / weight);
}

function fitSlope(beats, from, to, anchor) {
	let numerator = 0;
	let denominator = 0;
	for (let index = from + 1; index <= to; index += 1) {
		const step = index - from;
		numerator += step * (beats[index] - anchor);
		denominator += step * step;
	}
	return denominator > 0 ? numerator / denominator : 0;
}

// Taut string through the tube [lower_l, upper_l]; the returned nodes delimit
// straight segments, so the slopes are exactly the denoised inter-beat intervals.
export function tautString(beats, lower, upper) {
	const count = beats.length;
	const nodes = [];
	let anchorIndex = 0;
	let anchorValue = Math.min(upper[0], Math.max(lower[0], beats[0]));
	nodes.push({ index: anchorIndex, value: anchorValue });
	while (anchorIndex < count - 1) {
		let slopeMinimum = -Infinity;
		let slopeMaximum = Infinity;
		let minimumIndex = anchorIndex;
		let maximumIndex = anchorIndex;
		let broke = false;
		for (let index = anchorIndex + 1; index < count; index += 1) {
			const span = index - anchorIndex;
			const candidateMaximum = (upper[index] - anchorValue) / span;
			const candidateMinimum = (lower[index] - anchorValue) / span;
			if (candidateMaximum < slopeMaximum) {
				slopeMaximum = candidateMaximum;
				maximumIndex = index;
			}
			if (candidateMinimum > slopeMinimum) {
				slopeMinimum = candidateMinimum;
				minimumIndex = index;
			}
			if (slopeMinimum <= slopeMaximum) {
				continue;
			}
			const pressedUpper = maximumIndex < minimumIndex;
			anchorIndex = pressedUpper ? maximumIndex : minimumIndex;
			anchorValue = pressedUpper ? upper[maximumIndex] : lower[minimumIndex];
			nodes.push({ index: anchorIndex, value: anchorValue });
			broke = true;
			break;
		}
		if (broke) {
			continue;
		}
		const fitted = fitSlope(beats, anchorIndex, count - 1, anchorValue);
		const slope = Math.min(slopeMaximum, Math.max(slopeMinimum, fitted));
		anchorValue += slope * (count - 1 - anchorIndex);
		anchorIndex = count - 1;
		nodes.push({ index: anchorIndex, value: anchorValue });
	}
	return nodes;
}

function nodeSlope(nodes, segment) {
	const start = nodes[segment];
	const end = nodes[segment + 1];
	const span = Math.max(1, end.index - start.index);
	return (end.value - start.value) / span;
}

export function nodesToValues(nodes, count) {
	const values = new Float64Array(count);
	if (nodes.length === 1) {
		values.fill(nodes[0].value);
		return values;
	}
	for (let segment = 0; segment + 1 < nodes.length; segment += 1) {
		const start = nodes[segment];
		const slope = nodeSlope(nodes, segment);
		for (let index = start.index; index <= nodes[segment + 1].index; index += 1) {
			values[index] = start.value + slope * (index - start.index);
		}
	}
	return values;
}

function spanDataCost(nodes, segment, beats, confidences, tolerance) {
	const start = nodes[segment];
	const end = nodes[segment + 1];
	const slope = nodeSlope(nodes, segment);
	let total = 0;
	for (let index = start.index; index <= end.index; index += 1) {
		const predicted = start.value + slope * (index - start.index);
		const deviation = predicted - beats[index];
		const weight = Math.max(1e-6, Number(confidences[index]) || 0);
		total += halfWaveRectify(weight * deviation * deviation - tolerance);
	}
	return total / 2;
}

function localVariation(nodes, from, to) {
	let total = 0;
	for (let segment = Math.max(1, from); segment <= Math.min(nodes.length - 2, to); segment += 1) {
		total += Math.abs(nodeSlope(nodes, segment) - nodeSlope(nodes, segment - 1));
	}
	return total;
}

// Delta of the objective when interior node `position` is dropped. Only the two
// adjacent segments and the three neighbouring slope differences change, so this
// stays cheap enough to run a full greedy descent.
function removalDelta(nodes, position, beats, confidences, parameters) {
	const before =
		spanDataCost(nodes, position - 1, beats, confidences, parameters.tolerance) +
		spanDataCost(nodes, position, beats, confidences, parameters.tolerance) +
		parameters.lambda * localVariation(nodes, position - 1, position + 1);
	const candidate = nodes.slice(0, position).concat(nodes.slice(position + 1));
	const after =
		spanDataCost(candidate, position - 1, beats, confidences, parameters.tolerance) +
		parameters.lambda * localVariation(candidate, position - 1, position);
	return { delta: after - before, candidate };
}

function mergeSegments(nodes, beats, confidences, parameters) {
	let current = nodes;
	while (current.length > 2) {
		let bestDelta = -1e-12;
		let bestCandidate = null;
		for (let position = 1; position + 1 < current.length; position += 1) {
			const { delta, candidate } = removalDelta(current, position, beats, confidences, parameters);
			if (delta < bestDelta) {
				bestDelta = delta;
				bestCandidate = candidate;
			}
		}
		if (!bestCandidate) {
			break;
		}
		current = bestCandidate;
	}
	return current;
}

export function denoiseBeats(beats, confidences, overrides = {}) {
	const parameters = { ...DEFAULT_DENOISE_PARAMETERS, ...overrides };
	const kept = [];
	const keptConfidences = [];
	for (let index = 0; index < beats.length; index += 1) {
		const confidence = Number(confidences?.[index] ?? 1);
		if (confidence < parameters.minimumConfidence) {
			continue;
		}
		kept.push(Number(beats[index]));
		keptConfidences.push(confidence);
	}
	if (kept.length < 2) {
		return { beats: kept, intervals: [], nodes: [], rawBeats: kept, parameters };
	}
	const samples = Float64Array.from(kept);
	const lower = new Float64Array(kept.length);
	const upper = new Float64Array(kept.length);
	for (let index = 0; index < kept.length; index += 1) {
		const radius = tubeRadius(keptConfidences[index], parameters.tolerance);
		lower[index] = kept[index] - radius;
		upper[index] = kept[index] + radius;
	}
	const nodes = mergeSegments(tautString(samples, lower, upper), samples, keptConfidences, parameters);
	const values = nodesToValues(nodes, kept.length);
	const intervals = [];
	for (let index = 1; index < values.length; index += 1) {
		intervals.push(values[index] - values[index - 1]);
	}
	return {
		beats: Array.from(values),
		intervals,
		nodes,
		rawBeats: kept,
		confidences: keptConfidences,
		parameters,
	};
}

function roundBpm(interval) {
	if (!(interval > 0)) {
		return 120;
	}
	return Math.round((60 / interval) * 1e6) / 1e6;
}

// A run of exactly one deviating interval means the BPM changed between two beats
// rather than exactly at one, so solve for the crossing time inside that interval.
function loneTransition(startTime, startBeat, middle, previous, next) {
	const inversePrevious = 1 / previous;
	const inverseNext = 1 / next;
	if (Math.abs(inversePrevious - inverseNext) < 1e-12) {
		return { time: startTime, beat: startBeat };
	}
	const shift = (1 - middle * inverseNext) / (inversePrevious - inverseNext);
	if (!Number.isFinite(shift) || shift <= 0 || shift >= middle) {
		return { time: startTime, beat: startBeat };
	}
	return { time: startTime + shift, beat: startBeat + shift / previous };
}

function intervalRuns(intervals) {
	const runs = [];
	for (let index = 0; index < intervals.length; index += 1) {
		const last = runs.at(-1);
		if (last && Math.abs(last.interval - intervals[index]) < 1e-9) {
			last.length += 1;
			continue;
		}
		runs.push({ interval: intervals[index], start: index, length: 1 });
	}
	return runs;
}

// Converts the denoised beat sequence into offset / initial BPM / BPM changes.
export function timingFromDenoisedBeats(denoised) {
	const values = denoised.beats || [];
	const intervals = denoised.intervals || [];
	if (values.length < 2 || !intervals.length) {
		return { offset: values[0] ?? 0, initialBpm: 120, bpmChanges: [], beatCount: values.length };
	}
	const runs = intervalRuns(intervals);
	const changes = [];
	for (let index = 1; index < runs.length; index += 1) {
		const run = runs[index];
		const previous = runs[index - 1];
		const next = runs[index + 1];
		const direction = Math.sign(run.interval - previous.interval);
		const isLone =
			run.length === 1 && next && direction !== 0 && Math.sign(next.interval - run.interval) === direction;
		if (isLone) {
			const spot = loneTransition(values[run.start], run.start, run.interval, previous.interval, next.interval);
			changes.push({ beat: spot.beat, time: spot.time, bpm: roundBpm(next.interval), betweenBeats: true });
			continue;
		}
		changes.push({ beat: run.start, time: values[run.start], bpm: roundBpm(run.interval), betweenBeats: false });
	}
	const filtered = [];
	for (const change of changes) {
		const previousBpm = filtered.at(-1)?.bpm ?? roundBpm(runs[0].interval);
		if (Math.abs(previousBpm - change.bpm) < 1e-9) {
			continue;
		}
		filtered.push(change);
	}
	return {
		offset: values[0],
		initialBpm: roundBpm(runs[0].interval),
		bpmChanges: filtered,
		beatCount: values.length,
	};
}
