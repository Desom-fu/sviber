import { Rational } from "../core/rational.js";
import { resolveAttachedPosition, sampleSnappee, sampleSnappeePath } from "../core/geometry.js";
import { eventTime, eventUsesChannel, flattenEvents, walkEvents } from "../core/grouping.js";
import {
	DURATION_TYPES,
	MOVABLE_TYPES,
	NOTE_TYPES,
	PATTERN_TYPES,
	SUNNIESNOW_SKIN,
	TIP_POINT_SPAWN_TYPES,
	TIP_POINT_ZOOM_DURATION,
	buildTipPointGuides,
	sunniesnowPatternVisualState,
	sunniesnowTapDoubleLinePairs,
	tipPointSpawnTime,
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

function lowerBound(records, value, field) {
	let low = 0;
	let high = records.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (records[middle][field] < value) low = middle + 1;
		else high = middle;
	}
	return low;
}

function insertSorted(records, record, compare) {
	let low = 0;
	let high = records.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (compare(records[middle], record) <= 0) low = middle + 1;
		else high = middle;
	}
	records.splice(low, 0, record);
}

export class IntervalIndex {
	constructor(records, startField = "rangeStart", endField = "rangeEnd") {
		this.startField = startField;
		this.endField = endField;
		this.records = [...records].sort((left, right) =>
			left[startField] - right[startField] || (left.sequence ?? 0) - (right.sequence ?? 0));
		this.pendingRecords = [];
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
		for (const record of this.pendingRecords) {
			if (record[this.startField] <= ending && record[this.endField] >= beginning) result.push(record);
		}
		if (this.pendingRecords.length) result.sort((left, right) =>
			left[this.startField] - right[this.startField] || (left.sequence ?? 0) - (right.sequence ?? 0));
		return result;
	}

	add(record) {
		this.pendingRecords.push(record);
		return record;
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
		this.eventSource = project.events;
		this.flatEvents = flattenEvents(project.events || [], true);
		this.leafEvents = this.flatEvents.filter(event => event.type !== "group");
		this.leafEventsByChannel = new Map((project.channels || []).map(channel => [channel.id, []]));
		for (const event of this.leafEvents) this.leafEventsByChannel.get(event.channel)?.push(event);
		this.ancestorsById = new Map();
		walkEvents(project.events || [], (event, ancestors) => this.ancestorsById.set(event.id, ancestors));
		this.timing = timing;
		this.selectionScope = options.selectionScope ?? null;
		this.approachSpeed = Number(options.noteSpeed) > 0
			? Number(options.noteSpeed) : SUNNIESNOW_SKIN.approachSpeed;
		this.snappeeSamples = new Map();
		this.snappeePaths = new Map();
		this.snappeePointMaps = new Map();
		this.snappeeById = new Map();
		this.eventRecordMap = new Map();
		this.activeChannelIds = new Set((project.channels || [])
			.filter(channel => channel.active !== false)
			.map(channel => channel.id));
		this.#indexSnappees(project.snappees || []);
		this.eventRecords = this.flatEvents.map((event, sequence) => this.#eventRecord(event, sequence));
		this.eventById = new Map(this.eventRecords.map(record => [record.event.id, record.event]));
		this.selectedRecords = this.eventRecords.filter(record => this.isEventSelected(record.event));
		this.selectedEvents = this.selectedRecords.map(record => record.event);
		this.selectedEventIds = new Set(this.selectedEvents.map(event => event.id));
		this.activeEventRecords = this.eventRecords.filter(record =>
			this.#isActive(record.event) && record.event.type !== "comment");
		this.stageSelectedEvents = new Set(this.activeEventRecords
			.filter(record => this.isEventSelected(record.event))
			.map(record => record.event));
		this.commentRecords = this.eventRecords.filter(record => record.event.type === "comment");
		this.commentIndex = new IntervalIndex(this.commentRecords, "start", "end");
		this.movableRecords = this.activeEventRecords.filter(record => MOVABLE_TYPES.has(record.event.type)
			&& record.event.type !== "group");
		this.groupRecords = this.activeEventRecords.filter(record => record.event.type === "group");
		this.scrollRecords = [...this.movableRecords]
			.sort((left, right) => left.start - right.start || left.sequence - right.sequence);
		this.movableIndex = new IntervalIndex(this.movableRecords, "visibleStart", "visibleEnd");
		this.scrollIndex = new IntervalIndex(this.scrollRecords, "start", "end");
		this.scrollDurationIndex = new IntervalIndex(
			this.movableRecords.filter(record => record.end > record.start), "start", "end",
		);
		this.creationEchoIndex = new IntervalIndex(this.movableRecords, "echoStart", "echoEnd");
		this.timelineIndex = new IntervalIndex(this.eventRecords.filter(record => record.event.type !== "group"), "start", "end");
		this.patternRecords = this.activeEventRecords.filter(record => PATTERN_TYPES.has(record.event.type))
			.sort((left, right) => left.start - right.start || left.sequence - right.sequence);
		const activeProject = {
			...project,
			channels: (project.channels || []).filter(channel => this.activeChannelIds.has(channel.id)),
			events: this.leafEvents.filter(event => this.activeChannelIds.has(event.channel)),
		};
		this.allTipGuides = buildTipPointGuides({ ...project, events: this.flatEvents.filter(event => event.type !== "group") }, timing).map((guide, sequence) => ({
			...guide,
			sequence,
			rangeStart: guide.spawnTime,
			rangeEnd: guide.endTime + TIP_POINT_ZOOM_DURATION,
		}));
		this.tipGuidesByChannel = new Map((project.channels || []).map(channel => [channel.id,
			this.allTipGuides.filter(guide => guide.events[0]?.channel === channel.id)]));
		this.noteEventRecordsByChannel = new Map((project.channels || []).map(channel => [channel.id, []]));
		for (const record of this.eventRecords) {
			if (NOTE_TYPES.has(record.event.type)) this.noteEventRecordsByChannel.get(record.event.channel)?.push(record);
		}
		for (const records of this.noteEventRecordsByChannel.values()) records.sort((left, right) =>
			Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence);
		this.timelineTipGuideIndex = new IntervalIndex(this.allTipGuides);
		this.tipGuides = this.allTipGuides.filter(guide =>
			this.activeChannelIds.has(guide.events[0]?.channel));
		this.tipGuideIndex = new IntervalIndex(this.tipGuides);
		this.doubleTapPairs = this.#doubleTapPairs(activeProject.events);
		this.doubleTapIds = new Set(this.doubleTapPairs.flatMap(record => [record.event1.id, record.event2.id]));
		this.doubleTapIndex = new IntervalIndex(this.doubleTapPairs);
		this.tapEventsByTime = new Map();
		for (const event of activeProject.events) {
			if (event.type !== "tap") continue;
			const key = Rational.from(event.time).toString();
			if (!this.tapEventsByTime.has(key)) this.tapEventsByTime.set(key, []);
			this.tapEventsByTime.get(key).push(event);
		}
		this.eventLaneOffsets = this.#eventLaneOffsets(this.leafEvents);
		this.hitRecords = this.activeEventRecords.filter(record => NOTE_TYPES.has(record.event.type))
			.sort((left, right) => left.start - right.start || left.event.id - right.event.id);
		this.hudHitRecords = this.hitRecords.map(record => ({
			...record,
			hitTime: record.event.type === "hold" ? record.end : record.start,
		})).sort((left, right) => left.hitTime - right.hitTime || left.event.id - right.event.id);
		this.holdReleaseRecords = this.activeEventRecords.filter(record => record.event.type === "hold")
			.map(record => ({ ...record, releaseTime: record.end }))
			.sort((left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id);
		this.maximumTime = this.eventRecords.reduce((maximum, record) => Math.max(maximum, record.end + 10), 10);
	}

	isEventSelected(event) {
		return Boolean(event?.selected || this.ancestorsById.get(event?.id)?.some(ancestor => ancestor.selected));
	}

	isRootSelectedGroup(event) {
		return Boolean(event?.type === "group" && event.selected
			&& !this.ancestorsById.get(event.id)?.some(ancestor => ancestor.selected));
	}

	isEventActive(event) {
		return this.#isActive(event);
	}

	#isActive(event) {
		return event.type === "group"
			? eventUsesChannel(event, this.activeChannelIds)
			: this.activeChannelIds.has(event.channel);
	}

	selectionTarget(event) {
		const ancestors = this.ancestorsById.get(event?.id) || [];
		if (this.selectionScope != null) {
			const scopeIndex = ancestors.findIndex(ancestor => ancestor.id === this.selectionScope);
			if (scopeIndex >= 0) return ancestors[scopeIndex + 1] || event;
		}
		return ancestors.at(-1) || event;
	}

	#indexSnappees(snappees) {
		for (const snappee of snappees) {
			let samples = [];
			try { samples = sampleSnappee(snappee); } catch { /* Invalid draft snappees stay unresolved. */ }
			this.snappeeSamples.set(snappee, samples);
			if (snappee.type === "bezierCurve" || snappee.type === "penCurve") {
				try { this.snappeePaths.set(snappee, sampleSnappeePath(snappee)); }
				catch { this.snappeePaths.set(snappee, samples); }
			}
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
		try { start = this.timing.beatToSeconds(eventTime(event)); } catch { start = 0; }
		const end = safeDurationEnd(event, this.timing, start);
		const record = {
			event,
			sequence,
			start,
			end,
			visibleStart: start - 1 / this.approachSpeed - SUNNIESNOW_SKIN.noteFadeInDuration,
			visibleEnd: end + eventFadeOutDuration(event),
			echoStart: end,
			echoEnd: end + 1 / this.approachSpeed,
			position: MOVABLE_TYPES.has(event.type) ? this.#resolve(event) : null,
			selectionEvent: this.selectionTarget(event),
			tipSpawnPosition: this.#resolve(event, "tipPointSpawn"),
		};
		this.eventRecordMap.set(event, record);
		return record;
	}

	#doubleTapPairs(events) {
		return sunniesnowTapDoubleLinePairs(events).map(([event1, event2], sequence) =>
			this.#doubleTapRecord(event1, event2, sequence));
	}

	#doubleTapRecord(event1, event2, sequence) {
		const first = this.eventRecordMap.get(event1);
		return {
			event1, event2, sequence, start: first.start,
			rangeStart: first.start - 1 / this.approachSpeed - 0.25,
			rangeEnd: first.start + 1 / 3,
			position1: first.position,
			position2: this.eventRecordMap.get(event2)?.position,
		};
	}

	#eventLaneOffsets(events) {
		const groups = new Map();
		for (const event of events) {
			const key = `${event.channel}:${Rational.from(event.time).toString()}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(event);
		}
		this.laneEventsByKey = groups;
		const offsets = new Map();
		for (const group of groups.values()) {
			group.forEach((event, index) => offsets.set(event.id, (index - (group.length - 1) / 2) * 7));
		}
		return offsets;
	}

	#refreshTipGuides(channelId) {
		const channel = this.project.channels.find(candidate => candidate.id === channelId);
		if (!channel) return;
		const guides = buildTipPointGuides({
			...this.project, channels: [channel], events: this.leafEventsByChannel.get(channelId) || [],
		}, this.timing).map(guide => ({
			...guide,
			rangeStart: guide.spawnTime,
			rangeEnd: guide.endTime + TIP_POINT_ZOOM_DURATION,
		}));
		this.tipGuidesByChannel.set(channelId, guides);
		this.allTipGuides = this.project.channels.flatMap(item => this.tipGuidesByChannel.get(item.id) || []);
		this.allTipGuides.forEach((guide, sequence) => { guide.sequence = sequence; });
		this.timelineTipGuideIndex = new IntervalIndex(this.allTipGuides);
		this.tipGuides = this.allTipGuides.filter(guide => this.activeChannelIds.has(guide.events[0]?.channel));
		this.tipGuideIndex = new IntervalIndex(this.tipGuides);
	}

	#appendTipGuideEvent(record) {
		const records = this.noteEventRecordsByChannel.get(record.event.channel);
		if (!records) return;
		let low = 0;
		let high = records.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			const compared = Rational.compare(records[middle].event.time, record.event.time)
				|| records[middle].sequence - record.sequence;
			if (compared <= 0) low = middle + 1; else high = middle;
		}
		records.splice(low, 0, record);
		const declared = TIP_POINT_SPAWN_TYPES.has(record.event.tipPointSpawnType)
			? record.event.tipPointSpawnType : "inherit";
		if (declared !== "inherit") { this.#refreshTipGuides(record.event.channel); return; }
		let mode = "none";
		let settings = null;
		for (let index = low - 1; index >= 0; index -= 1) {
			const candidate = records[index].event;
			const candidateMode = TIP_POINT_SPAWN_TYPES.has(candidate.tipPointSpawnType)
				? candidate.tipPointSpawnType : "inherit";
			if (candidateMode === "inherit") continue;
			mode = candidateMode;
			if (mode === "chain" || mode === "drop") settings = candidate;
			break;
		}
		const channelGuides = this.tipGuidesByChannel.get(record.event.channel) || [];
		const time = record.start;
		if (mode === "chain") {
			const guide = channelGuides.find(candidate => candidate.mode === "chain" && candidate.spawnSettings === settings);
			if (guide) {
				let index = 0;
				while (index < guide.events.length && (Rational.compare(guide.events[index].time, record.event.time) < 0
					|| Rational.compare(guide.events[index].time, record.event.time) === 0
					&& (this.eventRecordMap.get(guide.events[index])?.sequence ?? 0) < record.sequence)) index += 1;
				guide.events.splice(index, 0, record.event);
				guide.eventTimes.splice(index, 0, time);
				guide.endTime = guide.eventTimes.at(-1);
				guide.rangeEnd = guide.endTime + TIP_POINT_ZOOM_DURATION;
			}
		} else if (mode === "drop" && settings) {
			channelGuides.push({
				mode, spawnSettings: settings, events: [record.event], eventTimes: [time],
				spawnTime: tipPointSpawnTime(record.event, settings, this.timing), endTime: time,
				rangeStart: tipPointSpawnTime(record.event, settings, this.timing),
				rangeEnd: time + TIP_POINT_ZOOM_DURATION,
			});
		}
		this.tipGuidesByChannel.set(record.event.channel, channelGuides);
		this.allTipGuides = this.project.channels.flatMap(item => this.tipGuidesByChannel.get(item.id) || []);
		this.allTipGuides.forEach((guide, sequence) => { guide.sequence = sequence; });
		this.timelineTipGuideIndex = new IntervalIndex(this.allTipGuides);
		this.tipGuides = this.allTipGuides.filter(guide => this.activeChannelIds.has(guide.events[0]?.channel));
		this.tipGuideIndex = new IntervalIndex(this.tipGuides);
	}

	recordFor(event) {
		return this.eventRecordMap.get(event);
	}

	setEventSelected(event, selected) {
		if (!this.eventRecordMap.has(event)) return;
		if (selected) this.selectedEventIds.add(event.id);
		else this.selectedEventIds.delete(event.id);
		if (selected && this.#isActive(event) && event.type !== "comment") {
			this.stageSelectedEvents.add(event);
		} else {
			this.stageSelectedEvents.delete(event);
		}
	}

	syncSelection() {
		this.selectedRecords = this.eventRecords.filter(record => this.isEventSelected(record.event));
		this.selectedEvents = this.selectedRecords.map(record => record.event);
		this.selectedEventIds = new Set(this.selectedEvents.map(event => event.id));
		this.stageSelectedEvents = new Set(this.activeEventRecords
			.filter(record => this.isEventSelected(record.event) && record.event.type !== "comment")
			.map(record => record.event));
	}

	replaceSelection(events) {
		const seen = new Set();
		this.selectedEvents = [...events].flatMap(event => [event,
			...(event.type === "group" ? flattenEvents(event.events || [], true) : [])])
			.filter(event => !seen.has(event.id) && seen.add(event.id));
		this.selectedRecords = this.selectedEvents.map(event => this.eventRecordMap.get(event)).filter(Boolean);
		this.selectedEventIds = new Set(this.selectedEvents.map(event => event.id));
		this.stageSelectedEvents = new Set(this.selectedEvents.filter(event =>
			this.#isActive(event) && event.type !== "comment"));
	}

	appendRootEvent(event) {
		if (!event || this.eventSource !== this.project.events || this.eventById.has(event.id)) return false;
		const sequence = this.eventRecords.length;
		this.flatEvents.push(event);
		this.leafEvents.push(event);
		this.leafEventsByChannel.get(event.channel)?.push(event);
		this.ancestorsById.set(event.id, []);
		const record = this.#eventRecord(event, sequence);
		this.eventRecords.push(record);
		this.eventById.set(event.id, event);
		this.timelineIndex.add(record);
		const active = this.#isActive(event) && event.type !== "comment";
		if (active) this.activeEventRecords.push(record);
		if (event.type === "comment") {
			this.commentRecords.push(record);
			this.commentIndex.add(record);
		}
		if (active && MOVABLE_TYPES.has(event.type) && event.type !== "group") {
			this.movableRecords.push(record);
			insertSorted(this.scrollRecords, record, (left, right) => left.start - right.start || left.sequence - right.sequence);
			this.movableIndex.add(record);
			this.scrollIndex.add(record);
			if (record.end > record.start) this.scrollDurationIndex.add(record);
			this.creationEchoIndex.add(record);
		}
		const laneKey = `${event.channel}:${Rational.from(event.time).toString()}`;
		const lane = this.laneEventsByKey.get(laneKey) || [];
		lane.push(event);
		this.laneEventsByKey.set(laneKey, lane);
		lane.forEach((candidate, index) =>
			this.eventLaneOffsets.set(candidate.id, (index - (lane.length - 1) / 2) * 7));
		if (active && NOTE_TYPES.has(event.type)) {
			insertSorted(this.hitRecords, record, (left, right) => left.start - right.start || left.event.id - right.event.id);
			const hud = { ...record, hitTime: event.type === "hold" ? record.end : record.start };
			insertSorted(this.hudHitRecords, hud, (left, right) => left.hitTime - right.hitTime || left.event.id - right.event.id);
			this.#appendTipGuideEvent(record);
		}
		if (active && event.type === "hold") {
			const release = { ...record, releaseTime: record.end };
			insertSorted(this.holdReleaseRecords, release,
				(left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id);
		}
		if (active && event.type === "tap") {
			const key = Rational.from(event.time).toString();
			const taps = this.tapEventsByTime.get(key) || [];
			const previous = taps.at(-1);
			taps.push(event);
			this.tapEventsByTime.set(key, taps);
			if (previous) {
				const pair = this.#doubleTapRecord(previous, event, this.doubleTapPairs.length);
				this.doubleTapPairs.push(pair);
				this.doubleTapIds.add(previous.id); this.doubleTapIds.add(event.id);
				this.doubleTapIndex.add(pair);
			}
		}
		this.maximumTime = Math.max(this.maximumTime, record.end + 10);
		return true;
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

	scrollEventRecords(beginning, ending, maximum = Infinity) {
		if (!Number.isFinite(maximum)) return this.scrollIndex.query(beginning, ending);
		maximum = Math.max(1, Math.floor(maximum));
		const records = this.scrollIndex.records;
		const first = lowerBound(records, beginning, "start");
		const last = upperBound(records, ending, "start");
		const pending = this.scrollIndex.pendingRecords.filter(record =>
			record.start >= beginning && record.start <= ending);
		const count = Math.max(0, last - first) + pending.length;
		const result = [];
		const seen = new Set();
		const append = record => {
			if (!record || seen.has(record)) return;
			seen.add(record);
			result.push(record);
		};
		const baseCount = Math.max(0, last - first);
		const pendingBudget = Math.min(pending.length, maximum);
		const baseBudget = Math.max(0, maximum - pendingBudget);
		if (count <= maximum) {
			for (let index = first; index < last; index += 1) append(records[index]);
		} else {
			for (let sample = 0; sample < baseBudget; sample += 1) {
				const index = first + Math.floor(sample * baseCount / Math.max(1, baseBudget));
				append(records[index]);
			}
		}
		if (pending.length <= pendingBudget) pending.forEach(append);
		else for (let sample = 0; sample < pendingBudget; sample += 1) {
			append(pending[Math.floor(sample * pending.length / pendingBudget)]);
		}
		for (const record of this.scrollDurationIndex.query(beginning)) {
			if (record.start < beginning) append(record);
		}
		for (const id of this.selectedEventIds) {
			const event = this.eventById.get(id);
			const record = event && this.eventRecordMap.get(event);
			if (record && event.type !== "group" && this.activeChannelIds.has(event.channel) && MOVABLE_TYPES.has(event.type)
				&& record.start <= ending && record.end >= beginning) append(record);
		}
		Object.defineProperty(result, "sampled", { value: count > maximum });
		return result;
	}

	creationEchoRecords(now) {
		return this.creationEchoIndex.query(now);
	}

	timelineRecords(beginning, ending) {
		return this.timelineIndex.query(beginning, ending);
	}

	activeComments(now) {
		return this.commentIndex.query(now)
			.filter(record => record.start <= now && record.end > now)
			.map(record => record.event);
	}

	activeTipGuides(now) {
		return this.tipGuideIndex.query(now);
	}

	scrollTipGuides(beginning, ending) {
		return this.tipGuideIndex.query(beginning, ending);
	}

	timelineTipGuides(beginning, ending) {
		return this.timelineTipGuideIndex.query(beginning, ending);
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
