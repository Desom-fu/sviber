// Where a Lyrica tip point starts from.
//
// Lyrica does not store a tip point's own position. Instead every note carries a spawn code
// `b` that describes how to derive it, and several of those codes are randomized, so
// reproducing them needs the same seeded generator Lyrica uses. `evaluateLyricaSpawn` runs a
// code forwards (import), while `deterministicSpawnCandidates` and
// `chooseClosestNonRandomSpawn` run the mapping backwards, picking the non-random code that
// lands closest to a sviber spawn point (export).
//
// Split out of js/core/lyrica.js.

import {
	COVERED_SPAWN_CODES,
	LYRICA_FAST_SPAWN,
	LYRICA_INDEPENDENT_CHANNEL,
	LYRICA_MAX_GAP,
	LYRICA_SLOW_SPAWN,
} from "./lyrica-format.js";

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function abs(value) {
	return Math.abs(Number(value) || 0);
}

function sgn(value) {
	return Number(value) > 0 ? 1 : -1;
}

function hashSeed(seed) {
	const text = String(seed ?? "");
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	if (!text.length) {
		hash = Number(seed) || 0;
	}
	return hash >>> 0;
}

export function createLyricaRng(seed = 0) {
	let state = hashSeed(seed) || 1;
	const random = () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let next = Math.imul(state ^ (state >>> 15), 1 | state);
		next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
		return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
	};
	return {
		random,
		rand(min, max) {
			if (max == null) {
				return random() * Number(min || 1);
			}
			return Number(min) + (Number(max) - Number(min)) * random();
		},
		randRange(min, max) {
			return Number(min) + (Number(max) - Number(min)) * random();
		},
		randBit() {
			return random() < 0.5 ? 0 : 1;
		},
		pick(items) {
			if (!items.length) {
				return undefined;
			}
			return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
		},
	};
}

// Mirrors a note's x onto the opposite side of the playfield, which is where an unguided
// tip point comes in from.
function autoX(x) {
	return x > 0 ? clamp(x - 120, -100, 0) : clamp(x + 120, 0, 100);
}

// Codes 20..27 are eight fixed compass offsets from the note.
const COMPASS_OFFSETS = Object.freeze({
	20: [0, -100],
	21: [-72, -72],
	22: [-100, 0],
	23: [-72, 72],
	24: [0, 100],
	25: [72, 72],
	26: [100, 0],
	27: [72, -72],
});

// Codes 0 and 1 follow the main channel's last note when there is one. Code 0 only does so
// on the independent channel; code 1 always does, and additionally borrows its spawn time
// from that note unless the note itself is independent.
function mainChannelSpawn(b, geometry, random) {
	const { x, t, independent, hasMain, x1, y1, t1 } = geometry;
	if (b === 0) {
		return {
			x: independent && hasMain ? x1 : autoX(x),
			y: independent && hasMain ? y1 : random.rand(-50, 50),
			time: t - LYRICA_SLOW_SPAWN,
			positionFromMain: Boolean(independent && hasMain),
			timeFromEvent: false,
			random: !(independent && hasMain),
		};
	}
	return {
		x: hasMain ? x1 : autoX(x),
		y: hasMain ? y1 : random.rand(-50, 50),
		time: independent || !Number.isFinite(t1) ? t - LYRICA_SLOW_SPAWN : t1,
		positionFromMain: hasMain,
		timeFromEvent: !independent && Number.isFinite(t1),
		random: !hasMain,
	};
}

// Code 4 offers two alternatives and lets the generator choose, which is what makes it the
// "random row" of the spawn table.
function sidewaysSpawnPair(geometry, random) {
	const { x, y, t } = geometry;
	const first = {
		x: (abs(x) > 50 ? x > 0 : random.randBit()) ? clamp(x - 120, -100, 0) : clamp(x + 120, 0, 100),
		y: random.randRange(-50, 50),
		time: t - LYRICA_SLOW_SPAWN,
		positionFromMain: false,
		timeFromEvent: false,
		random: true,
	};
	const second = {
		x: random.rand(clamp(x - 40, -130, 130), clamp(x + 40, -130, 130)),
		y: -80 * (abs(x) > 50 && abs(y) > 20 ? sgn(y) : random.randBit() ? -1 : 1),
		time: t - LYRICA_SLOW_SPAWN,
		positionFromMain: false,
		timeFromEvent: false,
		random: true,
	};
	return [first, second];
}

// Codes 2..6 derive the spawn from the note alone: 2 and 3 are randomized, 4 is the random
// pair above, and 5 and 6 are exact mirrors of the note.
function derivedSpawnCandidates(b, geometry, random) {
	const { x, y, t } = geometry;
	if (b === 2) {
		return [
			{
				x: autoX(x),
				y: random.rand(-50, 50),
				time: t - LYRICA_SLOW_SPAWN,
				positionFromMain: false,
				timeFromEvent: false,
				random: true,
			},
		];
	}
	if (b === 3) {
		return [
			{
				x: random.rand(clamp(x - 40, -130, 130), clamp(x + 40, -130, 130)),
				y: y > 0 ? -75 : 75,
				time: t - LYRICA_SLOW_SPAWN,
				positionFromMain: false,
				timeFromEvent: false,
				random: true,
			},
		];
	}
	if (b === 4) {
		return sidewaysSpawnPair(geometry, random);
	}
	if (b === 5) {
		return [
			{
				x: autoX(x),
				y,
				time: t - LYRICA_SLOW_SPAWN,
				positionFromMain: false,
				timeFromEvent: false,
				random: false,
			},
		];
	}
	if (b === 6) {
		return [
			{
				x,
				y: y > 0 ? -100 : 100,
				time: t - LYRICA_FAST_SPAWN,
				positionFromMain: false,
				timeFromEvent: false,
				random: false,
			},
		];
	}
	return null;
}

function compassSpawn(b, geometry) {
	const { x, y, t } = geometry;
	const [dx, dy] = COMPASS_OFFSETS[b];
	return {
		x: x + dx,
		y: y + dy,
		time: t - LYRICA_FAST_SPAWN,
		positionFromMain: false,
		timeFromEvent: false,
		random: false,
	};
}

function lyricaSpawnCandidates(b, geometry, random) {
	if (b === 0 || b === 1) {
		return [mainChannelSpawn(b, geometry, random)];
	}
	const derived = derivedSpawnCandidates(b, geometry, random);
	if (derived) {
		return derived;
	}
	if (b >= 20 && b <= 27) {
		return [compassSpawn(b, geometry)];
	}
	return null;
}

export function evaluateLyricaSpawn(event, context, rng) {
	const t = Number(event.time) || 0;
	const geometry = {
		x: Number(event.x) || 0,
		y: Number(event.y) || 0,
		t,
		independent: event.channel === LYRICA_INDEPENDENT_CHANNEL,
		x1: context.x1,
		y1: context.y1,
		t1: context.t1,
		hasMain: Number.isFinite(context.x1) && Number.isFinite(context.y1),
	};
	const random = rng || createLyricaRng(0);
	const candidates = lyricaSpawnCandidates(event.b, geometry, random);
	if (!candidates) {
		return evaluateLyricaSpawn({ ...event, b: 0 }, context, random);
	}
	const chosen = candidates.length > 1 ? random.pick(candidates) : candidates[0];
	let time = chosen.time;
	if (!geometry.independent) {
		const previous = Number.isFinite(context.previousTime) ? context.previousTime : -Infinity;
		time = Math.max(time, t - LYRICA_MAX_GAP, previous);
	}
	return { ...chosen, time };
}

// A note begins a new trail when it is independent, when it declares a spawn code of its
// own, when too much time has passed since the previous note, or when that note ended its
// trail.
export function isLyricaFirstTipEvent(event, previous) {
	if (event.channel === LYRICA_INDEPENDENT_CHANNEL) {
		return true;
	}
	if (!previous) {
		return true;
	}
	if (event.b && COVERED_SPAWN_CODES.has(event.b)) {
		return true;
	}
	if (event.time - previous.time > LYRICA_MAX_GAP) {
		return true;
	}
	if (previous.c) {
		return true;
	}
	return false;
}

// Every spawn code whose result does not depend on the generator, so exporting a sviber
// spawn point can pick the closest one and stay reproducible.
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
		if (independent) {
			candidates.push({ b: 0, x: lastMain.x, y: lastMain.y });
		}
		candidates.push({ b: 1, x: lastMain.x, y: lastMain.y });
	}
	return candidates;
}

export function chooseClosestNonRandomSpawn(eventPos, spawnPos, lastMain, channel) {
	let best = null;
	for (const candidate of deterministicSpawnCandidates(eventPos, lastMain, channel)) {
		const distance = Math.hypot(candidate.x - spawnPos.x, candidate.y - spawnPos.y);
		if (!best || distance < best.distance) {
			best = { ...candidate, distance };
		}
	}
	return best || { b: 5, x: autoX(eventPos.x), y: eventPos.y, distance: Infinity };
}
