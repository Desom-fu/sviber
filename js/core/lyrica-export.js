// sviber chart state to Lyrica chart text.
//
// Exporting is harder than importing because Lyrica's tip points are channel-bound: a note
// carries a spawn code, not a spawn position, and two trails may not share a channel while
// they overlap in time. So the export first reconstructs the chart's trails
// (`resolveSviberTipChains`), then packs them onto the multi-tip channels
// (`assignLyricaExportChannels`), and only then emits one row per event, choosing for each
// trail's first note the deterministic spawn code that lands closest to sviber's own spawn
// point.
//
// Split out of js/core/lyrica.js.

import { Rational } from "./rational.js";
import { TimingMap } from "./timing.js";
import { resolveAttachedPosition } from "./geometry.js";
import {
	LYRICA_BG_NOTE_CHANNELS,
	LYRICA_BG_PATTERN_CHANNEL,
	LYRICA_BG_PATTERN_CODES,
	LYRICA_BPM_CHANNEL,
	LYRICA_INDEPENDENT_CHANNEL,
	LYRICA_MAIN_CHANNEL,
	LYRICA_MULTI_TIP_CHANNELS,
	LYRICA_NO_TIP_CHANNELS,
	serializeLyricaChart,
	sviberFlickAngleToLyrica,
} from "./lyrica-format.js";
import { chooseClosestNonRandomSpawn } from "./lyrica-spawn.js";

const NOTE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
const PATTERN_TYPES = new Set([
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
]);

function flattenEvents(items, includeGroups = false) {
	const result = [];
	const visit = event => {
		if (event.type === "group") {
			if (includeGroups) {
				result.push(event);
			}
			for (const child of event.events || []) {
				visit(child);
			}
			return;
		}
		result.push(event);
	};
	for (const event of items || []) {
		visit(event);
	}
	return result;
}

// A chart may arrive as a live ChartModel or as plain serialized state.
function chartNotes(model) {
	if (typeof model.allEvents === "function") {
		return model.allEvents({ includeGroups: false });
	}
	return flattenEvents(model.events || []);
}

// Replays sviber's per-note spawn modes to recover the trails a chart contains: a `chain`
// gathers the notes that inherit from it, a `drop` is a trail of one, and a `none` clears the
// settings a later `inherit` would otherwise reuse.
export function resolveSviberTipChains(model) {
	const events = chartNotes(model);
	const channels = model.channels || [];
	const guides = [];
	for (const channel of channels) {
		const notes = events
			.map((event, sequence) => ({ event, sequence }))
			.filter(({ event }) => NOTE_TYPES.has(event.type) && event.channel === channel.id)
			.sort(
				(left, right) => Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence,
			);
		let previousMode = "none";
		let previousSettings = null;
		let active = null;
		for (const { event } of notes) {
			const declared = event.tipPointSpawnType || "inherit";
			const effective = declared === "inherit" ? previousMode : declared;
			if (effective === "chain") {
				if (declared === "chain" || !active) {
					previousSettings = event;
					active = { mode: "chain", spawnSettings: event, events: [] };
					guides.push(active);
				}
				active.events.push(event);
			} else if (effective === "drop") {
				if (declared === "drop" || !previousSettings) {
					previousSettings = event;
				}
				guides.push({ mode: "drop", spawnSettings: previousSettings, events: [event] });
				active = null;
			} else {
				active = null;
				if (effective === "none") {
					previousSettings = null;
				}
			}
			previousMode = effective;
			if (declared === "chain" || declared === "drop") {
				previousSettings = event;
			}
			if (declared === "none") {
				previousMode = "none";
				previousSettings = null;
			}
		}
	}
	return guides.filter(guide => guide.events.length);
}

function eventPosition(event, snappees = []) {
	return (
		resolveAttachedPosition(event, snappees) || {
			x: Number(event.x) || 0,
			y: Number(event.y) || 0,
		}
	);
}

function eventSeconds(timing, event) {
	try {
		return timing.beatToSeconds(event.time);
	} catch {
		return 0;
	}
}

function eventDurationSeconds(timing, event) {
	if (!event.duration) {
		return 0;
	}
	try {
		return Math.max(0, timing.durationToSeconds(event.time, event.duration));
	} catch {
		return 0;
	}
}

// A spawn lead time is stored either as a rational number of beats before the note or as
// plain seconds; both resolve to an absolute time in seconds here.
function spawnSeconds(event, spawnSettings, timing) {
	if (spawnSettings.tipPointSpawnTimeBeats) {
		const beat = Rational.from(event.time).sub(spawnSettings.tipPointSpawnTime || 0);
		return timing.beatToSeconds(beat);
	}
	return timing.beatToSeconds(event.time) - Math.max(0, Number(spawnSettings.tipPointSpawnTime) || 0);
}

function spawnPositionOf(event, spawnSettings, snappees, timing) {
	const seconds = spawnSeconds(event, spawnSettings, timing);
	if (!spawnSettings.tipPointSpawnAbsolutePosition) {
		const target = eventPosition(event, snappees);
		const distance = Math.max(0, Number(spawnSettings.tipPointSpawnDistance) || 0);
		let angle = Math.PI / 2;
		if (Number.isFinite(Number(spawnSettings.tipPointSpawnAngle))) {
			angle = Number(spawnSettings.tipPointSpawnAngle);
		}
		return {
			x: target.x + distance * Math.cos(angle),
			y: target.y + distance * Math.sin(angle),
			seconds,
		};
	}
	const absolute = resolveAttachedPosition(spawnSettings, snappees, { prefix: "tipPointSpawn" }) || {
		x: Number(spawnSettings.tipPointSpawnX) || 0,
		y: Number(spawnSettings.tipPointSpawnY) || 0,
	};
	return { ...absolute, seconds };
}

function intervalsOverlap(left, right) {
	return left[0] <= right[1] && right[0] <= left[1];
}

// Longest trails get first refusal on the four multi-tip channels; whatever cannot be placed
// without overlapping an already-packed trail is reported separately so it can be exported
// without a tip point at all.
export function assignLyricaExportChannels(chains) {
	const ranked = [...chains].sort(
		(left, right) => right.events.length - left.events.length || left.start - right.start,
	);
	const occupancy = LYRICA_MULTI_TIP_CHANNELS.map(() => []);
	const assigned = [];
	const dumped = [];
	for (const chain of ranked) {
		const interval = [chain.start, chain.end];
		const slot = occupancy.findIndex(items => !items.some(item => intervalsOverlap(item, interval)));
		if (slot >= 0) {
			occupancy[slot].push(interval);
			assigned.push({ chain, channel: LYRICA_MULTI_TIP_CHANNELS[slot] });
		} else {
			dumped.push(chain);
		}
	}
	return { assigned, dumped };
}

// Lyrica distinguishes a lone tap from simultaneous ones by note type, so taps sharing a beat
// are collected first.
function tapTimeKey(event) {
	try {
		return JSON.stringify(Rational.from(event.time).toJSON());
	} catch {
		return String(event.time);
	}
}

function simultaneousTapTypes(events) {
	const buckets = new Map();
	for (const event of events) {
		if (event.type !== "tap") {
			continue;
		}
		const key = tapTimeKey(event);
		if (!buckets.has(key)) {
			buckets.set(key, []);
		}
		buckets.get(key).push(event.id);
	}
	const types = new Map();
	for (const ids of buckets.values()) {
		const type = ids.length > 1 ? 2 : 1;
		for (const id of ids) {
			types.set(id, type);
		}
	}
	return types;
}

function lyricaTypeFields(event, timing, tapType = 1) {
	if (event.type === "drag") {
		return { type: 0, arg: 0, text: "" };
	}
	if (event.type === "tap") {
		return { type: tapType, arg: 0, text: event.text || "" };
	}
	if (event.type === "flick") {
		return { type: 3, arg: sviberFlickAngleToLyrica(event.angle), text: event.text || "" };
	}
	if (event.type === "hold") {
		return { type: 4, arg: eventDurationSeconds(timing, event), text: event.text || "" };
	}
	if (event.type === "bgNote") {
		const duration = eventDurationSeconds(timing, event);
		return { type: duration > 1e-9 ? 4 : 0, arg: duration, text: event.text || "" };
	}
	if (PATTERN_TYPES.has(event.type)) {
		return {
			type: 4,
			arg: eventDurationSeconds(timing, event),
			text: event.type === "bigText" ? event.text || "" : LYRICA_BG_PATTERN_CODES[event.type] || event.text || "",
		};
	}
	return null;
}

// Annotates every trail with its Lyrica spawn point and the time span it occupies, which is
// what the channel packing needs.
function exportGuides(model, snappees, timing) {
	return resolveSviberTipChains(model).map(guide => {
		const first = guide.events[0];
		const spawn = spawnPositionOf(first, guide.spawnSettings, snappees, timing);
		return {
			...guide,
			start: spawn.seconds,
			end: eventSeconds(timing, guide.events.at(-1)),
			spawn,
		};
	});
}

// Maps each note id to the channel its trail was given and its role within that trail, which
// together decide the note's b/c codes. Single-note trails go to the independent channel and
// trails that did not fit lose their tip point on a no-tip channel.
function assignExportChannels(guides) {
	const sole = guides.filter(guide => guide.events.length === 1);
	const multi = guides.filter(guide => guide.events.length > 1);
	const packing = assignLyricaExportChannels(multi);
	const assignment = new Map();
	for (const item of sole) {
		for (const event of item.events) {
			assignment.set(event.id, { channel: LYRICA_INDEPENDENT_CHANNEL, chain: item, role: "first" });
		}
	}
	for (const item of packing.assigned) {
		item.chain.events.forEach((event, index) => {
			let role = "middle";
			if (index === 0) {
				role = "first";
			} else if (index === item.chain.events.length - 1) {
				role = "last";
			}
			assignment.set(event.id, { channel: item.channel, chain: item.chain, role });
		});
	}
	for (const chain of packing.dumped) {
		for (const event of chain.events) {
			assignment.set(event.id, { channel: LYRICA_NO_TIP_CHANNELS[0], chain, role: "none" });
		}
	}
	return assignment;
}

// The trail's first note names the spawn code; its last note sets the ending flag. Notes
// landing on the main channel are remembered because codes 0 and 1 reference the most recent
// one, and the search below has to see the same history Lyrica would.
function exportedNoteRecord(event, position, time, fields, context) {
	const { assignment, mainAssigned } = context;
	const mapped = assignment.get(event.id);
	const channel = mapped?.channel ?? LYRICA_NO_TIP_CHANNELS[0];
	let b = 0;
	let c = 0;
	if (mapped?.role === "first") {
		const lastMain = mainAssigned.filter(item => item.time < time).at(-1);
		b = chooseClosestNonRandomSpawn(position, mapped.chain.spawn, lastMain, channel).b;
	} else if (mapped?.role === "last") {
		c = 1;
	}
	if (channel === LYRICA_MAIN_CHANNEL) {
		mainAssigned.push({ ...position, time });
	}
	return { time, channel, x: position.x, y: position.y, ...fields, b, c };
}

function exportEventRecords(events, context) {
	const { timing, snappees, tapTypes } = context;
	const exported = [];
	const ordered = events
		.map((event, sequence) => ({ event, sequence }))
		.sort(
			(left, right) =>
				eventSeconds(timing, left.event) - eventSeconds(timing, right.event) || left.sequence - right.sequence,
		);
	for (const { event } of ordered) {
		if (event.type === "comment") {
			continue;
		}
		const fields = lyricaTypeFields(event, timing, tapTypes.get(event.id) || 1);
		if (!fields) {
			continue;
		}
		const position = eventPosition(event, snappees);
		const time = eventSeconds(timing, event);
		if (PATTERN_TYPES.has(event.type)) {
			const channel = LYRICA_BG_PATTERN_CHANNEL;
			exported.push({ time, channel, x: position.x, y: position.y, ...fields, b: 0, c: 0 });
			continue;
		}
		if (event.type === "bgNote") {
			const channel = LYRICA_BG_NOTE_CHANNELS[0];
			exported.push({ time, channel, x: position.x, y: position.y, ...fields, b: 0, c: 0 });
			continue;
		}
		if (!NOTE_TYPES.has(event.type)) {
			continue;
		}
		exported.push(exportedNoteRecord(event, position, time, fields, context));
	}
	return exported;
}

function exportBpmRecords(timing, initialBpm) {
	return (timing.bpmChanges || []).map(change => ({
		time: timing.beatToSeconds(change.time),
		channel: LYRICA_BPM_CHANNEL,
		x: 0,
		y: 0,
		type: 4,
		arg: Number(change.bpm) / initialBpm,
		text: "",
		b: 0,
		c: 0,
	}));
}

export function exportLyricaChart(model) {
	const timing = model.timing instanceof TimingMap ? model.timing : new TimingMap(model.timing || {});
	const snappees = model.snappees || [];
	const events = chartNotes(model);
	const initialBpm = Number(timing.initialBpm) || 120;
	const exported = [
		...exportEventRecords(events, {
			timing,
			snappees,
			assignment: assignExportChannels(exportGuides(model, snappees, timing)),
			mainAssigned: [],
			tapTypes: simultaneousTapTypes(events),
		}),
		...exportBpmRecords(timing, initialBpm),
	];
	exported.sort((left, right) => left.time - right.time || left.channel - right.channel);
	const metadata = model.metadata || {};
	return serializeLyricaChart(
		{
			initialBpm,
			title: metadata.title || "",
			artist: metadata.artist || "",
			offset: Number(timing.offset) || 0,
		},
		exported,
	);
}
