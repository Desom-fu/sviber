// Sorted-array primitives and the record comparators used across the chart render
// index. This module owns one invariant: every derived record bucket stays sorted, so
// an incremental edit can splice a single record into place instead of re-sorting the
// whole bucket. The comparators live here too because the initial build, the
// incremental mutation paths and the removal path must order a bucket identically --
// keeping them in one place is what makes those paths interchangeable.

import { Rational } from "../core/rational.js";

export function upperBound(records, value, field) {
	let low = 0;
	let high = records.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (records[middle][field] <= value) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

export function lowerBound(records, value, field) {
	let low = 0;
	let high = records.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (records[middle][field] < value) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

export function insertSorted(records, record, compare) {
	let low = 0;
	let high = records.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (compare(records[middle], record) <= 0) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	records.splice(low, 0, record);
	return low;
}

export function mergeSorted(left, right, compare) {
	const merged = [];
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < left.length && rightIndex < right.length) {
		if (compare(left[leftIndex], right[rightIndex]) <= 0) {
			merged.push(left[leftIndex++]);
		} else {
			merged.push(right[rightIndex++]);
		}
	}
	while (leftIndex < left.length) {
		merged.push(left[leftIndex++]);
	}
	while (rightIndex < right.length) {
		merged.push(right[rightIndex++]);
	}
	return merged;
}

export function compareBySequence(left, right) {
	return left.sequence - right.sequence;
}

export function compareByStart(left, right) {
	return left.start - right.start || left.sequence - right.sequence;
}

export function compareByStartAndEventId(left, right) {
	return left.start - right.start || left.event.id - right.event.id;
}

export function compareByHitTime(left, right) {
	return left.hitTime - right.hitTime || left.event.id - right.event.id;
}

export function compareByReleaseTime(left, right) {
	return left.releaseTime - right.releaseTime || left.event.id - right.event.id;
}

// Notes inside a channel are ordered by wall-clock start first so that timing-map
// changes cannot reorder a chain, then by the exact rational beat to break ties that
// collapse to the same second, then by the stable authoring sequence.
export function compareNoteRecords(left, right) {
	return (
		left.start - right.start ||
		Rational.compare(left.event.time, right.event.time) ||
		left.sequence - right.sequence
	);
}

export function compareNoteEventTimes(left, right) {
	return Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence;
}
