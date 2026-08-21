import { Rational } from "./rational.js";

const DEFAULT_MAX_DENOMINATOR = 1_000_000;

function assertFinite(value, label) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number`);
	return number;
}

function assertBpm(value) {
	const bpm = assertFinite(value, "BPM");
	if (bpm <= 0) throw new RangeError("BPM must be positive");
	return bpm;
}

function changeBeat(change) {
	return Rational.from(change?.time ?? change?.beat ?? 0);
}

export function normalizeBpmChanges(changes = []) {
	if (!Array.isArray(changes)) throw new TypeError("bpmChanges must be an array");
	const normalized = changes.map((change, sourceIndex) => ({
		time: changeBeat(change),
		bpm: assertBpm(change?.bpm),
		sourceIndex,
	}));
	normalized.sort((left, right) => left.time.compare(right.time) || left.sourceIndex - right.sourceIndex);

	const deduplicated = [];
	for (const change of normalized) {
		const previous = deduplicated.at(-1);
		if (previous?.time.equals(change.time)) {
			deduplicated[deduplicated.length - 1] = change;
		} else {
			deduplicated.push(change);
		}
	}
	return deduplicated.map(({ time, bpm }) => ({ time, bpm }));
}

export function normalizeBarLines(lines = []) {
	if (!Array.isArray(lines)) throw new TypeError("barLines must be an array");
	const normalized = lines.map((line, sourceIndex) => ({
		time: Rational.from(line?.time ?? line?.beat ?? line ?? 0),
		sourceIndex,
	}));
	normalized.sort((left, right) => left.time.compare(right.time) || left.sourceIndex - right.sourceIndex);
	const deduplicated = [];
	for (const line of normalized) {
		if (deduplicated.at(-1)?.time.equals(line.time)) deduplicated[deduplicated.length - 1] = line;
		else deduplicated.push(line);
	}
	return deduplicated.map(({ time }) => ({ time }));
}

function ceilRational(value) {
	const rational = Rational.from(value);
	const quotient = rational.numerator / rational.denominator;
	return quotient + (rational.numerator > 0n && rational.numerator % rational.denominator ? 1n : 0n);
}

function floorRational(value) {
	const rational = Rational.from(value);
	const quotient = rational.numerator / rational.denominator;
	return quotient - (rational.numerator < 0n && rational.numerator % rational.denominator ? 1n : 0n);
}

function safeInteger(value, label) {
	const number = Number(value);
	if (!Number.isSafeInteger(number)) throw new RangeError(`${label} is outside the supported beat range`);
	return number;
}

/** Piecewise-positive BPM map whose offset is the audio time of beat zero. */
export class TimingMap {
	constructor(options = {}, initialBpm, bpmChanges) {
		if (typeof options === "number") {
			options = { offset: options, initialBpm, bpmChanges };
		}
		this._offset = assertFinite(options.offset ?? 0, "offset");
		this._initialBpm = assertBpm(options.initialBpm ?? 120);
		this.setBpmChanges(options.bpmChanges ?? []);
		this.setBarLines(options.barLines ?? []);
	}

	get offset() {
		return this._offset;
	}

	set offset(value) {
		this.setOffset(value);
	}

	get initialBpm() {
		return this._initialBpm;
	}

	set initialBpm(value) {
		this.setInitialBpm(value);
	}

	get bpmChanges() {
		return this._bpmChanges;
	}

	set bpmChanges(value) {
		this.setBpmChanges(value);
	}

	get barLines() {
		return this._barLines;
	}

	set barLines(value) {
		this.setBarLines(value);
	}

	setOffset(offset) {
		this._offset = assertFinite(offset, "offset");
		this._rebuildChangeTimes();
		return this;
	}

	setInitialBpm(bpm) {
		this._initialBpm = assertBpm(bpm);
		this._rebuildChangeTimes();
		return this;
	}

	setBpmChanges(changes) {
		this._bpmChanges = normalizeBpmChanges(changes);
		this._rebuildChangeTimes();
		return this;
	}

	setBarLines(lines) {
		this._barLines = normalizeBarLines(lines);
		return this;
	}

	addBarLine(time) {
		const target = Rational.from(time);
		if (this.barLines.some(line => line.time.equals(target))) return false;
		this.setBarLines([...this.barLines, { time: target }]);
		return true;
	}

	removeBarLine(time) {
		const target = Rational.from(time);
		const next = this.barLines.filter(line => !line.time.equals(target));
		const changed = next.length !== this.barLines.length;
		if (changed) this.setBarLines(next);
		return changed;
	}

	barLineAt(time) {
		const target = Rational.from(time);
		return this.barLines.find(line => line.time.equals(target)) || null;
	}

	latestBarLineAt(time) {
		const target = Rational.from(time);
		let low = 0;
		let high = this.barLines.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (this.barLines[middle].time.compare(target) <= 0) low = middle + 1;
			else high = middle;
		}
		return low ? this.barLines[low - 1].time : Rational.from(0);
	}

	beatLinesBetween(beginning, end, subdivision = 1) {
		if (!Number.isSafeInteger(subdivision) || subdivision < 1) {
			throw new RangeError("subdivision must be a positive safe integer");
		}
		let first = Rational.from(beginning);
		let last = Rational.from(end);
		if (first.compare(last) > 0) [first, last] = [last, first];
		const actual = this.barLines.map(line => line.time);
		const segments = [{ base: Rational.from(0), beginning: null, end: actual[0] ?? null, barLine: false }];
		for (let index = 0; index < actual.length; index += 1) {
			segments.push({ base: actual[index], beginning: actual[index], end: actual[index + 1] ?? null, barLine: true });
		}
		const result = [];
		const seen = new Set();
		for (const segment of segments) {
			const rangeBeginning = segment.beginning && segment.beginning.compare(first) > 0 ? segment.beginning : first;
			const rangeEnd = segment.end && segment.end.compare(last) < 0 ? segment.end : last;
			if (rangeBeginning.compare(rangeEnd) > 0) continue;
			const scaledBeginning = rangeBeginning.sub(segment.base).mul(subdivision);
			const scaledEnd = rangeEnd.sub(segment.base).mul(subdivision);
			const firstStep = safeInteger(ceilRational(scaledBeginning), "beat line");
			const lastStep = safeInteger(floorRational(scaledEnd), "beat line");
			for (let step = firstStep; step <= lastStep; step += 1) {
				const beat = segment.base.add(new Rational(step, subdivision));
				if (segment.beginning && beat.compare(segment.beginning) < 0) continue;
				if (segment.end && beat.compare(segment.end) >= 0) continue;
				const key = beat.toString();
				if (seen.has(key)) continue;
				seen.add(key);
				const relative = beat.sub(segment.base);
				result.push({
					beat,
					base: segment.base,
					relative,
					barLine: segment.barLine && relative.compare(0) === 0,
					integerFromBar: relative.denominator === 1n,
				});
			}
		}
		return result.sort((left, right) => left.beat.compare(right.beat));
	}

	addBpmChange(time, bpm) {
		this.setBpmChanges([...this.bpmChanges, { time, bpm }]);
		return this;
	}

	removeBpmChange(time) {
		const target = Rational.from(time);
		const next = this.bpmChanges.filter((change) => !change.time.equals(target));
		const changed = next.length !== this.bpmChanges.length;
		if (changed) this.setBpmChanges(next);
		return changed;
	}

	bpmAtBeat(beat) {
		const target = Rational.from(beat);
		let low = 0;
		let high = this.bpmChanges.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (this.bpmChanges[middle].time.compare(target) <= 0) low = middle + 1;
			else high = middle;
		}
		return low === 0 ? this.initialBpm : this.bpmChanges[low - 1].bpm;
	}

	_integralBetween(beginning, end) {
		const start = Rational.from(beginning);
		const finish = Rational.from(end);
		if (start.compare(finish) >= 0) return 0;

		let cursor = start;
		let bpm = this.bpmAtBeat(cursor);
		let seconds = 0;
		for (const change of this.bpmChanges) {
			if (change.time.compare(cursor) <= 0) continue;
			if (change.time.compare(finish) >= 0) break;
			seconds += change.time.sub(cursor).toNumber() * 60 / bpm;
			cursor = change.time;
			bpm = change.bpm;
		}
		seconds += finish.sub(cursor).toNumber() * 60 / bpm;
		return seconds;
	}

	beatToSeconds(beat) {
		const target = Rational.from(beat);
		if (target.compare(0) === 0 || this.bpmChanges.length === 0) {
			return this.offset + target.toNumber() * 60 / this.initialBpm;
		}
		let low = 0;
		let high = this.bpmChanges.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (this.bpmChanges[middle].time.compare(target) <= 0) low = middle + 1;
			else high = middle;
		}
		if (low > 0) {
			const change = this._changeTimes[low - 1];
			return change.seconds + target.sub(change.time).toNumber() * 60 / change.bpm;
		}
		const first = this._changeTimes[0];
		return first.seconds + target.sub(first.time).toNumber() * 60 / this.initialBpm;
	}

	secondsToBeat(seconds, maxDenominator = DEFAULT_MAX_DENOMINATOR) {
		const target = assertFinite(seconds, "seconds");
		return Rational.fromNumber(this.secondsToBeatNumber(target), maxDenominator);
	}

	secondsToBeatNumber(seconds) {
		const target = assertFinite(seconds, "seconds");
		if (this._changeTimes.length === 0) return (target - this.offset) * this.initialBpm / 60;

		let low = 0;
		let high = this._changeTimes.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (this._changeTimes[middle].seconds <= target) low = middle + 1;
			else high = middle;
		}
		if (low === 0) {
			const first = this._changeTimes[0];
			return first.time.toNumber() + (target - first.seconds) * this.initialBpm / 60;
		}
		const previous = this._changeTimes[low - 1];
		return previous.time.toNumber() + (target - previous.seconds) * previous.bpm / 60;
	}

	secondsToSnappedBeat(seconds, subdivision) {
		return this.snapBeat(this.secondsToBeat(seconds), subdivision);
	}

	snapBeat(value, subdivision) {
		if (!Number.isSafeInteger(subdivision) || subdivision < 1) {
			throw new RangeError("subdivision must be a positive safe integer");
		}
		const target = Rational.from(value);
		const base = this.latestBarLineAt(target);
		let closest = base.add(target.sub(base).snap(subdivision));
		const nextBar = this.barLines.find(line => line.time.compare(target) > 0)?.time;
		if (nextBar && nextBar.sub(target).abs().compare(closest.sub(target).abs()) < 0) closest = nextBar;
		return closest;
	}

	snapSeconds(seconds, subdivision) {
		return this.beatToSeconds(this.secondsToSnappedBeat(seconds, subdivision));
	}

	durationToSeconds(startBeat, durationBeats) {
		const start = Rational.from(startBeat);
		const end = start.add(durationBeats);
		return this.beatToSeconds(end) - this.beatToSeconds(start);
	}

	secondsDurationToBeats(startSeconds, durationSeconds, maxDenominator = DEFAULT_MAX_DENOMINATOR) {
		const start = assertFinite(startSeconds, "startSeconds");
		const duration = assertFinite(durationSeconds, "durationSeconds");
		const beatDuration = this.secondsToBeatNumber(start + duration) - this.secondsToBeatNumber(start);
		return Rational.fromNumber(beatDuration, maxDenominator);
	}

	_rebuildChangeTimes() {
		if (!this.bpmChanges?.length) {
			this._changeTimes = [];
			return;
		}
		this._changeTimes = new Array(this.bpmChanges.length);
		let split = 0;
		while (split < this.bpmChanges.length && this.bpmChanges[split].time.compare(0) <= 0) split += 1;
		let cursor = Rational.from(0);
		let seconds = this.offset;
		let bpm = split > 0 ? this.bpmChanges[split - 1].bpm : this.initialBpm;
		for (let index = split; index < this.bpmChanges.length; index += 1) {
			const change = this.bpmChanges[index];
			seconds += change.time.sub(cursor).toNumber() * 60 / bpm;
			this._changeTimes[index] = { time: change.time, bpm: change.bpm, seconds };
			cursor = change.time;
			bpm = change.bpm;
		}
		cursor = Rational.from(0);
		seconds = this.offset;
		for (let index = split - 1; index >= 0; index -= 1) {
			const change = this.bpmChanges[index];
			seconds -= cursor.sub(change.time).toNumber() * 60 / change.bpm;
			this._changeTimes[index] = { time: change.time, bpm: change.bpm, seconds };
			cursor = change.time;
		}
	}

	toJSON() {
		return {
			offset: this.offset,
			initialBpm: this.initialBpm,
			bpmChanges: this.bpmChanges.map((change) => ({
				time: change.time.toJSON(),
				bpm: change.bpm,
			})),
			barLines: this.barLines.map(line => ({ time: line.time.toJSON() })),
		};
	}

	clone() {
		return new TimingMap(this.toJSON());
	}
}

export function beatToSeconds(timing, beat) {
	return (timing instanceof TimingMap ? timing : new TimingMap(timing)).beatToSeconds(beat);
}

export function secondsToBeat(timing, seconds, maxDenominator) {
	return (timing instanceof TimingMap ? timing : new TimingMap(timing))
		.secondsToBeat(seconds, maxDenominator);
}

export default TimingMap;
