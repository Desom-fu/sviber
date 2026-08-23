import { Rational } from "../core/rational.js";
import { eventUsesChannel, walkEvents } from "../core/grouping.js";
import {
	MOVABLE_TYPES, NOTE_TYPES, PATTERN_TYPES,
	TIP_POINT_ZOOM_DURATION, buildTipPointGuidesForOrderedEvents,
} from "./stage-helpers.js";
import { refreshDoubleTapTime } from "./double-tap-index.js";
import { IntervalIndex } from "./chart-index.js";

function active(index, event) {
	return event.type === "group"
		? eventUsesChannel(event, index.activeChannelIds)
		: index.activeChannelIds.has(event.channel);
}

function selected(index, event) {
	return Boolean(event?.selected || index.ancestorsById.get(event?.id)?.some(item => item.selected));
}

function rebuildGuides(index, channelId) {
	const records = index.noteEventRecordsByChannel.get(channelId) || [];
	return buildTipPointGuidesForOrderedEvents(records.map(record => record.event), index.timing)
		.map(guide => ({ ...guide, rangeStart: guide.spawnTime,
			rangeEnd: guide.endTime + TIP_POINT_ZOOM_DURATION }));
}

export function removeEventsFromIndex(index, removedEvents) {
	if (index.eventSource !== index.project.events || !Array.isArray(removedEvents) || !removedEvents.length) return false;
	const removed = new Set(removedEvents);
	const oldRecords = index.eventRecords;
	const removedRecords = oldRecords.filter(record => removed.has(record.event));
	if (!removedRecords.length) return false;
	const changedChannels = new Set(removedRecords.filter(record => NOTE_TYPES.has(record.event.type))
		.map(record => record.event.channel));
	const changedDoubleTapTimes = new Set(removedRecords.filter(record => record.event.type === "tap")
		.map(record => Rational.from(record.event.time).toString()));
	index.flatEvents = index.flatEvents.filter(event => !removed.has(event));
	index.leafEvents = index.leafEvents.filter(event => !removed.has(event));
	index.eventRecords = oldRecords.filter(record => !removed.has(record.event));
	index.eventRecordMap = new Map(index.eventRecords.map(record => [record.event, record]));
	index.eventById = new Map(index.eventRecords.map(record => [record.event.id, record.event]));
	index.ancestorsById = new Map();
	walkEvents(index.project.events, (event, ancestors) => index.ancestorsById.set(event.id, ancestors));
	index.selectedRecords = index.eventRecords.filter(record => selected(index, record.event));
	index.selectedEvents = index.selectedRecords.map(record => record.event);
	index.selectedEventIds = new Set(index.selectedEvents.map(event => event.id));
	index.activeEventRecords = index.eventRecords.filter(record => active(index, record.event)
		&& record.event.type !== "comment");
	index.stageSelectedEvents = new Set(index.activeEventRecords
		.filter(record => selected(index, record.event) && record.event.type !== "comment")
		.map(record => record.event));
	index.commentRecords = index.eventRecords.filter(record => record.event.type === "comment");
	index.movableRecords = index.activeEventRecords.filter(record => MOVABLE_TYPES.has(record.event.type)
		&& record.event.type !== "group");
	index.scrollRecords = [...index.movableRecords].sort((left, right) =>
		left.start - right.start || left.sequence - right.sequence);
	index.patternRecords = index.activeEventRecords.filter(record => PATTERN_TYPES.has(record.event.type))
		.sort((left, right) => left.start - right.start || left.sequence - right.sequence);
	index.hitRecords = index.activeEventRecords.filter(record => NOTE_TYPES.has(record.event.type))
		.sort((left, right) => left.start - right.start || left.event.id - right.event.id);
	index.hudHitRecords = index.hitRecords.map(record => ({ ...record,
		hitTime: record.event.type === "hold" ? record.end : record.start }));
	index.holdReleaseRecords = index.activeEventRecords.filter(record => record.event.type === "hold")
		.map(record => ({ ...record, releaseTime: record.end }))
		.sort((left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id);
	index.commentIndex = new IntervalIndex(index.commentRecords, "start", "end");
	index.movableIndex = new IntervalIndex(index.movableRecords, "visibleStart", "visibleEnd");
	index.scrollIndex = new IntervalIndex(index.scrollRecords, "start", "end");
	index.scrollDurationIndex = new IntervalIndex(
		index.movableRecords.filter(record => record.end > record.start), "start", "end");
	index.creationEchoIndex = new IntervalIndex(index.movableRecords, "echoStart", "echoEnd");
	index.timelineIndex = new IntervalIndex(index.eventRecords.filter(record => record.event.type !== "group"), "start", "end");
	index.noteEventRecordsByChannel = new Map((index.project.channels || []).map(channel => [channel.id, []]));
	for (const record of index.eventRecords) {
		if (NOTE_TYPES.has(record.event.type)) index.noteEventRecordsByChannel.get(record.event.channel)?.push(record);
	}
	for (const records of index.noteEventRecordsByChannel.values()) records.sort((left, right) =>
		Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence);
	index.tipGuidesByChannel = new Map(index.project.channels.map(channel => [channel.id,
		changedChannels.has(channel.id) ? rebuildGuides(index, channel.id) : index.tipGuidesByChannel.get(channel.id) || []]));
	index.allTipGuides = index.project.channels.flatMap(channel => index.tipGuidesByChannel.get(channel.id) || []);
	index.allTipGuides.forEach((guide, sequence) => {
		guide.sequence = sequence;
		guide.rangeStart = guide.spawnTime;
		guide.rangeEnd = guide.endTime + TIP_POINT_ZOOM_DURATION;
	});
	index.tipGuides = index.allTipGuides.filter(guide => index.activeChannelIds.has(guide.events[0]?.channel));
	index.timelineTipGuideIndex = new IntervalIndex(index.allTipGuides);
	index.tipGuideIndex = new IntervalIndex(index.tipGuides);
	index.laneEventsByKey = new Map();
	for (const event of index.leafEvents) {
		const key = `${event.channel}:${Rational.from(event.time).toString()}`;
		if (!index.laneEventsByKey.has(key)) index.laneEventsByKey.set(key, []);
		index.laneEventsByKey.get(key).push(event);
	}
	index.eventLaneOffsets = new Map();
	for (const lane of index.laneEventsByKey.values()) lane.forEach((event, position) =>
		index.eventLaneOffsets.set(event.id, (position - (lane.length - 1) / 2) * 7));
	index.tapEventsByTime = new Map();
	for (const event of index.leafEvents) if (active(index, event) && event.type === "tap") {
		const key = Rational.from(event.time).toString();
		if (!index.tapEventsByTime.has(key)) index.tapEventsByTime.set(key, []);
		index.tapEventsByTime.get(key).push(event);
	}
	for (const key of changedDoubleTapTimes) refreshDoubleTapTime(index, key, (event1, event2, sequence) => {
		const first = index.eventRecordMap.get(event1);
		return { event1, event2, sequence, start: first.start,
			rangeStart: first.start - 1 / index.approachSpeed - 0.25,
			rangeEnd: first.start + 1 / 3, position1: first.position,
			position2: index.eventRecordMap.get(event2)?.position };
	});
	index.doubleTapPairsByTime = new Map();
	for (const pair of index.doubleTapPairs) {
		const key = Rational.from(pair.event1.time).toString();
		if (!index.doubleTapPairsByTime.has(key)) index.doubleTapPairsByTime.set(key, []);
		index.doubleTapPairsByTime.get(key).push(pair);
	}
	index.doubleTapIds = new Set(index.doubleTapPairs.flatMap(pair => [pair.event1.id, pair.event2.id]));
	index.maximumTime = index.eventRecords.reduce((maximum, record) => Math.max(maximum, record.end + 10), 10);
	return true;
}

export function removeChannelFromIndex(index, channelId, removedEvents) {
	removeEventsFromIndex(index, removedEvents || []);
	index.tipGuidesByChannel.delete(channelId);
	index.noteEventRecordsByChannel.delete(channelId);
	index.allTipGuides = index.project.channels.flatMap(channel => index.tipGuidesByChannel.get(channel.id) || []);
	index.allTipGuides.forEach((guide, sequence) => { guide.sequence = sequence; });
	index.timelineTipGuideIndex = new IntervalIndex(index.allTipGuides);
	index.tipGuides = index.allTipGuides.filter(guide => index.activeChannelIds.has(guide.events[0]?.channel));
	index.tipGuideIndex = new IntervalIndex(index.tipGuides);
	index.setActiveChannels(index.project.channels);
	return channelId != null;
}
