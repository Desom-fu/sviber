// Tip point tracks and tip point switches.
//
// A switch is a permutation of channels at a beat. A track T(C) concatenates the
// tip-pointable events of the image of C under the switches that have already elapsed.
// Spawn inheritance follows a track, not a raw channel.

import { Rational } from "./rational.js";
import { TIP_POINTABLE_TYPES } from "./chart-vocabulary.js";

function timeKey(time) {
	const rational = Rational.from(time);
	return `${rational.numerator}/${rational.denominator}`;
}

export function normalizeTipPointSwitches(source, channelId) {
	if (!Array.isArray(source)) {
		return [];
	}
	const seen = new Set();
	const result = [];
	for (const item of source) {
		if (!item || typeof item !== "object") {
			continue;
		}
		let time;
		try {
			time = Rational.from(item.time).toJSON();
		} catch {
			continue;
		}
		const target = Number(item.target);
		if (!Number.isSafeInteger(target) || target === channelId) {
			continue;
		}
		const key = timeKey(time);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push({ time, target });
	}
	result.sort((left, right) => Rational.compare(left.time, right.time));
	return result;
}

export function collectTipPointSwitchTimes(channels) {
	const grouped = new Map();
	for (const channel of channels || []) {
		for (const item of channel.tipPointSwitches || []) {
			const key = timeKey(item.time);
			if (!grouped.has(key)) {
				grouped.set(key, { time: Rational.from(item.time), mapping: new Map() });
			}
			grouped.get(key).mapping.set(channel.id, item.target);
		}
	}
	return [...grouped.values()].sort((left, right) => left.time.compare(right.time));
}

export function hasTipPointSwitches(project) {
	return (project?.channels || []).some(channel => (channel.tipPointSwitches || []).length > 0);
}

export function applySwitchMapping(channelId, mapping) {
	return mapping.has(channelId) ? mapping.get(channelId) : channelId;
}

function isActiveChannel(project, channelId) {
	const channel = (project?.channels || []).find(item => item.id === channelId);
	return Boolean(channel) && channel.active !== false;
}

function inHalfOpenBeatRange(beat, start, end) {
	if (start && beat.compare(start) < 0) {
		return false;
	}
	if (end && beat.compare(end) >= 0) {
		return false;
	}
	return true;
}

export function tipPointTrackEvents(project, startChannelId, events = project?.events) {
	const switches = collectTipPointSwitchTimes(project?.channels);
	const records = (events || [])
		.map((event, sequence) => ({ event, sequence }))
		.filter(({ event }) => TIP_POINTABLE_TYPES.has(event.type));
	const result = [];
	let channelId = startChannelId;
	for (let index = 0; index <= switches.length; index += 1) {
		const start = index === 0 ? null : switches[index - 1].time;
		const end = index === switches.length ? null : switches[index].time;
		if (isActiveChannel(project, channelId)) {
			for (const record of records) {
				if (record.event.channel !== channelId) {
					continue;
				}
				if (inHalfOpenBeatRange(Rational.from(record.event.time), start, end)) {
					result.push(record);
				}
			}
		}
		if (index < switches.length) {
			channelId = applySwitchMapping(channelId, switches[index].mapping);
		}
	}
	result.sort((left, right) => {
		return Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence;
	});
	return result.map(record => record.event);
}

export function allTipPointTracks(project) {
	return (project?.channels || []).map(channel => ({
		startChannelId: channel.id,
		events: tipPointTrackEvents(project, channel.id),
	}));
}

export function startChannelOfTrackContaining(project, event) {
	if (!event || !TIP_POINTABLE_TYPES.has(event.type)) {
		return event?.channel ?? null;
	}
	for (const channel of project?.channels || []) {
		if (tipPointTrackEvents(project, channel.id).includes(event)) {
			return channel.id;
		}
	}
	return event.channel;
}

export function switchedChannelsAt(channels, time) {
	const target = Rational.from(time);
	const changed = [];
	for (const channel of channels || []) {
		for (const item of channel.tipPointSwitches || []) {
			if (Rational.compare(item.time, target) === 0) {
				changed.push({ channel, target: item.target });
			}
		}
	}
	return changed;
}

export function permutationImages(channels, time) {
	const target = Rational.from(time);
	return (channels || []).map(channel => {
		const item = (channel.tipPointSwitches || []).find(entry => Rational.compare(entry.time, target) === 0);
		return item ? item.target : channel.id;
	});
}

export function writeTipPointSwitch(channels, time, images) {
	const beat = Rational.from(time).toJSON();
	(channels || []).forEach((channel, index) => {
		const remaining = (channel.tipPointSwitches || []).filter(item => Rational.compare(item.time, time) !== 0);
		const image = images[index];
		if (Number.isSafeInteger(image) && image !== channel.id) {
			remaining.push({ time: beat, target: image });
		}
		channel.tipPointSwitches = remaining.sort((left, right) => Rational.compare(left.time, right.time));
	});
}

export function clearTipPointSwitch(channels, time) {
	writeTipPointSwitch(
		channels,
		time,
		(channels || []).map(channel => channel.id),
	);
}

function uniqueSortedTimes(tracks) {
	const keys = new Map();
	for (const track of tracks) {
		for (const event of track.events) {
			const beat = Rational.from(event.time);
			keys.set(timeKey(beat), beat);
		}
	}
	return [...keys.values()].sort((left, right) => left.compare(right));
}

function permutationFromAssignment(previous, next, channelCount) {
	const occupant = Array(channelCount).fill(null);
	previous.forEach((channelIndex, trackIndex) => {
		occupant[channelIndex] = trackIndex;
	});
	return occupant.map((trackIndex, channelIndex) => {
		return trackIndex == null ? channelIndex : next[trackIndex];
	});
}

function writeAssignmentSwitch(model, time, previous, next) {
	const images = permutationFromAssignment(previous, next, model.channels.length);
	if (images.every((image, index) => image === index)) {
		return;
	}
	writeTipPointSwitch(
		model.channels,
		time,
		images.map(index => model.channels[index].id),
	);
}

// Place constructed tracks into channels and insert switches so simultaneous events keep
// the source stacking order (earlier in the original event list sits in a higher channel).
export function packTracksIntoChannels(model, tracks) {
	while (model.channels.length < tracks.length) {
		model.addChannel(model.channels.length);
	}
	tracks.forEach((track, index) => {
		const channelId = model.channels[index].id;
		for (const event of track.events) {
			event.channel = channelId;
		}
	});
	let assignment = tracks.map((_, index) => index);
	for (const time of uniqueSortedTimes(tracks)) {
		const present = tracks
			.map((track, index) => {
				const sequences = track.events
					.filter(event => Rational.compare(event.time, time) === 0)
					.map(event => Number(event._importSequence ?? event.id ?? 0));
				if (!sequences.length) {
					return null;
				}
				return { index, sequence: Math.min(...sequences) };
			})
			.filter(Boolean)
			.sort((left, right) => left.sequence - right.sequence || left.index - right.index);
		if (present.length < 2) {
			continue;
		}
		const slots = present.map(item => assignment[item.index]).sort((left, right) => left - right);
		const next = assignment.slice();
		present.forEach((item, order) => {
			next[item.index] = slots[order];
		});
		if (next.some((value, index) => value !== assignment[index])) {
			writeAssignmentSwitch(model, time, assignment, next);
			assignment = next;
			tracks.forEach((track, trackIndex) => {
				const channelId = model.channels[assignment[trackIndex]].id;
				for (const event of track.events) {
					if (Rational.compare(event.time, time) >= 0) {
						event.channel = channelId;
					}
				}
			});
		}
	}
	for (const track of tracks) {
		for (const event of track.events) {
			delete event._importSequence;
		}
	}
}

export function allocateTrackIndex(tracks, beginning, ending) {
	const start = Rational.from(beginning);
	const end = Rational.from(ending);
	const free = tracks.findIndex(track => {
		if (!track.events.length) {
			return true;
		}
		const times = track.events.map(event => Rational.from(event.time));
		let occupiedStart = times[0];
		let occupiedEnd = times[0];
		for (const time of times.slice(1)) {
			if (time.compare(occupiedStart) < 0) {
				occupiedStart = time;
			}
			if (time.compare(occupiedEnd) > 0) {
				occupiedEnd = time;
			}
		}
		return end.compare(occupiedStart) < 0 || start.compare(occupiedEnd) > 0;
	});
	if (free >= 0) {
		return free;
	}
	tracks.push({ events: [] });
	return tracks.length - 1;
}
