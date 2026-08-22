import { Rational } from "./rational.js";
import { TimingMap } from "./timing.js";
import { resolveAttachedPosition } from "./geometry.js";

export const LYRICA_MAIN_CHANNEL = -60;
export const LYRICA_INDEPENDENT_CHANNEL = 20;
export const LYRICA_NO_TIP_CHANNELS = Object.freeze([-100, -80]);
export const LYRICA_NORMAL_CHANNELS = Object.freeze([-40, -20, 0]);
export const LYRICA_MULTI_TIP_CHANNELS = Object.freeze([-60, -40, -20, 0]);
export const LYRICA_BG_PATTERN_CHANNEL = 40;
export const LYRICA_BG_NOTE_CHANNELS = Object.freeze([60, 80]);
export const LYRICA_DISABLED_CHANNELS = Object.freeze([100, 120, 140, 160, 180]);
export const LYRICA_BPM_CHANNEL = 200;
export const LYRICA_SLOW_SPAWN = 1.5;
export const LYRICA_FAST_SPAWN = 1;
export const LYRICA_MAX_GAP = 2;
export const LYRICA_TABLE_B = Object.freeze([0, 1, 2, 3, 4, 5, 6, 20, 21, 22, 23, 24, 25, 26, 27]);

export const LYRICA_CHANNEL_ORDER = Object.freeze([
	-100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
]);

export const LYRICA_BG_PATTERN_TEXT = Object.freeze({
	a1: "grid",
	a2: "hexagon",
	a3: "checkerboard",
	a4: "diamondGrid",
	a5: "pentagon",
	a6: "turntable",
	a7: "hexagram",
});

export const LYRICA_BG_PATTERN_CODES = Object.freeze({
	grid: "a1",
	hexagon: "a2",
	checkerboard: "a3",
	diamondGrid: "a4",
	pentagon: "a5",
	turntable: "a6",
	hexagram: "a7",
});

const TIP_NOTE_CHANNELS = new Set([-60, -40, -20, 0, 20]);
const NOTE_CHANNELS = new Set([-100, -80, -60, -40, -20, 0, 20]);
const COVERED_B = new Set(LYRICA_TABLE_B);
const NOTE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
const PATTERN_TYPES = new Set(["bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"]);

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function abs(value) {
	return Math.abs(value);
}

function sgn(value) {
	return value < 0 ? -1 : value > 0 ? 1 : 0;
}

function hashSeed(seed) {
	if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
	const text = String(seed ?? "");
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export function createLyricaRng(seed = 0) {
	let state = hashSeed(seed) || 1;
	const random = () => {
		state |= 0;
		state = state + 0x6D2B79F5 | 0;
		let next = Math.imul(state ^ state >>> 15, 1 | state);
		next = next + Math.imul(next ^ next >>> 7, 61 | next) ^ next;
		return ((next ^ next >>> 14) >>> 0) / 4294967296;
	};
	return {
		random,
		rand(min, max) {
			if (max == null) return random() * Number(min || 1);
			return Number(min) + (Number(max) - Number(min)) * random();
		},
		randRange(min, max) {
			return Number(min) + (Number(max) - Number(min)) * random();
		},
		randBit() {
			return random() < 0.5 ? 0 : 1;
		},
		pick(items) {
			if (!items.length) return undefined;
			return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
		},
	};
}

export function lyricaChannelCategory(channel) {
	const id = Number(channel);
	if (LYRICA_NO_TIP_CHANNELS.includes(id)) return "noTip";
	if (id === LYRICA_MAIN_CHANNEL) return "main";
	if (LYRICA_NORMAL_CHANNELS.includes(id)) return "normal";
	if (id === LYRICA_INDEPENDENT_CHANNEL) return "independent";
	if (id === LYRICA_BG_PATTERN_CHANNEL) return "bgPattern";
	if (LYRICA_BG_NOTE_CHANNELS.includes(id)) return "bgNote";
	if (LYRICA_DISABLED_CHANNELS.includes(id)) return "disabled";
	if (id === LYRICA_BPM_CHANNEL) return "bpm";
	return "unknown";
}

export function lyricaChannelName(channel) {
	const names = {
		[-100]: "No tip 1",
		[-80]: "No tip 2",
		[-60]: "Main",
		[-40]: "Normal 1",
		[-20]: "Normal 2",
		0: "Normal 3",
		20: "Independent",
		40: "Background patterns",
		60: "Background notes 1",
		80: "Background notes 2",
		100: "Disabled 1",
		120: "Disabled 2",
		140: "Disabled 3",
		160: "Disabled 4",
		180: "Disabled 5",
		200: "BPM",
	};
	return names[Number(channel)] || `Lyrica ${channel}`;
}

export function decodeTipPointCodes(spawning, ending) {
	let b = Number(spawning) || 0;
	let c = ending == null || ending === "" ? null : Number(ending);
	if (!Number.isFinite(c)) {
		const bPrime = (b % 10 + 10) % 10 + 20 * Math.floor(b / 20);
		const cPrime = Math.floor(((b % 20) + 20) % 20 / 10);
		b = bPrime;
		c = cPrime;
	}
	if (!COVERED_B.has(b)) b = 0;
	return { b, c: Number(c) || 0 };
}

export function lyricaFlickAngleToSviber(degrees) {
	return Math.PI / 2 - Number(degrees || 0) / 180 * Math.PI;
}

export function sviberFlickAngleToLyrica(radians) {
	return 90 - Number(radians || 0) * 180 / Math.PI;
}

export function isLyricaChartText(text) {
	const first = String(text || "").split(/\r?\n/).find(line => line.trim());
	if (!first || first.includes("{")) return false;
	const fields = first.split("|");
	return fields.length >= 4 && Number.isFinite(Number(fields[0]));
}

function parseArgument(raw) {
	const parts = String(raw ?? "0").split("_").map(part => Number(part));
	return { arg: Number.isFinite(parts[0]) ? parts[0] : 0, arg2: Number.isFinite(parts[1]) ? parts[1] : null };
}

export function parseLyricaEvent(raw) {
	const fields = String(raw || "").split("|");
	if (fields.length < 8) return null;
	const time = Number(fields[0]);
	const channel = Number(fields[1]);
	const x = Number(fields[2]);
	const y = Number(fields[3]);
	const type = Number(fields[4]);
	if (![time, channel, x, y, type].every(Number.isFinite)) return null;
	const argument = parseArgument(fields[5]);
	const endingMissing = fields[8] == null || fields[8] === "";
	const codes = decodeTipPointCodes(fields[7], endingMissing ? null : fields[8]);
	return {
		time,
		channel,
		x,
		y,
		type,
		arg: argument.arg,
		arg2: argument.arg2,
		text: fields[6] ?? "",
		b: codes.b,
		c: codes.c,
		anomalous: fields[9] == null || fields[9] === "" ? null : Number(fields[9]),
		raw,
	};
}

export function parseLyricaHeader(line) {
	const fields = String(line || "").split("|");
	return {
		initialBpm: Number(fields[0]) || 120,
		title: fields[1] ?? "",
		artist: fields[2] ?? "",
		offset: Number(fields[3]) || 0,
		timeSignature: fields[4] == null || fields[4] === "" ? null : Number(fields[4]),
		bpmCheckMode: fields[5] == null || fields[5] === "" ? null : Number(fields[5]),
	};
}

export function parseLyricaChart(text) {
	const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
	const header = parseLyricaHeader(lines[0] || "");
	const buckets = { 1: "", 2: "", 3: "", 4: "" };
	let current = 0;
	for (const line of lines.slice(1)) {
		const marker = /^#([1-4])\s*$/.exec(line.trim());
		if (marker) {
			current = Number(marker[1]);
			continue;
		}
		if (current) buckets[current] += (buckets[current] ? "," : "") + line;
	}
	const events = [];
	for (const key of [1, 2, 3, 4]) {
		for (const item of buckets[key].split(",")) {
			const trimmed = item.trim();
			if (!trimmed) continue;
			const event = parseLyricaEvent(trimmed);
			if (event) events.push(event);
		}
	}
	return { header, events };
}

function autoX(x) {
	return x > 0 ? clamp(x - 120, -100, 0) : clamp(x + 120, 0, 100);
}

export function evaluateLyricaSpawn(event, context, rng) {
	const { b } = event;
	const x = Number(event.x) || 0;
	const y = Number(event.y) || 0;
	const t = Number(event.time) || 0;
	const independent = event.channel === LYRICA_INDEPENDENT_CHANNEL;
	const x1 = context.x1;
	const y1 = context.y1;
	const t1 = context.t1;
	const hasMain = Number.isFinite(x1) && Number.isFinite(y1);
	const random = rng || createLyricaRng(0);
	const candidates = [];
	if (b === 0) {
		candidates.push({
			x: independent && hasMain ? x1 : autoX(x),
			y: independent && hasMain ? y1 : random.rand(-50, 50),
			time: t - LYRICA_SLOW_SPAWN,
			positionFromMain: Boolean(independent && hasMain),
			timeFromEvent: false,
			random: !(independent && hasMain),
		});
	} else if (b === 1) {
		candidates.push({
			x: hasMain ? x1 : autoX(x),
			y: hasMain ? y1 : random.rand(-50, 50),
			time: independent || !Number.isFinite(t1) ? t - LYRICA_SLOW_SPAWN : t1,
			positionFromMain: hasMain,
			timeFromEvent: !independent && Number.isFinite(t1),
			random: !hasMain,
		});
	} else if (b === 2) {
		candidates.push({
			x: autoX(x), y: random.rand(-50, 50), time: t - LYRICA_SLOW_SPAWN,
			positionFromMain: false, timeFromEvent: false, random: true,
		});
	} else if (b === 3) {
		candidates.push({
			x: random.rand(clamp(x - 40, -130, 130), clamp(x + 40, -130, 130)),
			y: y > 0 ? -75 : 75,
			time: t - LYRICA_SLOW_SPAWN,
			positionFromMain: false, timeFromEvent: false, random: true,
		});
	} else if (b === 4) {
		candidates.push({
			x: (abs(x) > 50 ? x > 0 : random.randBit()) ? clamp(x - 120, -100, 0) : clamp(x + 120, 0, 100),
			y: random.randRange(-50, 50),
			time: t - LYRICA_SLOW_SPAWN,
			positionFromMain: false, timeFromEvent: false, random: true,
		});
		candidates.push({
			x: random.rand(clamp(x - 40, -130, 130), clamp(x + 40, -130, 130)),
			y: -80 * (abs(x) > 50 && abs(y) > 20 ? sgn(y) : random.randBit() ? -1 : 1),
			time: t - LYRICA_SLOW_SPAWN,
			positionFromMain: false, timeFromEvent: false, random: true,
		});
	} else if (b === 5) {
		candidates.push({
			x: autoX(x), y, time: t - LYRICA_SLOW_SPAWN,
			positionFromMain: false, timeFromEvent: false, random: false,
		});
	} else if (b === 6) {
		candidates.push({
			x, y: y > 0 ? -100 : 100, time: t - LYRICA_FAST_SPAWN,
			positionFromMain: false, timeFromEvent: false, random: false,
		});
	} else if (b >= 20 && b <= 27) {
		const offsets = {
			20: [0, -100], 21: [-72, -72], 22: [-100, 0], 23: [-72, 72],
			24: [0, 100], 25: [72, 72], 26: [100, 0], 27: [72, -72],
		};
		const [dx, dy] = offsets[b];
		candidates.push({
			x: x + dx, y: y + dy, time: t - LYRICA_FAST_SPAWN,
			positionFromMain: false, timeFromEvent: false, random: false,
		});
	} else {
		return evaluateLyricaSpawn({ ...event, b: 0 }, context, random);
	}
	const chosen = candidates.length > 1 ? random.pick(candidates) : candidates[0];
	let time = chosen.time;
	if (!independent) {
		const previous = Number.isFinite(context.previousTime) ? context.previousTime : -Infinity;
		time = Math.max(time, t - LYRICA_MAX_GAP, previous);
	}
	return { ...chosen, time };
}

export function isLyricaFirstTipEvent(event, previous) {
	if (event.channel === LYRICA_INDEPENDENT_CHANNEL) return true;
	if (!previous) return true;
	if (event.b && COVERED_B.has(event.b)) return true;
	if (event.time - previous.time > LYRICA_MAX_GAP) return true;
	if (previous.c) return true;
	return false;
}

function lyricaNoteType(event) {
	if (event.type === 0) return { type: "drag" };
	if (event.type === 1 || event.type === 2) return { type: "tap", text: event.text };
	if (event.type === 3) return { type: "flick", angle: lyricaFlickAngleToSviber(event.arg), text: event.text };
	if (event.type === 4) return { type: "hold", durationSeconds: Math.max(0, event.arg), text: event.text };
	return null;
}

function lyricaBgNoteType(event) {
	if (event.type === 11 || event.type === 12 || event.type === 13) return null;
	if (event.type === 4) return { type: "bgNote", durationSeconds: Math.max(0, event.arg), text: event.text };
	if (event.type === 0 || event.type === 1 || event.type === 2 || event.type === 3) {
		return { type: "bgNote", durationSeconds: 0, text: event.text };
	}
	return null;
}

function lyricaPatternType(event) {
	if (event.type !== 4) return null;
	const mapped = LYRICA_BG_PATTERN_TEXT[event.text];
	if (mapped) return { type: mapped, durationSeconds: Math.max(0, event.arg) };
	return { type: "bigText", durationSeconds: Math.max(0, event.arg), text: event.text };
}

export function interpretLyricaEvent(event) {
	const category = lyricaChannelCategory(event.channel);
	if (category === "bpm") {
		if (event.type !== 4) return null;
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

function eventPosition(event, snappees = []) {
	return resolveAttachedPosition(event, snappees) || {
		x: Number(event.x) || 0,
		y: Number(event.y) || 0,
	};
}

function durationBeats(timing, time, seconds, maxDenominator) {
	if (!(seconds > 0)) return [0, 0, 1];
	return timing.secondsDurationToBeats(timing.beatToSeconds(time), seconds, maxDenominator).toJSON();
}

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

export function importLyricaChart(text, options = {}) {
	const parsed = parseLyricaChart(text);
	const maxDenominator = Math.max(1, Math.round(Number(options.quantizationDenominator) || 192));
	const rng = createLyricaRng(options.seed ?? 0);
	const bpmEvents = parsed.events
		.map(interpretLyricaEvent)
		.filter(item => item?.kind === "bpm")
		.sort((left, right) => left.time - right.time);
	const initialBpm = parsed.header.initialBpm || 120;
	const offset = parsed.header.offset || 0;
	const bpmChanges = bpmEvents.map(item => ({
		time: new TimingMap({ offset, initialBpm }).secondsToBeat(item.time, maxDenominator).toJSON(),
		bpm: Math.max(1e-6, initialBpm * Number(item.ratio || 1)),
	}));
	const timing = new TimingMap({ offset, initialBpm, bpmChanges, barLines: [] });
	const channels = LYRICA_CHANNEL_ORDER.filter(id => id !== LYRICA_BPM_CHANNEL).map((lyricaChannel, index) => ({
		id: index,
		name: lyricaChannelName(lyricaChannel),
		lyricaChannel,
		active: lyricaChannelCategory(lyricaChannel) !== "disabled",
	}));
	const channelByLyrica = new Map(channels.map(channel => [channel.lyricaChannel, channel]));
	const byChannel = new Map();
	const mainEvents = [];
	const converted = [];
	const sorted = [...parsed.events].sort((left, right) => left.time - right.time);
	for (const raw of sorted) {
		const interpreted = interpretLyricaEvent(raw);
		if (!interpreted || interpreted.kind !== "event") continue;
		const channel = channelByLyrica.get(raw.channel);
		if (!channel) continue;
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
		if (interpreted.angle != null) event.angle = interpreted.angle;
		if (interpreted.durationSeconds != null) {
			event.duration = durationBeats(timing, beat, interpreted.durationSeconds, maxDenominator);
		}
		converted.push({ event, raw });
		if (!byChannel.has(raw.channel)) byChannel.set(raw.channel, []);
		byChannel.get(raw.channel).push({ event, raw });
		if (raw.channel === LYRICA_MAIN_CHANNEL) mainEvents.push({ event, raw });
	}

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
			while (chainEnd + 1 < items.length && !isLyricaFirstTipEvent(items[chainEnd + 1].raw, items[chainEnd].raw)) {
				chainEnd += 1;
			}
			event.tipPointSpawnType = chainEnd === index ? "drop" : "chain";
			const latestMain = mainEvents.filter(item => item.raw.time < raw.time).at(-1)?.raw;
			const spawn = evaluateLyricaSpawn(raw, {
				x1: latestMain?.x,
				y1: latestMain?.y,
				t1: latestMain?.time,
				previousTime: previous?.time,
			}, rng);
			Object.assign(event, spawnFields(event.time, { x: raw.x, y: raw.y }, spawn, timing, maxDenominator));
		}
	}

	const firstActive = channels.find(channel => channel.active !== false) || channels[0];
	return {
		metadata: {
			title: parsed.header.title || "Untitled",
			artist: parsed.header.artist || "",
			charter: String(options.charter ?? ""),
			difficultyName: "Master",
			difficulty: "12",
		},
		timing: timing.toJSON(),
		channels,
		events: converted.map(item => item.event),
		editor: { currentChannel: firstActive.id, showRulers: false },
		importWarnings: [],
	};
}

function flattenEvents(items, includeGroups = false) {
	const result = [];
	const visit = event => {
		if (event.type === "group") {
			if (includeGroups) result.push(event);
			for (const child of event.events || []) visit(child);
			return;
		}
		result.push(event);
	};
	for (const event of items || []) visit(event);
	return result;
}

export function resolveSviberTipChains(model) {
	const events = typeof model.allEvents === "function"
		? model.allEvents({ includeGroups: false })
		: flattenEvents(model.events || []);
	const channels = model.channels || [];
	const guides = [];
	for (const channel of channels) {
		const notes = events
			.map((event, sequence) => ({ event, sequence }))
			.filter(({ event }) => NOTE_TYPES.has(event.type) && event.channel === channel.id)
			.sort((left, right) => Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence);
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
				if (declared === "drop" || !previousSettings) previousSettings = event;
				guides.push({ mode: "drop", spawnSettings: previousSettings, events: [event] });
				active = null;
			} else {
				active = null;
				if (effective === "none") previousSettings = null;
			}
			previousMode = effective;
			if (declared === "chain" || declared === "drop") previousSettings = event;
			if (declared === "none") {
				previousMode = "none";
				previousSettings = null;
			}
		}
	}
	return guides.filter(guide => guide.events.length);
}

function spawnPositionOf(event, spawnSettings, snappees, timing) {
	const target = eventPosition(event, snappees);
	if (!spawnSettings.tipPointSpawnAbsolutePosition) {
		const distance = Math.max(0, Number(spawnSettings.tipPointSpawnDistance) || 0);
		const angle = Number.isFinite(Number(spawnSettings.tipPointSpawnAngle))
			? Number(spawnSettings.tipPointSpawnAngle) : Math.PI / 2;
		return {
			x: target.x + distance * Math.cos(angle),
			y: target.y + distance * Math.sin(angle),
			seconds: spawnSettings.tipPointSpawnTimeBeats
				? timing.beatToSeconds(Rational.from(event.time).sub(spawnSettings.tipPointSpawnTime || 0))
				: timing.beatToSeconds(event.time) - Math.max(0, Number(spawnSettings.tipPointSpawnTime) || 0),
		};
	}
	const absolute = resolveAttachedPosition(spawnSettings, snappees, { prefix: "tipPointSpawn" })
		|| { x: Number(spawnSettings.tipPointSpawnX) || 0, y: Number(spawnSettings.tipPointSpawnY) || 0 };
	return {
		...absolute,
		seconds: spawnSettings.tipPointSpawnTimeBeats
			? timing.beatToSeconds(Rational.from(event.time).sub(spawnSettings.tipPointSpawnTime || 0))
			: timing.beatToSeconds(event.time) - Math.max(0, Number(spawnSettings.tipPointSpawnTime) || 0),
	};
}

export function deterministicSpawnCandidates(eventPos, lastMain, channel) {
	const x = eventPos.x;
	const y = eventPos.y;
	const independent = channel === LYRICA_INDEPENDENT_CHANNEL;
	const candidates = [
		{ b: 5, x: autoX(x), y },
		{ b: 6, x, y: y > 0 ? -100 : 100 },
		{ b: 20, x, y: y - 100 },
		{ b: 21, x: x - 72, y: y - 72 },
		{ b: 22, x: x - 100, y },
		{ b: 23, x: x - 72, y: y + 72 },
		{ b: 24, x, y: y + 100 },
		{ b: 25, x: x + 72, y: y + 72 },
		{ b: 26, x: x + 100, y },
		{ b: 27, x: x + 72, y: y - 72 },
	];
	if (lastMain) {
		if (independent) candidates.push({ b: 0, x: lastMain.x, y: lastMain.y });
		candidates.push({ b: 1, x: lastMain.x, y: lastMain.y });
	}
	return candidates;
}

export function chooseClosestNonRandomSpawn(eventPos, spawnPos, lastMain, channel) {
	let best = null;
	for (const candidate of deterministicSpawnCandidates(eventPos, lastMain, channel)) {
		const distance = Math.hypot(candidate.x - spawnPos.x, candidate.y - spawnPos.y);
		if (!best || distance < best.distance) best = { ...candidate, distance };
	}
	return best || { b: 5, x: autoX(eventPos.x), y: eventPos.y, distance: Infinity };
}

function intervalsOverlap(left, right) {
	return left[0] <= right[1] && right[0] <= left[1];
}

export function assignLyricaExportChannels(chains) {
	const ranked = [...chains].sort((left, right) => right.events.length - left.events.length || left.start - right.start);
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

function formatNumber(value) {
	if (!Number.isFinite(value)) return "0";
	const text = value.toFixed(7).replace(/\.?0+$/, "");
	return text === "-0" ? "0" : text;
}

function formatEvent(event) {
	const argument = event.arg2 == null ? formatNumber(event.arg) : `${formatNumber(event.arg)}_${event.arg2}`;
	return [
		formatNumber(event.time),
		String(event.channel),
		formatNumber(event.x),
		formatNumber(event.y),
		String(event.type),
		argument,
		event.text ?? "",
		String(event.b ?? 0),
		String(event.c ?? 0),
	].join("|");
}

function bucketFor(channel) {
	if (channel <= 20) return 1;
	if (channel <= 100) return 2;
	if (channel <= 180) return 3;
	return 4;
}

export function serializeLyricaChart(header, events) {
	const buckets = { 1: [], 2: [], 3: [], 4: [] };
	for (const event of events) buckets[bucketFor(event.channel)].push(event);
	const lines = [
		[formatNumber(header.initialBpm), header.title ?? "", header.artist ?? "", formatNumber(header.offset), "4", "0"].join("|"),
	];
	for (const index of [1, 2, 3, 4]) {
		lines.push(`#${index}`);
		lines.push(buckets[index].map(formatEvent).join(","));
	}
	return `${lines.join("\n")}\n`;
}

function eventSeconds(timing, event) {
	try { return timing.beatToSeconds(event.time); } catch { return 0; }
}

function eventDurationSeconds(timing, event) {
	if (!event.duration) return 0;
	try { return Math.max(0, timing.durationToSeconds(event.time, event.duration)); } catch { return 0; }
}

function lyricaTypeFields(event, timing) {
	if (event.type === "drag") return { type: 0, arg: 0, text: "" };
	if (event.type === "tap") return { type: 1, arg: 0, text: event.text || "" };
	if (event.type === "flick") return { type: 3, arg: sviberFlickAngleToLyrica(event.angle), text: event.text || "" };
	if (event.type === "hold") return { type: 4, arg: eventDurationSeconds(timing, event), text: event.text || "" };
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

export function exportLyricaChart(model) {
	const timing = model.timing instanceof TimingMap ? model.timing : new TimingMap(model.timing || {});
	const snappees = model.snappees || [];
	const events = typeof model.allEvents === "function"
		? model.allEvents({ includeGroups: false })
		: flattenEvents(model.events || []);
	const guides = resolveSviberTipChains(model).map(guide => {
		const first = guide.events[0];
		const spawn = spawnPositionOf(first, guide.spawnSettings, snappees, timing);
		return {
			...guide,
			start: spawn.seconds,
			end: eventSeconds(timing, guide.events.at(-1)),
			spawn,
		};
	});
	const sole = guides.filter(guide => guide.events.length === 1);
	const multi = guides.filter(guide => guide.events.length > 1);
	const connected = new Set(guides.flatMap(guide => guide.events.map(event => event.id)));
	const packing = assignLyricaExportChannels(multi);
	const assignment = new Map();
	for (const item of sole) {
		for (const event of item.events) assignment.set(event.id, { channel: LYRICA_INDEPENDENT_CHANNEL, chain: item, role: "first" });
	}
	for (const item of packing.assigned) {
		item.chain.events.forEach((event, index) => {
			assignment.set(event.id, {
				channel: item.channel,
				chain: item.chain,
				role: index === 0 ? "first" : index === item.chain.events.length - 1 ? "last" : "middle",
			});
		});
	}
	for (const chain of packing.dumped) {
		for (const event of chain.events) assignment.set(event.id, { channel: LYRICA_NO_TIP_CHANNELS[0], chain, role: "none" });
	}

	const exported = [];
	const mainAssigned = [];
	const ordered = events
		.map((event, sequence) => ({ event, sequence }))
		.sort((left, right) => eventSeconds(timing, left.event) - eventSeconds(timing, right.event) || left.sequence - right.sequence);
	for (const { event } of ordered) {
		if (event.type === "comment") continue;
		const fields = lyricaTypeFields(event, timing);
		if (!fields) continue;
		const position = eventPosition(event, snappees);
		const time = eventSeconds(timing, event);
		if (PATTERN_TYPES.has(event.type)) {
			exported.push({ time, channel: LYRICA_BG_PATTERN_CHANNEL, x: position.x, y: position.y, ...fields, b: 0, c: 0 });
			continue;
		}
		if (event.type === "bgNote") {
			exported.push({ time, channel: LYRICA_BG_NOTE_CHANNELS[0], x: position.x, y: position.y, ...fields, b: 0, c: 0 });
			continue;
		}
		if (!NOTE_TYPES.has(event.type)) continue;
		const mapped = assignment.get(event.id);
		const channel = mapped?.channel ?? LYRICA_NO_TIP_CHANNELS[0];
		let b = 0;
		let c = 0;
		if (mapped?.role === "first") {
			const lastMain = mainAssigned.filter(item => item.time < time).at(-1);
			const chosen = chooseClosestNonRandomSpawn(position, mapped.chain.spawn, lastMain, channel);
			b = chosen.b;
			c = mapped.chain.events.length === 1 ? 0 : 0;
		} else if (mapped?.role === "last") {
			c = 1;
		} else if (mapped?.role === "none") {
			b = 0;
			c = 0;
		}
		if (channel === LYRICA_MAIN_CHANNEL) mainAssigned.push({ ...position, time });
		exported.push({ time, channel, x: position.x, y: position.y, ...fields, b, c });
	}

	const initialBpm = Number(timing.initialBpm) || 120;
	for (const change of timing.bpmChanges || []) {
		exported.push({
			time: timing.beatToSeconds(change.time),
			channel: LYRICA_BPM_CHANNEL,
			x: 0,
			y: 0,
			type: 4,
			arg: Number(change.bpm) / initialBpm,
			text: "",
			b: 0,
			c: 0,
		});
	}
	exported.sort((left, right) => left.time - right.time || left.channel - right.channel);
	const metadata = model.metadata || {};
	return serializeLyricaChart({
		initialBpm,
		title: metadata.title || "",
		artist: metadata.artist || "",
		offset: Number(timing.offset) || 0,
	}, exported);
}
