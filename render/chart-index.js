import { Rational } from "../js/core/rational.js";
import { resolveAttachedPosition, sampleSnappee } from "../js/core/geometry.js";
import {
	DURATION_TYPES,
	MOVABLE_TYPES,
	NOTE_TYPES,
	PATTERN_TYPES,
	SUNNIESNOW_SKIN,
	TIP_POINT_ZOOM_DURATION,
	buildTipPointGuides,
	sunniesnowPatternVisualState,
	sunniesnowTapDoubleLinePairs,
} from "./stage-helpers.js";

function upperBound(records, value, field) {
	let low = 0;
	let high = records.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (records[middle][field] <= value) low = middle + 1;
		else high = middle;
	}
	return low;
}

export class IntervalIndex {
	constructor(records, startField = "rangeStart", endField = "rangeEnd") {
		this.startField = startField;
		this.endField = endField;
		this.records = [...records].sort((left, right) =>
			left[startField] - right[startField] || (left.sequence ?? 0) - (right.sequence ?? 0));
		this.size = 1;
		while (this.size < this.records.length) this.size *= 2;
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
		if (!Number.isFinite(beginning) || !Number.isFinite(ending) || ending < beginning) return [];
		const limit = upperBound(this.records, ending, this.startField);
		const result = [];
		this.#collect(1, 0, this.size, limit, beginning, result);
		return result;
	}

	#collect(node, left, right, limit, beginning, result) {
		if (left >= limit || this.maximumEnds[node] < beginning) return;
		if (right - left === 1) {
			if (left < this.records.length) result.push(this.records[left]);
			return;
		}
		const middle = (left + right) >> 1;
		this.#collect(node * 2, left, middle, limit, beginning, result);
		this.#collect(node * 2 + 1, middle, right, limit, beginning, result);
	}
}

function snapPointKey(value) {
	return JSON.stringify(value);
}

function eventFadeOutDuration(event) {
	if (event.type === "bgNote") return SUNNIESNOW_SKIN.bgNoteFadeOutDuration;
	if (event.type === "flick" || event.type === "hold" || (event.type === "tap" && event.text)) {
		return SUNNIESNOW_SKIN.noteFadeOutDuration;
	}
	return 0;
}

function safeDurationEnd(event, timing, start) {
	if (!DURATION_TYPES.has(event.type)) return start;
	try {
		return timing.beatToSeconds(Rational.from(event.time).add(event.duration || [0, 1, 1]));
	} catch {
		return start;
	}
}

export class ChartRenderIndex {
	constructor(project, timing, options = {}) {
		this.project = project;
		this.timing = timing;
		this.approachSpeed = Number(options.noteSpeed) > 0
			? Number(options.noteSpeed) : SUNNIESNOW_SKIN.approachSpeed;
		this.snappeeSamples = new Map();
		this.snappeePointMaps = new Map();
		this.snappeeById = new Map();
		this.eventRecordMap = new Map();
		this.#indexSnappees(project.snappees || []);
		this.eventRecords = (project.events || []).map((event, sequence) => this.#eventRecord(event, sequence));
		this.selectedRecords = this.eventRecords.filter(record => record.event.selected);
		this.selectedEvents = this.selectedRecords.map(record => record.event);
		this.movableRecords = this.eventRecords.filter(record => MOVABLE_TYPES.has(record.event.type));
		this.movableIndex = new IntervalIndex(this.movableRecords, "visibleStart", "visibleEnd");
		this.timelineIndex = new IntervalIndex(this.eventRecords, "start", "end");
		this.patternRecords = this.eventRecords.filter(record => PATTERN_TYPES.has(record.event.type))
			.sort((left, right) => left.start - right.start || left.sequence - right.sequence);
		this.tipGuides = buildTipPointGuides(project, timing).map((guide, sequence) => ({
			...guide,
			sequence,
			rangeStart: guide.spawnTime,
			rangeEnd: guide.endTime + TIP_POINT_ZOOM_DURATION,
		}));
		this.tipGuideIndex = new IntervalIndex(this.tipGuides);
		this.doubleTapPairs = this.#doubleTapPairs(project.events || []);
		this.doubleTapIds = new Set(this.doubleTapPairs.flatMap(record => [record.event1.id, record.event2.id]));
		this.doubleTapIndex = new IntervalIndex(this.doubleTapPairs);
		this.eventLaneOffsets = this.#eventLaneOffsets(project.events || []);
		this.hitRecords = this.eventRecords.filter(record => NOTE_TYPES.has(record.event.type))
			.sort((left, right) => left.start - right.start || left.event.id - right.event.id);
		this.hudHitRecords = this.hitRecords.map(record => ({
			...record,
			hitTime: record.event.type === "hold" ? record.end : record.start,
		})).sort((left, right) => left.hitTime - right.hitTime || left.event.id - right.event.id);
		this.holdReleaseRecords = this.eventRecords.filter(record => record.event.type === "hold")
			.map(record => ({ ...record, releaseTime: record.end }))
			.sort((left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id);
		this.maximumTime = this.eventRecords.reduce((maximum, record) => Math.max(maximum, record.end + 10), 10);
	}

	#indexSnappees(snappees) {
		for (const snappee of snappees) {
			let samples = [];
			try { samples = sampleSnappee(snappee); } catch { /* Invalid draft snappees stay unresolved. */ }
			this.snappeeSamples.set(snappee, samples);
			this.snappeeById.set(snappee.id, snappee);
			this.snappeePointMaps.set(snappee.id,
				new Map(samples.map(sample => [snapPointKey(sample.snapPoint), sample])));
		}
	}

	#resolve(value, prefix = "") {
		const field = name => prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
		if (!value?.[field("attached")]) {
			const x = Number(value?.[field("x")]);
			const y = Number(value?.[field("y")]);
			return Number.isFinite(x) && Number.isFinite(y) ? { x, y, attached: false } : null;
		}
		const snappee = this.snappeeById.get(value[field("snappee")]);
		const candidate = this.snappeePointMaps.get(value[field("snappee")])?.get(snapPointKey(value[field("snapPoint")]));
		return candidate ? { ...candidate, attached: true, snappee } : null;
	}

	#eventRecord(event, sequence) {
		let start;
		try { start = this.timing.beatToSeconds(event.time); } catch { start = 0; }
		const end = safeDurationEnd(event, this.timing, start);
		const record = {
			event,
			sequence,
			start,
			end,
			visibleStart: start - 1 / this.approachSpeed - SUNNIESNOW_SKIN.noteFadeInDuration,
			visibleEnd: end + eventFadeOutDuration(event),
			position: MOVABLE_TYPES.has(event.type) ? this.#resolve(event) : null,
			tipSpawnPosition: this.#resolve(event, "tipPointSpawn"),
		};
		this.eventRecordMap.set(event, record);
		return record;
	}

	#doubleTapPairs(events) {
		const fadeBefore = 1 / this.approachSpeed + 0.25;
		return sunniesnowTapDoubleLinePairs(events).map(([event1, event2], sequence) => {
			const first = this.eventRecordMap.get(event1);
			return {
				event1,
				event2,
				sequence,
				start: first.start,
				rangeStart: first.start - fadeBefore,
				rangeEnd: first.start + 1 / 3,
				position1: first.position,
				position2: this.eventRecordMap.get(event2)?.position,
			};
		});
	}

	#eventLaneOffsets(events) {
		const groups = new Map();
		for (const event of events) {
			const key = `${event.channel}:${Rational.from(event.time).toString()}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(event);
		}
		const offsets = new Map();
		for (const group of groups.values()) {
			group.forEach((event, index) => offsets.set(event.id, (index - (group.length - 1) / 2) * 7));
		}
		return offsets;
	}

	recordFor(event) {
		return this.eventRecordMap.get(event);
	}

	positionFor(event) {
		return this.eventRecordMap.get(event)?.position || resolveAttachedPosition(event, this.project.snappees);
	}

	tipSpawnPositionFor(event) {
		return this.eventRecordMap.get(event)?.tipSpawnPosition
			|| resolveAttachedPosition(event, this.project.snappees, { prefix: "tipPointSpawn" });
	}

	visibleMovableRecords(now) {
		return this.movableIndex.query(now);
	}

	timelineRecords(beginning, ending) {
		return this.timelineIndex.query(beginning, ending);
	}

	activeTipGuides(now) {
		return this.tipGuideIndex.query(now);
	}

	timelineTipGuides(beginning, ending) {
		return this.tipGuideIndex.query(beginning, ending);
	}

	activeDoubleTapPairs(now) {
		return this.doubleTapIndex.query(now);
	}

	hudHitCount(now) {
		return upperBound(this.hudHitRecords, now, "hitTime");
	}

	displayedPattern(now) {
		const limit = upperBound(this.patternRecords, now + SUNNIESNOW_SKIN.patternFadeDuration, "start");
		const record = this.patternRecords[limit - 1];
		if (!record) return null;
		const visual = sunniesnowPatternVisualState(record.start, record.end, now);
		return visual ? { ...record, visual } : null;
	}
}
