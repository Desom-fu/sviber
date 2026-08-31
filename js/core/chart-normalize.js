// Coercion of untrusted chart state into canonical values. Charts reach sviber from
// hand-edited JSON, older sviber releases, macros and the Sunniesnow importer, so every
// scalar, colour, id, channel list and editor preference passes through here first.
// Everything in this module is pure and knows nothing about ChartModel itself.
// Split out of js/core/chart-model.js.

import { Rational } from "./rational.js";
import { DEFAULT_EDITOR, DEFAULT_METADATA, POSITIVE_DURATION_TYPES } from "./chart-vocabulary.js";

export function clone(value) {
	if (typeof globalThis.structuredClone === "function") {
		return globalThis.structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value));
}

export function finiteNumber(value, fallback = 0) {
	const result = Number(value);
	return Number.isFinite(result) ? result : fallback;
}

export function positiveInteger(value, fallback) {
	const result = Number(value);
	return Number.isSafeInteger(result) && result > 0 ? result : fallback;
}

export function validId(value) {
	return Number.isSafeInteger(value) && value >= 0;
}

export function normalizeLoopMarks(value) {
	const marks = [];
	for (const item of Array.isArray(value) ? value.slice(0, 2) : []) {
		try {
			const mark = Rational.from(item);
			if (!marks.some(existing => existing.equals(mark))) {
				marks.push(mark);
			}
		} catch {
			/* Ignore malformed editor-only marks. */
		}
	}
	return marks.sort((left, right) => left.compare(right)).map(mark => mark.toJSON());
}

export function normalizeColor(value, fallback = "#7f7f7f") {
	if (typeof value === "string" && value.trim()) {
		return value;
	}
	if (Number.isSafeInteger(value) && value >= 0 && value <= 0xffffff) {
		return value;
	}
	return fallback;
}

export function normalizeEventType(type) {
	const aliases = {
		bg_note: "bgNote",
		big_text: "bigText",
		diamond_grid: "diamondGrid",
	};
	return aliases[type] ?? type;
}

export function normalizeMetadata(source = {}) {
	const metadata = source.metadata ?? source;
	return {
		title: String(metadata.title ?? DEFAULT_METADATA.title),
		artist: String(metadata.artist ?? DEFAULT_METADATA.artist),
		charter: String(metadata.charter ?? DEFAULT_METADATA.charter),
		difficultyName: String(metadata.difficultyName ?? DEFAULT_METADATA.difficultyName),
		difficultyColor: normalizeColor(metadata.difficultyColor, DEFAULT_METADATA.difficultyColor),
		difficulty: String(metadata.difficulty ?? DEFAULT_METADATA.difficulty),
		difficultySup: String(metadata.difficultySup ?? DEFAULT_METADATA.difficultySup),
	};
}

export function normalizeDuration(value, type) {
	let duration;
	try {
		duration = Rational.from(value ?? 1);
	} catch {
		duration = Rational.from(1);
	}
	if (duration.compare(0) < 0 || (POSITIVE_DURATION_TYPES.has(type) && duration.compare(0) === 0)) {
		return Rational.from(type === "bgNote" || type === "comment" ? 0 : 1).toJSON();
	}
	return duration.toJSON();
}

export function normalizeSnapPoint(value) {
	if (Array.isArray(value)) {
		return value.map(item => Number(item));
	}
	return Number(value);
}

// Keeps the ids a document already declares whenever they are usable, and hands out the
// lowest unclaimed id to everything else, so reloading a chart never reshuffles ids.
export function assignStableIds(items, factory) {
	const used = new Set();
	let next = 0;
	return (Array.isArray(items) ? items : []).map((item, index) => {
		let id = item?.id;
		if (!validId(id) || used.has(id)) {
			while (used.has(next)) {
				next += 1;
			}
			id = next;
		}
		used.add(id);
		next = Math.max(next, id + 1);
		return factory(item, id, index);
	});
}

export function normalizeChannels(channels) {
	const source = Array.isArray(channels) && channels.length ? channels : [{ id: 0 }];
	return assignStableIds(source, (channel, id, index) => ({
		...clone(channel ?? {}),
		id,
		name: String(channel?.name ?? `Channel ${index + 1}`),
		active: channel?.active !== false,
		hidden: channel?.hidden === true,
		expanded: channel?.expanded === true,
	}));
}

// The playhead is stored as a rational beat while time snapping is on and as a plain
// number of seconds while it is off, so the two representations are decoded separately.
function normalizeCurrentTime(source, timeSnapped) {
	try {
		if (timeSnapped) {
			return Rational.from(source.currentTime ?? DEFAULT_EDITOR.currentTime).toJSON();
		}
		return finiteNumber(source.currentTime, 0);
	} catch {
		return timeSnapped ? [...DEFAULT_EDITOR.currentTime] : 0;
	}
}

// The editor never points at a muted channel: an explicitly requested channel wins only
// while it is active, otherwise the first active channel takes over.
function normalizeCurrentChannel(source, channels) {
	const channelIds = new Set(channels.map(({ id }) => id));
	const requestedChannel = channelIds.has(source.currentChannel) ? source.currentChannel : channels[0].id;
	const requested = channels.find(channel => channel.id === requestedChannel);
	const activeFallback = channels.find(channel => channel.active !== false);
	return requested?.active !== false || !activeFallback ? requestedChannel : activeFallback.id;
}

export function normalizeEditor(editor, channels) {
	const source = editor ?? {};
	const timeSnapped = source.timeSnapped ?? true;
	return {
		timeSnapped: Boolean(timeSnapped),
		subdivision: positiveInteger(source.subdivision, DEFAULT_EDITOR.subdivision),
		currentTime: normalizeCurrentTime(source, timeSnapped),
		visibleRangeBeginning: finiteNumber(source.visibleRangeBeginning, DEFAULT_EDITOR.visibleRangeBeginning),
		visibleRangeEnd: finiteNumber(source.visibleRangeEnd, DEFAULT_EDITOR.visibleRangeEnd),
		speed: Math.max(0.01, finiteNumber(source.speed, DEFAULT_EDITOR.speed)),
		lockVisibleRange: Boolean(source.lockVisibleRange),
		playSe: source.playSe !== false,
		seekBackAfterPlaying: Boolean(source.seekBackAfterPlaying),
		metronome: Boolean(source.metronome),
		readOnly: Boolean(source.readOnly),
		abLoopMarks: normalizeLoopMarks(source.abLoopMarks),
		currentChannel: normalizeCurrentChannel(source, channels),
		allowOutOfBound: Boolean(source.allowOutOfBound),
		timelineChannelOffset: Math.max(
			0,
			Math.min(Math.max(0, channels.length - 3), Math.round(finiteNumber(source.timelineChannelOffset, 0))),
		),
		showGroupingInTimeline: source.showGroupingInTimeline !== false,
		showGroupingInMainField: source.showGroupingInMainField !== false,
		showTipPoints: source.showTipPoints !== false,
		showBgEventsInTimeline: source.showBgEventsInTimeline !== false,
		showBgEventsInMainField: source.showBgEventsInMainField !== false,
		showHud: source.showHud !== false,
		showRulers: Boolean(source.showRulers),
		showChartBoundary: source.showChartBoundary !== false,
		playBgNoteSe: Boolean(source.playBgNoteSe),
		mainFieldPanX: finiteNumber(source.mainFieldPanX, 0),
		mainFieldPanY: finiteNumber(source.mainFieldPanY, 0),
		mainFieldZoom: Math.max(0.1, Math.min(16, finiteNumber(source.mainFieldZoom, 1))),
	};
}

export function parseSource(source) {
	if (typeof source === "string") {
		return JSON.parse(source);
	}
	if (!source || typeof source !== "object") {
		throw new TypeError("chart data must be an object or JSON string");
	}
	return source;
}

export function nextCounter(items, provided) {
	const derived = items.reduce((maximum, item) => Math.max(maximum, item.id + 1), 0);
	return validId(provided) ? Math.max(derived, provided) : derived;
}
