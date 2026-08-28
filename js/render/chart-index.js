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
	buildTipPointGuidesForOrderedEvents,
	sunniesnowPatternVisualState,
	sunniesnowTapDoubleLinePairs,
	tipPointSpawnTime,
} from "./stage-helpers.js";
import { refreshDoubleTapTime } from "./double-tap-index.js";
import { removeChannelFromIndex, removeEventsFromIndex } from "./chart-index-removal.js";
import { installTraitMembers } from "../core/mixin.js";
import { ChartIndexMutationsTrait } from "./chart-index-mutations.js";
import { ChartIndexTipGuidesTrait } from "./chart-index-tip-guides.js";
import {
	IntervalIndex,
	compareNoteRecords,
	insertSorted,
	lowerBound,
	mergeSorted,
	upperBound,
} from "./interval-index.js";
function snapPointKey(value) {
	return JSON.stringify(value);
}

function eventFadeOutDuration(event) {
	if (event.type === "bgNote") {
		return SUNNIESNOW_SKIN.bgNoteFadeOutDuration;
	}
	if (event.type === "flick" || event.type === "hold" || (event.type === "tap" && event.text)) {
		return SUNNIESNOW_SKIN.noteFadeOutDuration;
	}
	return 0;
}

function safeDurationEnd(event, timing, start) {
	if (!DURATION_TYPES.has(event.type)) {
		return start;
	}
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
		this.selectionScope = options.selectionScope ?? null;
		this.timelineTipRevision = 0;
		this.approachSpeed = Number(options.noteSpeed) > 0 ? Number(options.noteSpeed) : SUNNIESNOW_SKIN.approachSpeed;
		this.snappeeSamples = new Map();
		this.snappeePaths = new Map();
		this.snappeePointMaps = new Map();
		this.snappeeById = new Map();
		this.eventRecordMap = new Map();
		this.activeChannelIds = new Set(
			(project.channels || []).filter(channel => channel.active !== false).map(channel => channel.id),
		);
		this._indexSnappees(project.snappees || []);
		this._indexEvents(project);
		this._indexSelection();
		this._buildRangeIndexes();
		this._buildTipGuideIndexes(project, timing);
		this._buildDoubleTapIndexes();
		this._buildPlaybackIndexes();
	}

	// Flattened views of the event tree. `flatEvents` keeps the groups so that group
	// specific queries stay cheap, `leafEvents` drops them, and `activeLeafEvents` further
	// drops everything on a deactivated channel, which is what the playfield draws.
	_indexEvents(project) {
		this.eventSource = project.events;
		this.flatEvents = flattenEvents(project.events || [], true);
		this.leafEvents = this.flatEvents.filter(event => event.type !== "group");
		this.activeLeafEvents = this.leafEvents.filter(event => this.activeChannelIds.has(event.channel));
		this.ancestorsById = new Map();
		walkEvents(project.events || [], (event, ancestors) => this.ancestorsById.set(event.id, ancestors));
		this.eventRecords = this.flatEvents.map((event, sequence) => this._eventRecord(event, sequence));
		this.eventById = new Map(this.eventRecords.map(record => [record.event.id, record.event]));
	}

	_indexSelection() {
		this.selectedRecords = this.eventRecords.filter(record => this.isEventSelected(record.event));
		this.selectedEvents = this.selectedRecords.map(record => record.event);
		this.selectedEventIds = new Set(this.selectedEvents.map(event => event.id));
		this.activeEventRecords = this.eventRecords.filter(
			record => this._isActive(record.event) && record.event.type !== "comment",
		);
		this.stageSelectedEvents = new Set(
			this.activeEventRecords.filter(record => this.isEventSelected(record.event)).map(record => record.event),
		);
	}

	// One interval index per kind of query a frame performs. They differ only in which
	// records they hold and which pair of fields delimits a record's visible range.
	_buildRangeIndexes() {
		this.commentRecords = this.eventRecords.filter(record => record.event.type === "comment");
		this.commentIndex = new IntervalIndex(this.commentRecords, "start", "end");
		this.movableRecords = this.activeEventRecords.filter(
			record => MOVABLE_TYPES.has(record.event.type) && record.event.type !== "group",
		);
		this.groupRecords = this.activeEventRecords.filter(record => record.event.type === "group");
		this.scrollRecords = [...this.movableRecords].sort(
			(left, right) => left.start - right.start || left.sequence - right.sequence,
		);
		this.movableIndex = new IntervalIndex(this.movableRecords, "visibleStart", "visibleEnd");
		this.scrollIndex = new IntervalIndex(this.scrollRecords, "start", "end");
		this.scrollDurationIndex = new IntervalIndex(
			this.movableRecords.filter(record => record.end > record.start),
			"start",
			"end",
		);
		this.creationEchoIndex = new IntervalIndex(this.movableRecords, "echoStart", "echoEnd");
		this.timelineIndex = new IntervalIndex(
			this.eventRecords.filter(record => record.event.type !== "group"),
			"start",
			"end",
		);
		this.patternRecords = this.activeEventRecords
			.filter(record => PATTERN_TYPES.has(record.event.type))
			.sort((left, right) => left.start - right.start || left.sequence - right.sequence);
	}

	// Tip point guides are computed over the whole chart so that deactivating a channel
	// does not change how the remaining guides inherit their spawn settings; the active
	// subset is filtered afterwards.
	_buildTipGuideIndexes(project, timing) {
		const leafProject = { ...project, events: this.flatEvents.filter(event => event.type !== "group") };
		this.allTipGuides = buildTipPointGuides(leafProject, timing).map((guide, sequence) => ({
			...guide,
			sequence,
			rangeStart: guide.spawnTime,
			rangeEnd: guide.endTime + TIP_POINT_ZOOM_DURATION,
		}));
		this.tipGuidesByChannel = new Map(
			(project.channels || []).map(channel => [
				channel.id,
				this.allTipGuides.filter(guide => guide.events[0]?.channel === channel.id),
			]),
		);
		this.noteEventRecordsByChannel = new Map((project.channels || []).map(channel => [channel.id, []]));
		for (const record of this.eventRecords) {
			if (NOTE_TYPES.has(record.event.type)) {
				this.noteEventRecordsByChannel.get(record.event.channel)?.push(record);
			}
		}
		for (const records of this.noteEventRecordsByChannel.values()) {
			records.sort(
				(left, right) => Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence,
			);
		}
		this.timelineTipGuideIndex = new IntervalIndex(this.allTipGuides);
		this.tipGuides = this.allTipGuides.filter(guide => this.activeChannelIds.has(guide.events[0]?.channel));
		this.tipGuideIndex = new IntervalIndex(this.tipGuides);
	}

	// Simultaneous taps: the pairs that get a double line, plus the per beat lookups that
	// the drawing order of v17 needs.
	_buildDoubleTapIndexes() {
		this.doubleTapPairs = this._doubleTapPairs(this.activeLeafEvents);
		this.doubleTapIds = new Set(this.doubleTapPairs.flatMap(record => [record.event1.id, record.event2.id]));
		this.doubleTapIndex = new IntervalIndex(this.doubleTapPairs);
		this.channelOrder = new Map((this.project.channels || []).map((channel, index) => [channel.id, index]));
		this.tapEventsByTime = new Map();
		for (const event of this.activeLeafEvents) {
			if (event.type !== "tap") {
				continue;
			}
			const key = Rational.from(event.time).toString();
			if (!this.tapEventsByTime.has(key)) {
				this.tapEventsByTime.set(key, []);
			}
			this.tapEventsByTime.get(key).push(event);
		}
		for (const taps of this.tapEventsByTime.values()) {
			taps.sort((left, right) => this.compareTapOrder(left, right));
		}
		this.doubleTapPairsByTime = new Map();
		for (const pair of this.doubleTapPairs) {
			const key = Rational.from(pair.event1.time).toString();
			if (!this.doubleTapPairsByTime.has(key)) {
				this.doubleTapPairsByTime.set(key, []);
			}
			this.doubleTapPairsByTime.get(key).push(pair);
		}
	}

	// Everything playback needs in wall-clock order: the hit sounds, the background note
	// sounds of v17, the head-up display counter and the hold releases.
	_buildPlaybackIndexes() {
		this.eventLaneOffsets = this._eventLaneOffsets(this.leafEvents);
		this.hitRecords = this.activeEventRecords
			.filter(record => NOTE_TYPES.has(record.event.type))
			.sort((left, right) => left.start - right.start || left.event.id - right.event.id);
		this.bgNoteHitRecords = this.activeEventRecords
			.filter(record => record.event.type === "bgNote")
			.sort((left, right) => left.start - right.start || left.event.id - right.event.id);
		this.hudHitRecords = this.hitRecords
			.map(record => ({
				...record,
				hitTime: record.event.type === "hold" ? record.end : record.start,
			}))
			.sort((left, right) => left.hitTime - right.hitTime || left.event.id - right.event.id);
		this.holdReleaseRecords = this.activeEventRecords
			.filter(record => record.event.type === "hold")
			.map(record => ({ ...record, releaseTime: record.end }))
			.sort((left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id);
		this.maximumTime = this.eventRecords.reduce((maximum, record) => Math.max(maximum, record.end + 10), 10);
	}

	// Drawing order of simultaneous events: channel order first (the channel listed at
	// the top is drawn at the bottom), then the stacking order inside the lane. The
	// double lines of v17 connect consecutive taps in exactly this order.
	compareTapOrder(left, right) {
		const leftChannel = this.channelOrder?.get(left.channel) ?? Infinity;
		const rightChannel = this.channelOrder?.get(right.channel) ?? Infinity;
		if (leftChannel !== rightChannel) {
			return leftChannel - rightChannel;
		}
		return (this.eventRecordMap.get(left)?.sequence ?? 0) - (this.eventRecordMap.get(right)?.sequence ?? 0);
	}

	isEventSelected(event) {
		return Boolean(event?.selected || this.ancestorsById.get(event?.id)?.some(ancestor => ancestor.selected));
	}

	isRootSelectedGroup(event) {
		return Boolean(
			event?.type === "group" &&
				event.selected &&
				!this.ancestorsById.get(event.id)?.some(ancestor => ancestor.selected),
		);
	}

	isEventActive(event) {
		return this._isActive(event);
	}

	_isActive(event) {
		if (event.type === "group") {
			return eventUsesChannel(event, this.activeChannelIds);
		}
		return this.activeChannelIds.has(event.channel);
	}

	selectionTarget(event) {
		const ancestors = this.ancestorsById.get(event?.id) || [];
		if (this.selectionScope != null) {
			const scopeIndex = ancestors.findIndex(ancestor => ancestor.id === this.selectionScope);
			if (scopeIndex >= 0) {
				return ancestors[scopeIndex + 1] || event;
			}
		}
		return ancestors.at(-1) || event;
	}

	_indexSnappees(snappees) {
		for (const snappee of snappees) {
			let samples = [];
			try {
				samples = sampleSnappee(snappee);
			} catch {
				/* Invalid draft snappees stay unresolved. */
			}
			this.snappeeSamples.set(snappee, samples);
			if (snappee.type === "bezierCurve" || snappee.type === "penCurve") {
				try {
					this.snappeePaths.set(snappee, sampleSnappeePath(snappee));
				} catch {
					this.snappeePaths.set(snappee, samples);
				}
			}
			this.snappeeById.set(snappee.id, snappee);
			this.snappeePointMaps.set(
				snappee.id,
				new Map(samples.map(sample => [snapPointKey(sample.snapPoint), sample])),
			);
		}
	}

	_resolve(value, prefix = "") {
		const field = name => (prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name);
		if (!value?.[field("attached")]) {
			const x = Number(value?.[field("x")]);
			const y = Number(value?.[field("y")]);
			return Number.isFinite(x) && Number.isFinite(y) ? { x, y, attached: false } : null;
		}
		const snappee = this.snappeeById.get(value[field("snappee")]);
		const candidate = this.snappeePointMaps
			.get(value[field("snappee")])
			?.get(snapPointKey(value[field("snapPoint")]));
		return candidate ? { ...candidate, attached: true, snappee } : null;
	}

	_eventRecord(event, sequence) {
		let start;
		try {
			start = this.timing.beatToSeconds(eventTime(event));
		} catch {
			start = 0;
		}
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
			position: MOVABLE_TYPES.has(event.type) ? this._resolve(event) : null,
			selectionEvent: this.selectionTarget(event),
			tipSpawnPosition: this._resolve(event, "tipPointSpawn"),
		};
		this.eventRecordMap.set(event, record);
		return record;
	}

	_doubleTapPairs(events) {
		this.channelOrder ||= new Map((this.project.channels || []).map((channel, index) => [channel.id, index]));
		return sunniesnowTapDoubleLinePairs(events, this.project.channels).map(([event1, event2], sequence) =>
			this._doubleTapRecord(event1, event2, sequence),
		);
	}

	_doubleTapRecord(event1, event2, sequence) {
		const first = this.eventRecordMap.get(event1);
		return {
			event1,
			event2,
			sequence,
			start: first.start,
			rangeStart: first.start - 1 / this.approachSpeed - 0.25,
			rangeEnd: first.start + 1 / 3,
			position1: first.position,
			position2: this.eventRecordMap.get(event2)?.position,
		};
	}

	_eventLaneOffsets(events) {
		const groups = new Map();
		for (const event of events) {
			const key = `${event.channel}:${Rational.from(event.time).toString()}`;
			if (!groups.has(key)) {
				groups.set(key, []);
			}
			groups.get(key).push(event);
		}
		this.laneEventsByKey = groups;
		const offsets = new Map();
		for (const group of groups.values()) {
			group.forEach((event, index) => offsets.set(event.id, (index - (group.length - 1) / 2) * 7));
		}
		return offsets;
	}

	recordFor(event) {
		return this.eventRecordMap.get(event);
	}

	setEventSelected(event, selected) {
		if (!this.eventRecordMap.has(event)) {
			return;
		}
		if (selected) {
			this.selectedEventIds.add(event.id);
		} else {
			this.selectedEventIds.delete(event.id);
		}
		if (selected && this._isActive(event) && event.type !== "comment") {
			this.stageSelectedEvents.add(event);
		} else {
			this.stageSelectedEvents.delete(event);
		}
	}

	syncSelection() {
		this.selectedRecords = this.eventRecords.filter(record => this.isEventSelected(record.event));
		this.selectedEvents = this.selectedRecords.map(record => record.event);
		this.selectedEventIds = new Set(this.selectedEvents.map(event => event.id));
		this.stageSelectedEvents = new Set(
			this.activeEventRecords
				.filter(record => this.isEventSelected(record.event) && record.event.type !== "comment")
				.map(record => record.event),
		);
	}

	replaceSelection(events) {
		const seen = new Set();
		this.selectedEvents = [...events]
			.flatMap(event => [event, ...(event.type === "group" ? flattenEvents(event.events || [], true) : [])])
			.filter(event => !seen.has(event.id) && seen.add(event.id));
		this.selectedRecords = this.selectedEvents.map(event => this.eventRecordMap.get(event)).filter(Boolean);
		this.selectedEventIds = new Set(this.selectedEvents.map(event => event.id));
		this.stageSelectedEvents = new Set(
			this.selectedEvents.filter(event => this._isActive(event) && event.type !== "comment"),
		);
	}

	removeEvents(events) {
		return removeEventsFromIndex(this, events);
	}

	removeChannel(channelId, events) {
		return removeChannelFromIndex(this, channelId, events);
	}

	refreshPositions(events = null) {
		let records = this.eventRecords;
		if (events) {
			records = [...new Set(events)].map(event => this.eventRecordMap.get(event)).filter(Boolean);
		}
		for (const record of records) {
			record.position = MOVABLE_TYPES.has(record.event.type) ? this._resolve(record.event) : null;
			record.tipSpawnPosition = this._resolve(record.event, "tipPointSpawn");
		}
		this.timelineTipRevision += 1;
	}

	positionFor(event) {
		return this.eventRecordMap.get(event)?.position || resolveAttachedPosition(event, this.project.snappees);
	}

	tipSpawnPositionFor(event) {
		return (
			this.eventRecordMap.get(event)?.tipSpawnPosition ||
			resolveAttachedPosition(event, this.project.snappees, { prefix: "tipPointSpawn" })
		);
	}

	visibleMovableRecords(now) {
		return this.movableIndex.query(now);
	}

	scrollEventRecords(beginning, ending, maximum = Infinity) {
		if (!Number.isFinite(maximum)) {
			return this.scrollIndex.query(beginning, ending);
		}
		maximum = Math.max(1, Math.floor(maximum));
		const records = this.scrollIndex.records.filter(record => !this.scrollIndex.invalidRecords.has(record));
		const first = lowerBound(records, beginning, "start");
		const last = upperBound(records, ending, "start");
		const pending = this.scrollIndex.pendingRecords.filter(
			record => record.start >= beginning && record.start <= ending,
		);
		const count = Math.max(0, last - first) + pending.length;
		const result = [];
		const seen = new Set();
		const append = record => {
			if (!record || seen.has(record)) {
				return;
			}
			seen.add(record);
			result.push(record);
		};
		const baseCount = Math.max(0, last - first);
		const pendingBudget = Math.min(pending.length, maximum);
		const baseBudget = Math.max(0, maximum - pendingBudget);
		if (count <= maximum) {
			for (let index = first; index < last; index += 1) {
				append(records[index]);
			}
		} else {
			for (let sample = 0; sample < baseBudget; sample += 1) {
				const index = first + Math.floor((sample * baseCount) / Math.max(1, baseBudget));
				append(records[index]);
			}
		}
		if (pending.length <= pendingBudget) {
			pending.forEach(append);
		} else {
			for (let sample = 0; sample < pendingBudget; sample += 1) {
				append(pending[Math.floor((sample * pending.length) / pendingBudget)]);
			}
		}
		for (const record of this.scrollDurationIndex.query(beginning)) {
			if (record.start < beginning) {
				append(record);
			}
		}
		for (const id of this.selectedEventIds) {
			const event = this.eventById.get(id);
			const record = event && this.eventRecordMap.get(event);
			if (
				record &&
				event.type !== "group" &&
				this.activeChannelIds.has(event.channel) &&
				MOVABLE_TYPES.has(event.type) &&
				record.start <= ending &&
				record.end >= beginning
			) {
				append(record);
			}
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
		return this.commentIndex
			.query(now)
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
		if (!record) {
			return null;
		}
		const visual = sunniesnowPatternVisualState(record.start, record.end, now);
		return visual ? { ...record, visual } : null;
	}
}

// The tip point guide maintenance and the incremental mutations are large enough to live in
// their own modules; their methods are installed onto the prototype so that callers keep
// seeing one class.
installTraitMembers(ChartRenderIndex.prototype, ChartIndexTipGuidesTrait.prototype);
installTraitMembers(ChartRenderIndex.prototype, ChartIndexMutationsTrait.prototype);
