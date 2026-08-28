import { Rational } from "../core/rational.js";
import {
	MOVABLE_TYPES,
	NOTE_TYPES,
	PATTERN_TYPES,
	declaredTipPointSpawnType,
} from "./stage-helpers.js";
import { refreshDoubleTapTime } from "./double-tap-index.js";
import { IntervalIndex, compareNoteRecords, insertSorted, mergeSorted } from "./interval-index.js";

// Incremental mutations of the chart render index.
//
// Rebuilding the whole index after every edit is too slow for large charts, so each edit
// splices the affected records out of the sorted arrays and interval indexes and puts the
// updated ones back. Every method here falls back to reporting failure when the edit is
// wider than it can handle, and the caller then rebuilds the index from scratch.

// Comparators of the sorted arrays the index keeps. Records are ordered by the key a query
// binary searches on, with the event sequence or id as the tie breaker so that the order is
// stable across rebuilds.
const BY_SEQUENCE = (left, right) => left.sequence - right.sequence;
const BY_START_THEN_SEQUENCE = (left, right) => left.start - right.start || left.sequence - right.sequence;
const BY_START_THEN_ID = (left, right) => left.start - right.start || left.event.id - right.event.id;
const BY_HIT_TIME = (left, right) => left.hitTime - right.hitTime || left.event.id - right.event.id;
const BY_RELEASE_TIME = (left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id;

function replaceInArray(items, oldItem, newItem) {
	const index = items.indexOf(oldItem);
	if (index >= 0) {
		items[index] = newItem;
	}
	return index;
}

function removeFromArray(items, item) {
	const index = items.indexOf(item);
	if (index >= 0) {
		items.splice(index, 1);
	}
	return index;
}

// Swaps a record inside an array that is ordered by sequence, adding or dropping it when the
// replacement changed whether it belongs there at all.
function replaceOrInsert(records, oldRecord, newRecord, include) {
	const index = records.indexOf(oldRecord);
	if (!include) {
		if (index >= 0) {
			records.splice(index, 1);
		}
		return;
	}
	if (index >= 0) {
		records[index] = newRecord;
		return;
	}
	insertSorted(records, newRecord, BY_SEQUENCE);
}

// Same, for arrays ordered by an arbitrary key: an in place swap is only valid while the key
// did not change, otherwise the record is removed and reinserted at its new position.
function replaceSorted(records, oldRecord, newRecord, include, compare) {
	const index = records.indexOf(oldRecord);
	if (index >= 0 && include && compare(records[index], newRecord) === 0) {
		records[index] = newRecord;
		return;
	}
	if (index >= 0) {
		records.splice(index, 1);
	}
	if (include) {
		insertSorted(records, newRecord, compare);
	}
}

// The head-up display and hold release arrays hold copies of a record rather than the record
// itself, so they are addressed through the event.
function removeDerivedRecord(records, event) {
	const existing = records.find(record => record.event === event);
	if (existing) {
		records.splice(records.indexOf(existing), 1);
	}
}

// Every role an event can play in the derived arrays, before and after the replacement.
function eventRoleFlags(index, { oldEvent, newEvent }) {
	const oldActive = index._isActive(oldEvent) && oldEvent.type !== "comment";
	const newActive = index._isActive(newEvent) && newEvent.type !== "comment";
	const movable = (active, event) => active && MOVABLE_TYPES.has(event.type) && event.type !== "group";
	return {
		oldActive,
		newActive,
		oldComment: oldEvent.type === "comment",
		newComment: newEvent.type === "comment",
		oldMovable: movable(oldActive, oldEvent),
		newMovable: movable(newActive, newEvent),
		oldNote: oldActive && NOTE_TYPES.has(oldEvent.type),
		newNote: newActive && NOTE_TYPES.has(newEvent.type),
		oldTap: oldActive && oldEvent.type === "tap",
		newTap: newActive && newEvent.type === "tap",
	};
}

// Points existing guides at the replacement instead of recomputing the chain.
function repointTipGuides(guides, oldEvent, newEvent) {
	for (const guide of guides) {
		for (let index = 0; index < guide.events.length; index += 1) {
			if (guide.events[index] === oldEvent) {
				guide.events[index] = newEvent;
			}
		}
		if (guide.spawnSettings === oldEvent) {
			guide.spawnSettings = newEvent;
		}
	}
}

export class ChartIndexMutationsTrait {

	// Moving events between channels keeps the index alive as long as the move does not cross
	// the active/inactive boundary: the lane bookkeeping, the per channel note lists and the
	// tip point guides are patched in place. Returns false when the caller has to rebuild.
	moveEventsToChannels(changes) {
		if (this.eventSource !== this.project.events || !Array.isArray(changes) || !changes.length) {
			return false;
		}
		const normalized = this._normalizeChannelChanges(changes);
		if (!normalized) {
			return false;
		}
		const plan = this._channelChangeGuidePlan(normalized);
		this._detachTipGuidesForMove(plan);
		const moved = this._moveLaneEntries(normalized);
		this._moveNoteRecords(plan, moved);
		this._refreshLaneOffsets(moved.touchedLanes);
		this._attachTipGuidesForMove(plan);
		for (const channelId of plan.fullGuideChannels) {
			this._refreshTipGuides(channelId, false);
		}
		if (plan.noteChanges.length) {
			this._rebuildTipGuideIndexes();
			this._buildDoubleTapIndexes();
		} else {
			this.timelineTipRevision += 1;
		}
		return true;
	}

	// Resolves every change to its record. A change is only patchable when the event already
	// carries its new channel and when the move stays on one side of the active boundary.
	_normalizeChannelChanges(changes) {
		const normalized = changes.map(change => ({
			record: this.eventRecordMap.get(change.event),
			event: change.event,
			from: change.from,
			to: change.to,
		}));
		const patchable = normalized.every(
			change =>
				change.record &&
				change.event.channel === change.to &&
				this.activeChannelIds.has(change.from) === this.activeChannelIds.has(change.to),
		);
		return patchable ? normalized : null;
	}

	// Events that declare their own tip point spawn mode reshape every guide of the channels
	// they leave and enter, so those channels are rebuilt wholesale. A handful of purely
	// inheriting notes is cheaper to patch guide by guide.
	_channelChangeGuidePlan(normalized) {
		const noteChanges = normalized.filter(change => NOTE_TYPES.has(change.event.type));
		const fullGuideChannels = new Set();
		for (const change of noteChanges) {
			if (declaredTipPointSpawnType(change.event) === "inherit") {
				continue;
			}
			fullGuideChannels.add(change.from);
			fullGuideChannels.add(change.to);
		}
		const localGuideUpdate = fullGuideChannels.size === 0 && noteChanges.length <= 4;
		return { normalized, noteChanges, fullGuideChannels, localGuideUpdate };
	}

	_detachTipGuidesForMove({ noteChanges, fullGuideChannels, localGuideUpdate }) {
		if (localGuideUpdate) {
			for (const change of noteChanges) {
				this._removeInheritedTipGuideEvent(change.event, change.from);
			}
			return;
		}
		const removals = new Map();
		for (const change of noteChanges) {
			if (fullGuideChannels.has(change.from)) {
				continue;
			}
			if (!removals.has(change.from)) {
				removals.set(change.from, new Set());
			}
			removals.get(change.from).add(change.event);
		}
		for (const [channelId, events] of removals) {
			this._removeInheritedTipGuideEvents(events, channelId);
		}
	}

	_attachTipGuidesForMove({ noteChanges, fullGuideChannels, localGuideUpdate }) {
		if (localGuideUpdate) {
			for (const change of noteChanges) {
				this._addInheritedTipGuideEvent(change.record, change.to);
			}
			return;
		}
		const additions = new Map();
		for (const change of noteChanges) {
			if (fullGuideChannels.has(change.to)) {
				continue;
			}
			if (!additions.has(change.to)) {
				additions.set(change.to, []);
			}
			additions.get(change.to).push(change.record);
		}
		for (const [channelId, records] of additions) {
			this._addInheritedTipGuideEvents(records, channelId);
		}
	}

	// Lanes group the events that share a channel and a beat; the timeline stacks them and
	// the double lines of v17 follow their order.
	_moveLaneEntries(normalized) {
		const touchedLanes = new Set();
		const outgoingRecords = new Map();
		const incomingRecords = new Map();
		for (const { event, record, from, to } of normalized) {
			const time = Rational.from(event.time).toString();
			const oldLaneKey = `${from}:${time}`;
			const newLaneKey = `${to}:${time}`;
			const oldLane = this.laneEventsByKey.get(oldLaneKey) || [];
			const oldLaneIndex = oldLane.indexOf(event);
			if (oldLaneIndex >= 0) {
				oldLane.splice(oldLaneIndex, 1);
			}
			const newLane = this.laneEventsByKey.get(newLaneKey) || [];
			insertSorted(newLane, event, (left, right) => this._laneSequence(left) - this._laneSequence(right));
			this.laneEventsByKey.set(newLaneKey, newLane);
			touchedLanes.add(oldLaneKey);
			touchedLanes.add(newLaneKey);
			if (!NOTE_TYPES.has(event.type)) {
				continue;
			}
			if (!outgoingRecords.has(from)) {
				outgoingRecords.set(from, new Set());
			}
			if (!incomingRecords.has(to)) {
				incomingRecords.set(to, []);
			}
			outgoingRecords.get(from).add(record);
			incomingRecords.get(to).push(record);
		}
		return { touchedLanes, outgoingRecords, incomingRecords };
	}

	_laneSequence(event) {
		return this.eventRecordMap.get(event)?.sequence ?? 0;
	}

	// Per channel note lists stay sorted by beat. A small move splices each record across,
	// a large one filters the leavers out and merges the arrivals back in one pass.
	_moveNoteRecords({ noteChanges, localGuideUpdate }, { outgoingRecords, incomingRecords }) {
		if (localGuideUpdate) {
			for (const change of noteChanges) {
				const oldRecords = this.noteEventRecordsByChannel.get(change.from) || [];
				const oldIndex = oldRecords.indexOf(change.record);
				if (oldIndex >= 0) {
					oldRecords.splice(oldIndex, 1);
				}
				const newRecords = this.noteEventRecordsByChannel.get(change.to) || [];
				insertSorted(newRecords, change.record, compareNoteRecords);
				this.noteEventRecordsByChannel.set(change.to, newRecords);
			}
			return;
		}
		for (const channelId of new Set([...outgoingRecords.keys(), ...incomingRecords.keys()])) {
			const outgoing = outgoingRecords.get(channelId) || new Set();
			const remaining = (this.noteEventRecordsByChannel.get(channelId) || []).filter(
				record => !outgoing.has(record),
			);
			const incoming = (incomingRecords.get(channelId) || []).sort(compareNoteRecords);
			this.noteEventRecordsByChannel.set(channelId, mergeSorted(remaining, incoming, compareNoteRecords));
		}
	}

	// Events sharing a lane are fanned out symmetrically around the lane centre line.
	_refreshLaneOffsets(touchedLanes) {
		for (const key of touchedLanes) {
			const lane = this.laneEventsByKey.get(key) || [];
			if (!lane.length) {
				this.laneEventsByKey.delete(key);
			}
			lane.forEach((event, index) => this.eventLaneOffsets.set(event.id, (index - (lane.length - 1) / 2) * 7));
		}
	}

	// Replacing an event (a type change, an edited field) keeps every derived array alive by
	// swapping the old record for the new one wherever it appears, and by moving it when the
	// replacement changed the key it is sorted by.
	_replaceEventsIncremental(replacements) {
		const touchedLaneKeys = new Set();
		const changedDoubleTapTimes = new Set();
		let tipGuidesChanged = false;
		for (const change of replacements) {
			change.newRecord = this._replaceEventIdentity(change);
			touchedLaneKeys.add(this._replaceEventInLane(change));
			this._replaceEventInSelection(change);
			const flags = eventRoleFlags(this, change);
			this._replaceEventInRecordArrays(change, flags);
			this._replaceEventInPlaybackArrays(change, flags);
			this._replaceEventInIntervalIndexes(change, flags);
			if (this._replaceEventInNoteChannel(change, flags)) {
				tipGuidesChanged = true;
			}
			const tapKey = this._replaceEventInTapOrder(change, flags);
			if (tapKey) {
				changedDoubleTapTimes.add(tapKey);
			}
		}
		this._refreshLaneOffsets(touchedLaneKeys);
		for (const key of changedDoubleTapTimes) {
			refreshDoubleTapTime(this, key, (event1, event2, sequence) =>
				this._doubleTapRecord(event1, event2, sequence),
			);
		}
		if (tipGuidesChanged) {
			this._rebuildTipGuideIndexes();
		}
		this._recomputeMaximumTime(replacements);
		return true;
	}

	// The identity maps: the record arrays and lookup tables that address an event directly.
	_replaceEventIdentity({ oldEvent, newEvent, oldRecord }) {
		const newRecord = this._eventRecord(newEvent, oldRecord.sequence);
		replaceInArray(this.eventRecords, oldRecord, newRecord);
		replaceInArray(this.flatEvents, oldEvent, newEvent);
		replaceInArray(this.leafEvents, oldEvent, newEvent);
		this.eventById.set(newEvent.id, newEvent);
		this.eventRecordMap.delete(oldEvent);
		this.eventRecordMap.set(newEvent, newRecord);
		return newRecord;
	}

	// The replacement keeps the beat and channel of the original, so it stays in the same
	// lane; only the identity of the entry changes.
	_replaceEventInLane({ oldEvent, newEvent }) {
		const laneKey = `${newEvent.channel}:${Rational.from(newEvent.time).toString()}`;
		const lane = this.laneEventsByKey.get(laneKey) || [];
		const laneIndex = lane.indexOf(oldEvent);
		if (laneIndex >= 0) {
			lane[laneIndex] = newEvent;
		} else {
			lane.push(newEvent);
		}
		this.laneEventsByKey.set(laneKey, lane);
		return laneKey;
	}

	_replaceEventInSelection({ oldEvent, newEvent, oldRecord, newRecord }) {
		replaceInArray(this.selectedEvents, oldEvent, newEvent);
		replaceInArray(this.selectedRecords, oldRecord, newRecord);
		if (this.stageSelectedEvents.delete(oldEvent)) {
			this.stageSelectedEvents.add(newEvent);
		}
	}

	// Arrays whose membership depends on the type of the event: a note turned into a comment
	// leaves the movable records and joins the comment records.
	_replaceEventInRecordArrays({ newEvent, oldRecord, newRecord }, flags) {
		replaceOrInsert(this.activeEventRecords, oldRecord, newRecord, flags.newActive);
		replaceOrInsert(this.commentRecords, oldRecord, newRecord, flags.newComment);
		replaceSorted(this.movableRecords, oldRecord, newRecord, flags.newMovable, BY_SEQUENCE);
		replaceSorted(this.scrollRecords, oldRecord, newRecord, flags.newMovable, BY_START_THEN_SEQUENCE);
		const pattern = flags.newActive && PATTERN_TYPES.has(newEvent.type);
		replaceSorted(this.patternRecords, oldRecord, newRecord, pattern, BY_START_THEN_SEQUENCE);
	}

	// Playback arrays are keyed by wall-clock time rather than by sequence, and the head-up
	// display and hold release entries are derived records rather than the record itself.
	_replaceEventInPlaybackArrays({ oldEvent, newEvent, oldRecord, newRecord }, flags) {
		replaceSorted(this.hitRecords, oldRecord, newRecord, flags.newNote, BY_START_THEN_ID);
		const bgNote = flags.newActive && newEvent.type === "bgNote";
		replaceSorted(this.bgNoteHitRecords, oldRecord, newRecord, bgNote, BY_START_THEN_ID);
		removeDerivedRecord(this.hudHitRecords, oldEvent);
		if (flags.newNote) {
			const hitTime = newEvent.type === "hold" ? newRecord.end : newRecord.start;
			insertSorted(this.hudHitRecords, { ...newRecord, hitTime }, BY_HIT_TIME);
		}
		removeDerivedRecord(this.holdReleaseRecords, oldEvent);
		if (flags.newNote && newEvent.type === "hold") {
			const release = { ...newRecord, releaseTime: newRecord.end };
			insertSorted(this.holdReleaseRecords, release, BY_RELEASE_TIME);
		}
	}

	_replaceEventInIntervalIndexes({ oldEvent, newEvent, oldRecord, newRecord }, flags) {
		const apply = (index, oldIncluded, newIncluded) => {
			if (oldIncluded && newIncluded) {
				return index.replace(oldRecord, newRecord);
			}
			if (oldIncluded) {
				return index.remove(oldRecord);
			}
			if (newIncluded) {
				return index.add(newRecord);
			}
			return false;
		};
		apply(this.commentIndex, flags.oldComment, flags.newComment);
		apply(this.movableIndex, flags.oldMovable, flags.newMovable);
		apply(this.scrollIndex, flags.oldMovable, flags.newMovable);
		apply(
			this.scrollDurationIndex,
			flags.oldMovable && oldRecord.end > oldRecord.start,
			flags.newMovable && newRecord.end > newRecord.start,
		);
		apply(this.creationEchoIndex, flags.oldMovable, flags.newMovable);
		apply(this.timelineIndex, oldEvent.type !== "group", newEvent.type !== "group");
	}

	// Returns true when the tip point guides of the channel had to be rebuilt, which happens
	// only when the event entered or left the set of notes. Otherwise the existing guides are
	// repointed at the replacement.
	_replaceEventInNoteChannel({ oldEvent, newEvent, oldRecord, newRecord }, flags) {
		const noteRecords = this.noteEventRecordsByChannel.get(newEvent.channel) || [];
		if (flags.oldNote && flags.newNote) {
			replaceInArray(noteRecords, oldRecord, newRecord);
		} else if (flags.oldNote) {
			removeFromArray(noteRecords, oldRecord);
		} else if (flags.newNote) {
			insertSorted(noteRecords, newRecord, compareNoteRecords);
		}
		this.noteEventRecordsByChannel.set(newEvent.channel, noteRecords);
		if (flags.oldNote !== flags.newNote) {
			this._refreshTipGuides(newEvent.channel, false);
			return true;
		}
		if (flags.newNote) {
			repointTipGuides(this.tipGuidesByChannel.get(newEvent.channel) || [], oldEvent, newEvent);
		}
		return false;
	}

	// Simultaneous taps are kept in drawing order so that the double lines of v17 connect the
	// same pairs the playfield draws. Returns the beat whose pairs need recomputing.
	_replaceEventInTapOrder({ oldEvent, newEvent }, flags) {
		if (!flags.oldTap && !flags.newTap) {
			return null;
		}
		const key = Rational.from(newEvent.time).toString();
		const taps = this.tapEventsByTime.get(key) || [];
		removeFromArray(taps, oldEvent);
		if (flags.newTap) {
			let insertAt = 0;
			while (insertAt < taps.length && this.compareTapOrder(taps[insertAt], newEvent) < 0) {
				insertAt += 1;
			}
			taps.splice(insertAt, 0, newEvent);
		}
		if (taps.length) {
			this.tapEventsByTime.set(key, taps);
		} else {
			this.tapEventsByTime.delete(key);
		}
		return key;
	}

	// Shrinking the chart is the only case that needs a full scan; growing it does not.
	_recomputeMaximumTime(replacements) {
		if (replacements.some(change => change.oldRecord.end + 10 >= this.maximumTime)) {
			this.maximumTime = this.eventRecords.reduce((maximum, record) => Math.max(maximum, record.end + 10), 10);
			return;
		}
		for (const change of replacements) {
			this.maximumTime = Math.max(this.maximumTime, change.newRecord.end + 10);
		}
	}

	replaceEvents(changes) {
		if (this.eventSource !== this.project.events || !Array.isArray(changes) || !changes.length) {
			return false;
		}
		const replacements = changes.map(change => ({
			oldEvent: change.oldEvent,
			newEvent: change.newEvent,
			oldRecord: this.eventRecordMap.get(change.oldEvent),
		}));
		if (
			replacements.some(
				change => !change.oldRecord || !change.newEvent || change.oldEvent.id !== change.newEvent.id,
			)
		) {
			return false;
		}
		if (
			replacements.every(
				change =>
					change.oldEvent.channel === change.newEvent.channel &&
					Rational.from(change.oldEvent.time).compare(Rational.from(change.newEvent.time)) === 0,
			)
		) {
			return this._replaceEventsIncremental(replacements);
		}
		return false;
	}

	appendRootEvent(event) {
		if (!event || this.eventSource !== this.project.events || this.eventById.has(event.id)) {
			return false;
		}
		const sequence = this.eventRecords.length;
		this.flatEvents.push(event);
		this.leafEvents.push(event);
		this.ancestorsById.set(event.id, []);
		const record = this._eventRecord(event, sequence);
		this.eventRecords.push(record);
		this.eventById.set(event.id, event);
		this.timelineIndex.add(record);
		const active = this._isActive(event) && event.type !== "comment";
		if (active) {
			this.activeEventRecords.push(record);
		}
		if (event.type === "comment") {
			this.commentRecords.push(record);
			this.commentIndex.add(record);
		}
		if (active && MOVABLE_TYPES.has(event.type) && event.type !== "group") {
			this.movableRecords.push(record);
			insertSorted(
				this.scrollRecords,
				record,
				(left, right) => left.start - right.start || left.sequence - right.sequence,
			);
			this.movableIndex.add(record);
			this.scrollIndex.add(record);
			if (record.end > record.start) {
				this.scrollDurationIndex.add(record);
			}
			this.creationEchoIndex.add(record);
		}
		const laneKey = `${event.channel}:${Rational.from(event.time).toString()}`;
		const lane = this.laneEventsByKey.get(laneKey) || [];
		lane.push(event);
		this.laneEventsByKey.set(laneKey, lane);
		lane.forEach((candidate, index) =>
			this.eventLaneOffsets.set(candidate.id, (index - (lane.length - 1) / 2) * 7),
		);
		if (active && NOTE_TYPES.has(event.type)) {
			insertSorted(
				this.hitRecords,
				record,
				(left, right) => left.start - right.start || left.event.id - right.event.id,
			);
			const hud = { ...record, hitTime: event.type === "hold" ? record.end : record.start };
			insertSorted(
				this.hudHitRecords,
				hud,
				(left, right) => left.hitTime - right.hitTime || left.event.id - right.event.id,
			);
			this._appendTipGuideEvent(record);
		}
		if (active && event.type === "hold") {
			const release = { ...record, releaseTime: record.end };
			insertSorted(
				this.holdReleaseRecords,
				release,
				(left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id,
			);
		}
		if (active && event.type === "bgNote") {
			insertSorted(
				this.bgNoteHitRecords,
				record,
				(left, right) => left.start - right.start || left.event.id - right.event.id,
			);
		}
		if (active && event.type === "tap") {
			const key = Rational.from(event.time).toString();
			const taps = this.tapEventsByTime.get(key) || [];
			let insertAt = 0;
			while (insertAt < taps.length && this.compareTapOrder(taps[insertAt], event) < 0) {
				insertAt += 1;
			}
			taps.splice(insertAt, 0, event);
			this.tapEventsByTime.set(key, taps);
			refreshDoubleTapTime(this, key, (event1, event2, sequence) =>
				this._doubleTapRecord(event1, event2, sequence),
			);
		}
		this.maximumTime = Math.max(this.maximumTime, record.end + 10);
		return true;
	}

	setActiveChannels(channels) {
		const next = new Set((channels || []).filter(channel => channel.active !== false).map(channel => channel.id));
		if (next.size === this.activeChannelIds.size && [...next].every(id => this.activeChannelIds.has(id))) {
			return false;
		}
		this.activeChannelIds = next;
		this.selectedRecords = this.eventRecords.filter(record => this.isEventSelected(record.event));
		this.selectedEvents = this.selectedRecords.map(record => record.event);
		this.selectedEventIds = new Set(this.selectedEvents.map(event => event.id));
		this.activeEventRecords = this.eventRecords.filter(
			record => this._isActive(record.event) && record.event.type !== "comment",
		);
		this.stageSelectedEvents = new Set(
			this.activeEventRecords.filter(record => this.isEventSelected(record.event)).map(record => record.event),
		);
		this.movableRecords = this.activeEventRecords.filter(
			record => MOVABLE_TYPES.has(record.event.type) && record.event.type !== "group",
		);
		this.scrollRecords = [...this.movableRecords].sort(
			(left, right) => left.start - right.start || left.sequence - right.sequence,
		);
		this.patternRecords = this.activeEventRecords
			.filter(record => PATTERN_TYPES.has(record.event.type))
			.sort((left, right) => left.start - right.start || left.sequence - right.sequence);
		this.hitRecords = this.activeEventRecords
			.filter(record => NOTE_TYPES.has(record.event.type))
			.sort((left, right) => left.start - right.start || left.event.id - right.event.id);
		this.bgNoteHitRecords = this.activeEventRecords
			.filter(record => record.event.type === "bgNote")
			.sort((left, right) => left.start - right.start || left.event.id - right.event.id);
		this.hudHitRecords = this.hitRecords.map(record => ({
			...record,
			hitTime: record.event.type === "hold" ? record.end : record.start,
		}));
		this.holdReleaseRecords = this.activeEventRecords
			.filter(record => record.event.type === "hold")
			.map(record => ({ ...record, releaseTime: record.end }))
			.sort((left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id);
		this.movableIndex = new IntervalIndex(this.movableRecords, "visibleStart", "visibleEnd");
		this.scrollIndex = new IntervalIndex(this.scrollRecords, "start", "end");
		this.scrollDurationIndex = new IntervalIndex(
			this.movableRecords.filter(record => record.end > record.start),
			"start",
			"end",
		);
		this.creationEchoIndex = new IntervalIndex(this.movableRecords, "echoStart", "echoEnd");
		this.tipGuides = this.allTipGuides.filter(guide => this.activeChannelIds.has(guide.events[0]?.channel));
		this.tipGuideIndex = new IntervalIndex(this.tipGuides);
		const activeEvents = this.leafEvents.filter(event => this.activeChannelIds.has(event.channel));
		this.doubleTapPairs = this._doubleTapPairs(activeEvents);
		this.doubleTapIds = new Set(this.doubleTapPairs.flatMap(pair => [pair.event1.id, pair.event2.id]));
		this.doubleTapIndex = new IntervalIndex(this.doubleTapPairs);
		this.channelOrder = new Map((this.project.channels || []).map((channel, index) => [channel.id, index]));
		this.tapEventsByTime = new Map();
		for (const event of activeEvents) {
			if (event.type === "tap") {
				const key = Rational.from(event.time).toString();
				if (!this.tapEventsByTime.has(key)) {
					this.tapEventsByTime.set(key, []);
				}
				this.tapEventsByTime.get(key).push(event);
			}
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
		return true;
	}

}
