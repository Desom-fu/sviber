// Lyrica chart text to sviber chart state.
//
// The conversion is mostly a per-row translation, with two things that need whole-chart
// context: tempo (Lyrica states BPM changes as a ratio of the header BPM at a wall-clock
// time, so the timing map is built before any event is placed) and tip points (Lyrica marks
// trails implicitly, so each tip-bearing channel is walked in order afterwards to work out
// where trails begin and to replay the spawn table for their starting notes).
//
// Split out of js/core/lyrica.js.

import { Rational } from "./rational.js";
import { TimingMap } from "./timing.js";
import {
	LYRICA_BG_PATTERN_TEXT,
	LYRICA_BPM_CHANNEL,
	LYRICA_CHANNEL_ORDER,
	LYRICA_INACTIVE_IMPORT_CHANNELS,
	LYRICA_MAIN_CHANNEL,
	lyricaChannelCategory,
	lyricaChannelName,
	lyricaFlickAngleToSviber,
	parseLyricaChart,
} from "./lyrica-format.js";
import { createLyricaRng, evaluateLyricaSpawn, isLyricaFirstTipEvent } from "./lyrica-spawn.js";

const NOTE_CHANNELS = new Set([-100, -80, -60, -40, -20, 0, 20]);
const TIP_NOTE_CHANNELS = new Set([-60, -40, -20, 0, 20]);

function lyricaNoteType(event) {
	if (event.type === 0) {
		return { type: "drag" };
	}
	if (event.type === 1 || event.type === 2) {
		return { type: "tap", text: event.text };
	}
	if (event.type === 3) {
		return { type: "flick", angle: lyricaFlickAngleToSviber(event.arg), text: event.text };
	}
	if (event.type === 4) {
		return { type: "hold", durationSeconds: Math.max(0, event.arg), text: event.text };
	}
	return null;
}

function lyricaBgNoteType(event) {
	if (event.type === 11 || event.type === 12 || event.type === 13) {
		return null;
	}
	if (event.type === 4) {
		return { type: "bgNote", durationSeconds: Math.max(0, event.arg), text: event.text };
	}
	if (event.type === 0 || event.type === 1 || event.type === 2 || event.type === 3) {
		return { type: "bgNote", durationSeconds: 0, text: event.text };
	}
	return null;
}

function lyricaPatternType(event) {
	if (event.type !== 4) {
		return null;
	}
	const mapped = LYRICA_BG_PATTERN_TEXT[event.text];
	if (mapped) {
		return { type: mapped, durationSeconds: Math.max(0, event.arg) };
	}
	return { type: "bigText", durationSeconds: Math.max(0, event.arg), text: event.text };
}

export function interpretLyricaEvent(event) {
	const category = lyricaChannelCategory(event.channel);
	if (category === "bpm") {
		if (event.type !== 4) {
			return null;
		}
		return { kind: "bpm", time: event.time, ratio: event.arg };
	}
	if (category === "bgPattern") {
		const mapped = lyricaPatternType(event);
		return mapped ? { kind: "event", ...mapped } : null;
	}
	if (category === "bgNote") {
		const mapped = lyricaBgNoteType(event);
		return mapped ? { kind: "event", ...mapped } : null;
	}
	if (category === "disabled" || NOTE_CHANNELS.has(event.channel)) {
		const mapped = lyricaNoteType(event);
		return mapped ? { kind: "event", ...mapped } : null;
	}
	return null;
}

function durationBeats(timing, time, seconds, maxDenominator) {
	if (!(seconds > 0)) {
		return [0, 0, 1];
	}
	return timing.secondsDurationToBeats(timing.beatToSeconds(time), seconds, maxDenominator).toJSON();
}

// Turns one evaluated Lyrica spawn back into the sviber tip-point fields: a polar offset
// from the note unless the spawn came from the main channel, and a lead time in beats only
// when the spawn inherited another event's time.
function spawnFields(eventBeat, eventPos, spawn, timing, maxDenominator) {
	const dx = spawn.x - eventPos.x;
	const dy = spawn.y - eventPos.y;
	const fields = {
		tipPointSpawnAbsolutePosition: Boolean(spawn.positionFromMain),
		tipPointSpawnTimeBeats: Boolean(spawn.timeFromEvent),
	};
	if (fields.tipPointSpawnAbsolutePosition) {
		fields.tipPointSpawnX = spawn.x;
		fields.tipPointSpawnY = spawn.y;
	} else {
		fields.tipPointSpawnDistance = Math.hypot(dx, dy);
		fields.tipPointSpawnAngle = Math.hypot(dx, dy) > 1e-12 ? Math.atan2(dy, dx) : Math.PI / 2;
	}
	if (fields.tipPointSpawnTimeBeats) {
		const spawnBeat = timing.secondsToBeat(spawn.time, maxDenominator);
		const delta = Rational.from(eventBeat).sub(spawnBeat);
		fields.tipPointSpawnTime = (delta.compare(0) < 0 ? Rational.from(0) : delta).toJSON();
	} else {
		const eventSeconds = timing.beatToSeconds(eventBeat);
		fields.tipPointSpawnTime = Math.max(0, eventSeconds - spawn.time);
	}
	return fields;
}

// A BPM row states a ratio of the header BPM at a wall-clock time, so an offset-only map
// converts each row to a beat before the real timing map can be assembled from them.
function buildImportTiming(parsed, maxDenominator) {
	const initialBpm = parsed.header.initialBpm || 120;
	const offset = parsed.header.offset || 0;
	const bpmChanges = parsed.events
		.map(interpretLyricaEvent)
		.filter(item => item?.kind === "bpm")
		.sort((left, right) => left.time - right.time)
		.map(item => ({
			time: new TimingMap({ offset, initialBpm }).secondsToBeat(item.time, maxDenominator).toJSON(),
			bpm: Math.max(1e-6, initialBpm * Number(item.ratio || 1)),
		}));
	return new TimingMap({ offset, initialBpm, bpmChanges, barLines: [] });
}

// Lyrica's channel layout is fixed, so an imported chart always gets the same channel list,
// with the ones Lyrica leaves unused muted rather than dropped.
function buildImportChannels() {
	return LYRICA_CHANNEL_ORDER.filter(id => id !== LYRICA_BPM_CHANNEL).map((lyricaChannel, index) => ({
		id: index,
		name: lyricaChannelName(lyricaChannel),
		lyricaChannel,
		active: !LYRICA_INACTIVE_IMPORT_CHANNELS.includes(lyricaChannel),
	}));
}

// Translates every row that maps onto a sviber event, indexing the results by Lyrica channel
// and collecting the main channel separately for the tip-point pass.
function convertLyricaEvents(parsed, timing, channels, maxDenominator) {
	const channelByLyrica = new Map(channels.map(channel => [channel.lyricaChannel, channel]));
	const byChannel = new Map();
	const mainEvents = [];
	const converted = [];
	const sorted = [...parsed.events].sort((left, right) => left.time - right.time);
	for (const raw of sorted) {
		const interpreted = interpretLyricaEvent(raw);
		if (!interpreted || interpreted.kind !== "event") {
			continue;
		}
		const channel = channelByLyrica.get(raw.channel);
		if (!channel) {
			continue;
		}
		const beat = timing.secondsToBeat(raw.time, maxDenominator);
		const event = {
			type: interpreted.type,
			time: beat.toJSON(),
			channel: channel.id,
			x: raw.x,
			y: raw.y,
			lyricaChannel: raw.channel,
			lyricaTime: raw.time,
			text: interpreted.text ?? raw.text ?? "",
			tipPointSpawnType: "none",
		};
		if (interpreted.angle != null) {
			event.angle = interpreted.angle;
		}
		if (interpreted.durationSeconds != null) {
			event.duration = durationBeats(timing, beat, interpreted.durationSeconds, maxDenominator);
		}
		converted.push({ event, raw });
		if (!byChannel.has(raw.channel)) {
			byChannel.set(raw.channel, []);
		}
		byChannel.get(raw.channel).push({ event, raw });
		if (raw.channel === LYRICA_MAIN_CHANNEL) {
			mainEvents.push({ event, raw });
		}
	}
	return { converted, byChannel, mainEvents };
}

// Notes that continue the previous note's trail inherit it; a note that starts one becomes a
// `drop` when it is alone and a `chain` when further notes follow, and its spawn fields come
// from replaying the Lyrica spawn table against the latest main-channel note.
function applyImportedTipChains(byChannel, mainEvents, timing, maxDenominator, rng) {
	for (const channelId of TIP_NOTE_CHANNELS) {
		const items = byChannel.get(channelId) || [];
		for (let index = 0; index < items.length; index += 1) {
			const { event, raw } = items[index];
			const previous = items[index - 1]?.raw;
			if (!isLyricaFirstTipEvent(raw, previous)) {
				event.tipPointSpawnType = "inherit";
				continue;
			}
			let chainEnd = index;
			while (
				chainEnd + 1 < items.length &&
				!isLyricaFirstTipEvent(items[chainEnd + 1].raw, items[chainEnd].raw)
			) {
				chainEnd += 1;
			}
			event.tipPointSpawnType = chainEnd === index ? "drop" : "chain";
			const latestMain = mainEvents.filter(item => item.raw.time < raw.time).at(-1)?.raw;
			const spawn = evaluateLyricaSpawn(
				raw,
				{
					x1: latestMain?.x,
					y1: latestMain?.y,
					t1: latestMain?.time,
					previousTime: previous?.time,
				},
				rng,
			);
			Object.assign(event, spawnFields(event.time, { x: raw.x, y: raw.y }, spawn, timing, maxDenominator));
		}
	}
}

// Lyrica carries no charter or difficulty, so those come from the caller's options.
function importedMetadata(parsed, options) {
	return {
		title: parsed.header.title || "Untitled",
		artist: parsed.header.artist || "",
		charter: String(options.charter ?? "RNOVA"),
		difficultyName: String(options.difficultyName || "Master"),
		difficultyColor: String(options.difficultyColor || ""),
		difficulty: String(options.difficulty ?? "12"),
		difficultySup: String(options.difficultySup ?? ""),
	};
}

export function importLyricaChart(text, options = {}) {
	const parsed = parseLyricaChart(text);
	const maxDenominator = Math.max(1, Math.round(Number(options.quantizationDenominator) || 192));
	const rng = createLyricaRng(options.seed ?? 0);
	const timing = buildImportTiming(parsed, maxDenominator);
	const channels = buildImportChannels();
	const { converted, byChannel, mainEvents } = convertLyricaEvents(parsed, timing, channels, maxDenominator);
	applyImportedTipChains(byChannel, mainEvents, timing, maxDenominator, rng);
	const firstActive = channels.find(channel => channel.active !== false) || channels[0];
	return {
		metadata: importedMetadata(parsed, options),
		timing: timing.toJSON(),
		channels,
		events: converted.map(item => item.event),
		editor: { currentChannel: firstActive.id, showRulers: false },
		importWarnings: [],
	};
}
