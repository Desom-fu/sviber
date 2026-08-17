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

/** Piecewise-positive BPM map whose offset is the audio time of beat zero. */
export class TimingMap {
	constructor(options = {}, initialBpm, bpmChanges) {
		if (typeof options === "number") {
			options = { offset: options, initialBpm, bpmChanges };
		}
		this._offset = assertFinite(options.offset ?? 0, "offset");
		this._initialBpm = assertBpm(options.initialBpm ?? 120);
		this.setBpmChanges(options.bpmChanges ?? []);
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
		const zeroComparison = target.compare(0);
		if (zeroComparison === 0) return this.offset;
		return zeroComparison > 0
			? this.offset + this._integralBetween(0, target)
			: this.offset - this._integralBetween(target, 0);
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
		return this.secondsToBeat(seconds).snap(subdivision);
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
		if (!this.bpmChanges) {
			this._changeTimes = [];
			return;
		}
		this._changeTimes = this.bpmChanges.map((change) => ({
			time: change.time,
			bpm: change.bpm,
			seconds: this.beatToSeconds(change.time),
		}));
	}

	toJSON() {
		return {
			offset: this.offset,
			initialBpm: this.initialBpm,
			bpmChanges: this.bpmChanges.map((change) => ({
				time: change.time.toJSON(),
				bpm: change.bpm,
			})),
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
