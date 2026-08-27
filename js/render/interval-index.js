import { Rational } from "../core/rational.js";

// Sorted array primitives and the interval index that the chart render index is built on.
//
// The render index keeps every derived view of a chart in arrays that stay sorted by time,
// so that a frame can binary search its way to the events it has to draw. Mutations splice
// into those arrays instead of rebuilding them. The interval index is a static augmented
// binary tree over ranges: queries return every record whose [rangeStart, rangeEnd] window
// overlaps the queried instant or span.

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

export function compareNoteRecords(left, right) {
	return (
		left.start - right.start ||
		Rational.compare(left.event.time, right.event.time) ||
		left.sequence - right.sequence
	);
}
export class IntervalIndex {
	constructor(records, startField = "rangeStart", endField = "rangeEnd") {
		this.startField = startField;
		this.endField = endField;
		this.records = [...records].sort(
			(left, right) => left[startField] - right[startField] || (left.sequence ?? 0) - (right.sequence ?? 0),
		);
		this.pendingRecords = [];
		this.invalidRecords = new Set();
		this.size = 1;
		while (this.size < this.records.length) {
			this.size *= 2;
		}
		this.maximumEnds = new Float64Array(this.size * 2);
		this.maximumEnds.fill(-Infinity);
		for (let index = 0; index < this.records.length; index += 1) {
			this.maximumEnds[this.size + index] = this.records[index][endField];
		}
		for (let index = this.size - 1; index > 0; index -= 1) {
			this.maximumEnds[index] = Math.max(this.maximumEnds[index * 2], this.maximumEnds[index * 2 + 1]);
		}
	}

	query(beginning, ending = beginning) {
		if (!Number.isFinite(beginning) || !Number.isFinite(ending) || ending < beginning) {
			return [];
		}
		const limit = upperBound(this.records, ending, this.startField);
		const result = [];
		this.#collect(1, 0, this.size, limit, beginning, result);
		for (const record of this.pendingRecords) {
			if (
				!this.invalidRecords.has(record) &&
				record[this.startField] <= ending &&
				record[this.endField] >= beginning
			) {
				result.push(record);
			}
		}
		if (this.pendingRecords.length) {
			result.sort(
				(left, right) =>
					left[this.startField] - right[this.startField] || (left.sequence ?? 0) - (right.sequence ?? 0),
			);
		}
		return result;
	}

	add(record) {
		this.invalidRecords.delete(record);
		this.pendingRecords.push(record);
		return record;
	}

	replace(oldRecord, newRecord) {
		const pendingIndex = this.pendingRecords.indexOf(oldRecord);
		if (pendingIndex >= 0) {
			this.pendingRecords[pendingIndex] = newRecord;
			this.invalidRecords.delete(oldRecord);
			return true;
		}
		const index = this.records.indexOf(oldRecord);
		if (index < 0 || this.records[index][this.startField] !== newRecord[this.startField]) {
			return false;
		}
		this.records[index] = newRecord;
		this.invalidRecords.delete(oldRecord);
		let node = this.size + index;
		this.maximumEnds[node] = newRecord[this.endField];
		for (node >>= 1; node > 0; node >>= 1) {
			this.maximumEnds[node] = Math.max(this.maximumEnds[node * 2], this.maximumEnds[node * 2 + 1]);
		}
		return true;
	}

	remove(record) {
		this.invalidRecords.add(record);
		this.pendingRecords = this.pendingRecords.filter(candidate => candidate !== record);
		return true;
	}

	#collect(node, left, right, limit, beginning, result) {
		if (left >= limit || this.maximumEnds[node] < beginning) {
			return;
		}
		if (right - left === 1) {
			if (left < this.records.length && !this.invalidRecords.has(this.records[left])) {
				result.push(this.records[left]);
			}
			return;
		}
		const middle = (left + right) >> 1;
		this.#collect(node * 2, left, middle, limit, beginning, result);
		this.#collect(node * 2 + 1, middle, right, limit, beginning, result);
	}

}
