import { Rational } from "../core/rational.js";
import {
	TIP_POINT_ZOOM_DURATION,
	buildTipPointGuidesForOrderedEvents,
	declaredTipPointSpawnType,
	tipPointSpawnTime,
} from "./stage-helpers.js";
import { IntervalIndex, compareNoteRecords, insertSorted, mergeSorted } from "./interval-index.js";

// Incremental maintenance of the tip point guides held by the chart render index.
//
// A tip point guide chains the events that share one tip point. Because a guide inherits
// its spawn settings from the first event of the chain, inserting or removing a single
// event can reshape the guides around it. These routines therefore work per channel and
// only rebuild the guides that actually changed, which is what keeps editing a large chart
// responsive.

export class ChartIndexTipGuidesTrait {

	_rebuildTipGuideIndexes() {
		this.allTipGuides = this.project.channels.flatMap(item => this.tipGuidesByChannel.get(item.id) || []);
		this.allTipGuides.forEach((guide, sequence) => {
			guide.sequence = sequence;
		});
		this.timelineTipGuideIndex = new IntervalIndex(this.allTipGuides);
		this.tipGuides = this.allTipGuides.filter(guide => this.activeChannelIds.has(guide.events[0]?.channel));
		this.tipGuideIndex = new IntervalIndex(this.tipGuides);
		this.timelineTipRevision += 1;
	}

	_refreshTipGuides(channelId, rebuildIndexes = true) {
		const channel = this.project.channels.find(candidate => candidate.id === channelId);
		if (!channel) {
			return;
		}
		const guides = buildTipPointGuidesForOrderedEvents(
			(this.noteEventRecordsByChannel.get(channelId) || []).map(record => record.event),
			this.timing,
		).map(guide => ({
			...guide,
			rangeStart: guide.spawnTime,
			rangeEnd: guide.endTime + TIP_POINT_ZOOM_DURATION,
		}));
		this.tipGuidesByChannel.set(channelId, guides);
		if (rebuildIndexes) {
			this._rebuildTipGuideIndexes();
		}
	}

	_removeInheritedTipGuideEvents(events, channelId) {
		const guides = this.tipGuidesByChannel.get(channelId) || [];
		const remainingGuides = [];
		for (const guide of guides) {
			const remainingEvents = [];
			const remainingTimes = [];
			for (let index = 0; index < guide.events.length; index += 1) {
				if (events.has(guide.events[index])) {
					continue;
				}
				remainingEvents.push(guide.events[index]);
				remainingTimes.push(guide.eventTimes[index]);
			}
			if (!remainingEvents.length) {
				continue;
			}
			if (remainingEvents.length !== guide.events.length) {
				guide.events = remainingEvents;
				guide.eventTimes = remainingTimes;
				guide.endTime = remainingTimes.at(-1);
				guide.rangeEnd = guide.endTime + TIP_POINT_ZOOM_DURATION;
			}
			remainingGuides.push(guide);
		}
		this.tipGuidesByChannel.set(channelId, remainingGuides);
	}

	_removeInheritedTipGuideEvent(event, channelId) {
		const guides = this.tipGuidesByChannel.get(channelId) || [];
		const guideIndex = guides.findIndex(guide => guide.events.includes(event));
		if (guideIndex < 0) {
			return;
		}
		const guide = guides[guideIndex];
		const eventIndex = guide.events.indexOf(event);
		guide.events.splice(eventIndex, 1);
		guide.eventTimes.splice(eventIndex, 1);
		if (!guide.events.length) {
			guides.splice(guideIndex, 1);
		} else {
			guide.endTime = guide.eventTimes.at(-1);
			guide.rangeEnd = guide.endTime + TIP_POINT_ZOOM_DURATION;
		}
	}

	_addInheritedTipGuideEvents(addedRecords, channelId) {
		const added = new Set(addedRecords);
		const records = this.noteEventRecordsByChannel.get(channelId) || [];
		let guides = this.tipGuidesByChannel.get(channelId) || [];
		const chainGuides = new Map(
			guides.filter(guide => guide.mode === "chain").map(guide => [guide.spawnSettings, guide]),
		);
		const chainAdditions = new Map();
		const dropAdditions = [];
		let mode = "none";
		let settings = null;
		for (const record of records) {
			const event = record.event;
			const declared = TIP_POINT_SPAWN_TYPES.has(event.tipPointSpawnType) ? event.tipPointSpawnType : "inherit";
			if (declared !== "inherit") {
				mode = declared;
				settings = mode === "chain" || mode === "drop" ? event : null;
			} else if (added.has(record) && settings) {
				if (mode === "chain") {
					const guide = chainGuides.get(settings);
					if (guide) {
						if (!chainAdditions.has(guide)) {
							chainAdditions.set(guide, []);
						}
						chainAdditions.get(guide).push(record);
					}
				} else if (mode === "drop") {
					dropAdditions.push({
						mode,
						spawnSettings: settings,
						events: [event],
						eventTimes: [record.start],
						spawnTime: tipPointSpawnTime(event, settings, this.timing),
						endTime: record.start,
						rangeStart: tipPointSpawnTime(event, settings, this.timing),
						rangeEnd: record.start + TIP_POINT_ZOOM_DURATION,
					});
				}
			}
		}
		for (const [guide, additions] of chainAdditions) {
			const existing = guide.events.map(event => this.eventRecordMap.get(event));
			const merged = mergeSorted(existing, additions, compareNoteRecords);
			guide.events = merged.map(record => record.event);
			guide.eventTimes = merged.map(record => record.start);
			guide.endTime = guide.eventTimes.at(-1);
			guide.rangeEnd = guide.endTime + TIP_POINT_ZOOM_DURATION;
		}
		if (dropAdditions.length) {
			const compareGuides = (left, right) => {
				const leftRecord = this.eventRecordMap.get(left.events[0]);
				const rightRecord = this.eventRecordMap.get(right.events[0]);
				return (
					Rational.compare(leftRecord.event.time, rightRecord.event.time) ||
					leftRecord.sequence - rightRecord.sequence
				);
			};
			guides = mergeSorted(guides, dropAdditions, compareGuides);
		}
		this.tipGuidesByChannel.set(channelId, guides);
	}

	_addInheritedTipGuideEvent(record, channelId) {
		const records = this.noteEventRecordsByChannel.get(channelId) || [];
		const recordIndex = records.indexOf(record);
		let mode = "none";
		let settings = null;
		for (let index = recordIndex - 1; index >= 0; index -= 1) {
			const candidate = records[index].event;
			const declared = declaredTipPointSpawnType(candidate);
			if (declared === "inherit") {
				continue;
			}
			mode = declared;
			if (mode === "chain" || mode === "drop") {
				settings = candidate;
			}
			break;
		}
		if (!settings) {
			return;
		}
		const guides = this.tipGuidesByChannel.get(channelId) || [];
		if (mode === "chain") {
			const guide = guides.find(candidate => candidate.mode === "chain" && candidate.spawnSettings === settings);
			if (!guide) {
				return;
			}
			const guideRecords = guide.events.map(event => this.eventRecordMap.get(event));
			insertSorted(guideRecords, record, compareNoteRecords);
			guide.events = guideRecords.map(item => item.event);
			guide.eventTimes = guideRecords.map(item => item.start);
			guide.endTime = guide.eventTimes.at(-1);
			guide.rangeEnd = guide.endTime + TIP_POINT_ZOOM_DURATION;
		} else if (mode === "drop") {
			const spawnTime = tipPointSpawnTime(record.event, settings, this.timing);
			insertSorted(
				guides,
				{
					mode,
					spawnSettings: settings,
					events: [record.event],
					eventTimes: [record.start],
					spawnTime,
					endTime: record.start,
					rangeStart: spawnTime,
					rangeEnd: record.start + TIP_POINT_ZOOM_DURATION,
				},
				(left, right) =>
					compareNoteRecords(
						this.eventRecordMap.get(left.events[0]),
						this.eventRecordMap.get(right.events[0]),
					),
			);
		}
	}

	_appendTipGuideEvent(record) {
		const records = this.noteEventRecordsByChannel.get(record.event.channel);
		if (!records) {
			return;
		}
		let low = 0;
		let high = records.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			const compared = compareNoteRecords(records[middle], record);
			if (compared <= 0) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		records.splice(low, 0, record);
		const declared = declaredTipPointSpawnType(record.event);
		if (declared !== "inherit") {
			this._refreshTipGuides(record.event.channel);
			return;
		}
		let mode = "none";
		let settings = null;
		for (let index = low - 1; index >= 0; index -= 1) {
			const candidate = records[index].event;
			const candidateMode = declaredTipPointSpawnType(candidate);
			if (candidateMode === "inherit") {
				continue;
			}
			mode = candidateMode;
			if (mode === "chain" || mode === "drop") {
				settings = candidate;
			}
			break;
		}
		const channelGuides = this.tipGuidesByChannel.get(record.event.channel) || [];
		const time = record.start;
		if (mode === "chain") {
			const guide = channelGuides.find(
				candidate => candidate.mode === "chain" && candidate.spawnSettings === settings,
			);
			if (guide) {
				let index = 0;
				while (
					index < guide.events.length &&
					(Rational.compare(guide.events[index].time, record.event.time) < 0 ||
						(Rational.compare(guide.events[index].time, record.event.time) === 0 &&
							(this.eventRecordMap.get(guide.events[index])?.sequence ?? 0) < record.sequence))
				) {
					index += 1;
				}
				guide.events.splice(index, 0, record.event);
				guide.eventTimes.splice(index, 0, time);
				guide.endTime = guide.eventTimes.at(-1);
				guide.rangeEnd = guide.endTime + TIP_POINT_ZOOM_DURATION;
			}
		} else if (mode === "drop" && settings) {
			channelGuides.push({
				mode,
				spawnSettings: settings,
				events: [record.event],
				eventTimes: [time],
				spawnTime: tipPointSpawnTime(record.event, settings, this.timing),
				endTime: time,
				rangeStart: tipPointSpawnTime(record.event, settings, this.timing),
				rangeEnd: time + TIP_POINT_ZOOM_DURATION,
			});
		}
		this.tipGuidesByChannel.set(record.event.channel, channelGuides);
		this._rebuildTipGuideIndexes();
	}

}
