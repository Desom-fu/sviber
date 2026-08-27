// Chart checks: every rule of the "Chart checks" section, its parameters and the
// navigation target used when a violation is clicked in the checks panel.

import { Rational } from "./rational.js";
import { DIFFICULTY_COLORS } from "./chart-model.js";
import { CHART_BOUNDS, resolveAttachedPosition } from "./geometry.js";
import { buildTipPointGuides } from "../render/stage-helpers.js";
import { CHECK_DEFINITIONS, CHECK_IDS, defaultChecks, normalizeChecks } from "./checks-config.js";

export { CHECK_DEFINITIONS, CHECK_IDS, defaultChecks, normalizeChecks };

export const CHECK_EPSILON = 1e-6;

const NOTE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
const FINGER_DOWN_TYPES = new Set(["tap", "hold", "flick"]);
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
const TEXT_TYPES = new Set(["tap", "hold", "flick", "bgNote"]);
const REGULAR_DIFFICULTY_NAMES = ["Easy", "Normal", "Hard", "Master", "Special"];
const INTEGER_DIFFICULTY_NAMES = new Set(["Easy", "Normal", "Hard", "Master"]);
// Unified ideographs, compatibility ideographs, kana, Hangul and CJK punctuation.
const CJK_PATTERN =
	/[\u2e80-\u303f\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;

function eventPosition(event, snappees) {
	return resolveAttachedPosition(event, snappees) ?? { x: Number(event.x) || 0, y: Number(event.y) || 0 };
}

function spawnPosition(settings, targetPosition, snappees) {
	if (!settings.tipPointSpawnAbsolutePosition) {
		const distance = Math.max(0, Number(settings.tipPointSpawnDistance ?? 100));
		const angle = Number(settings.tipPointSpawnAngle ?? Math.PI / 2);
		return {
			x: targetPosition.x + distance * Math.cos(angle),
			y: targetPosition.y + distance * Math.sin(angle),
		};
	}
	return (
		resolveAttachedPosition(settings, snappees, { prefix: "tipPointSpawn" }) ?? {
			x: Number(settings.tipPointSpawnX) || 0,
			y: Number(settings.tipPointSpawnY ?? 100),
		}
	);
}

function withinBounds(position) {
	return (
		position.x >= CHART_BOUNDS.minX - CHECK_EPSILON &&
		position.x <= CHART_BOUNDS.maxX + CHECK_EPSILON &&
		position.y >= CHART_BOUNDS.minY - CHECK_EPSILON &&
		position.y <= CHART_BOUNDS.maxY + CHECK_EPSILON
	);
}

function violation(check, options = {}) {
	return {
		check,
		time: options.time ?? null,
		eventIds: options.eventIds || [],
		target: options.target || "event",
		params: options.params || {},
	};
}

function checkMetadata(model, violations) {
	const metadata = model.metadata || {};
	for (const field of ["title", "artist", "charter"]) {
		if (!String(metadata[field] ?? "").trim()) {
			violations.push(violation("emptyMetadata", { target: "chartProperties", params: { field } }));
		}
	}
}

function difficultyIsValidInteger(value) {
	return /^[1-9][0-9]*$/.test(String(value ?? "").trim());
}

function checkDifficulty(model, violations) {
	const metadata = model.metadata || {};
	const name = String(metadata.difficultyName ?? "").trim();
	const report = reason =>
		violations.push(violation("irregularDifficulty", { target: "chartProperties", params: { reason } }));
	if (!REGULAR_DIFFICULTY_NAMES.includes(name)) {
		report("name");
		return;
	}
	const expectedColor = DIFFICULTY_COLORS[name.toLowerCase()];
	if (expectedColor && String(metadata.difficultyColor ?? "").toLowerCase() !== expectedColor) {
		report("color");
	}
	const difficulty = String(metadata.difficulty ?? "").trim();
	const isInteger = difficultyIsValidInteger(difficulty);
	if (INTEGER_DIFFICULTY_NAMES.has(name) && !isInteger) {
		report("difficulty");
	} else if (!INTEGER_DIFFICULTY_NAMES.has(name) && !isInteger && [...difficulty].length !== 1) {
		report("difficulty");
	}
	const superscript = String(metadata.difficultySup ?? "");
	const allowsPlus = isInteger && Number(difficulty) > 6;
	if (allowsPlus ? superscript !== "" && superscript !== "+" : superscript !== "") {
		report("superscript");
	}
}

// Canonical play style: every tap/hold/flick needs a finger press, drags only need a
// finger to be at the right place, and the finger holding a `hold` cannot leave it.
function positionKey(point) {
	return `${point.x.toFixed(4)}:${point.y.toFixed(4)}`;
}

function reportFingerViolation(violations, record, limit) {
	violations.push(
		violation("requiredFingers", {
			time: record.start,
			eventIds: [record.event.id],
			params: { fingers: limit },
		}),
	);
}

function checkRequiredFingers(context, violations) {
	const limit = Math.max(1, Math.floor(context.settings.requiredFingers.fingers));
	const notes = context.leafEvents
		.filter(event => NOTE_TYPES.has(event.type))
		.map(event => ({ event, start: context.startOf(event), end: context.endOf(event) }))
		.sort((left, right) => left.start - right.start || left.event.id - right.event.id);
	const heldUntil = [];
	for (let index = 0; index < notes.length; ) {
		const time = notes[index].start;
		const simultaneous = [];
		while (index < notes.length && notes[index].start <= time + CHECK_EPSILON) {
			simultaneous.push(notes[index]);
			index += 1;
		}
		for (let slot = heldUntil.length - 1; slot >= 0; slot -= 1) {
			if (heldUntil[slot] < time - CHECK_EPSILON) {
				heldUntil.splice(slot, 1);
			}
		}
		const downs = simultaneous.filter(record => FINGER_DOWN_TYPES.has(record.event.type));
		const drags = simultaneous.filter(record => record.event.type === "drag");
		let used = heldUntil.length;
		let movableHolds = heldUntil.length;
		const covered = new Set();
		for (const record of downs) {
			used += 1;
			covered.add(positionKey(context.positionOf(record.event)));
			if (used > limit) {
				reportFingerViolation(violations, record, limit);
			}
			if (record.event.type === "hold") {
				heldUntil.push(record.end);
			}
		}
		const dragPositions = new Set();
		for (const record of drags) {
			const key = positionKey(context.positionOf(record.event));
			if (covered.has(key) || dragPositions.has(key)) {
				continue;
			}
			dragPositions.add(key);
			if (movableHolds > 0) {
				movableHolds -= 1;
				continue;
			}
			used += 1;
			if (used > limit) {
				reportFingerViolation(violations, record, limit);
			}
		}
	}
}

function checkBoundaries(context, violations) {
	for (const event of context.leafEvents) {
		const isNote = NOTE_TYPES.has(event.type);
		const isBgNote = event.type === "bgNote";
		if (!isNote && !isBgNote) {
			continue;
		}
		if (withinBounds(context.positionOf(event))) {
			continue;
		}
		const check = isNote ? "outOfBoundaryNotes" : "outOfBoundaryBgNotes";
		if (!context.settings[check].enabled) {
			continue;
		}
		violations.push(violation(check, { time: context.startOf(event), eventIds: [event.id] }));
	}
}

function checkDurations(context, violations) {
	for (const event of context.leafEvents) {
		const isHold = event.type === "hold";
		const isPattern = PATTERN_TYPES.has(event.type);
		if (!isHold && !isPattern) {
			continue;
		}
		const check = isHold ? "shortHold" : "shortBgPattern";
		if (!context.settings[check].enabled) {
			continue;
		}
		const minimum = Math.max(0, Number(context.settings[check].seconds));
		const duration = context.endOf(event) - context.startOf(event);
		if (duration >= minimum - CHECK_EPSILON) {
			continue;
		}
		violations.push(
			violation(check, {
				time: context.startOf(event),
				eventIds: [event.id],
				params: { seconds: minimum },
			}),
		);
	}
}

function tipPointCheckpoints(guide, context) {
	const points = guide.events.map(event => ({ event, ...context.positionOf(event), time: context.startOf(event) }));
	const spawn = spawnPosition(guide.spawnSettings, points[0], context.snappees);
	return [{ event: null, x: spawn.x, y: spawn.y, time: guide.spawnTime }, ...points];
}

function checkTipPointLifetime(guide, context, violations) {
	const minimum = Math.max(0, Number(context.settings.shortTipPoint.seconds));
	const lifetime = guide.endTime - guide.spawnTime;
	if (lifetime >= minimum - CHECK_EPSILON) {
		return;
	}
	violations.push(
		violation("shortTipPoint", {
			time: guide.spawnTime,
			eventIds: [guide.events[0].id],
			params: { seconds: minimum },
		}),
	);
}

// Consecutive checkpoints at the same time and position count as a single turning
// point, so they are collapsed before measuring the turn angles.
function collapseCheckpoints(points) {
	const result = [];
	for (const point of points) {
		const last = result.at(-1);
		const sameSpot =
			last && Math.abs(last.x - point.x) < CHECK_EPSILON && Math.abs(last.y - point.y) < CHECK_EPSILON;
		if (sameSpot) {
			last.events.push(point.event);
			continue;
		}
		result.push({ ...point, events: [point.event] });
	}
	return result;
}

function checkSharpTurns(guide, context, violations) {
	const points = collapseCheckpoints(tipPointCheckpoints(guide, context));
	for (let index = 1; index + 1 < points.length; index += 1) {
		const incoming = Math.atan2(points[index].y - points[index - 1].y, points[index].x - points[index - 1].x);
		const outgoing = Math.atan2(points[index + 1].y - points[index].y, points[index + 1].x - points[index].x);
		let turn = Math.abs(outgoing - incoming) % (2 * Math.PI);
		if (turn > Math.PI) {
			turn = 2 * Math.PI - turn;
		}
		if (Math.PI - turn > 1e-3) {
			continue;
		}
		const event = points[index].events.find(Boolean);
		violations.push(
			violation("sharpTipPointTurn", {
				time: points[index].time,
				eventIds: event ? [event.id] : [],
			}),
		);
	}
}

function checkTeleportingTipPoint(guide, context, violations) {
	for (let index = 1; index < guide.events.length; index += 1) {
		const previous = guide.events[index - 1];
		const current = guide.events[index];
		if (Math.abs(context.startOf(previous) - context.startOf(current)) > CHECK_EPSILON) {
			continue;
		}
		const first = context.positionOf(previous);
		const second = context.positionOf(current);
		if (Math.abs(first.x - second.x) < CHECK_EPSILON && Math.abs(first.y - second.y) < CHECK_EPSILON) {
			continue;
		}
		violations.push(
			violation("teleportingTipPoint", {
				time: context.startOf(current),
				eventIds: [previous.id, current.id],
			}),
		);
	}
}

function checkTipPoints(context, violations) {
	const settings = context.settings;
	const anyEnabled =
		settings.shortTipPoint.enabled || settings.sharpTipPointTurn.enabled || settings.teleportingTipPoint.enabled;
	if (!anyEnabled) {
		return;
	}
	const project = {
		channels: context.channels,
		events: context.leafEvents.filter(event => NOTE_TYPES.has(event.type)),
	};
	for (const guide of buildTipPointGuides(project, context.timing)) {
		if (!guide.events.length) {
			continue;
		}
		if (settings.shortTipPoint.enabled) {
			checkTipPointLifetime(guide, context, violations);
		}
		if (settings.sharpTipPointTurn.enabled) {
			checkSharpTurns(guide, context, violations);
		}
		if (settings.teleportingTipPoint.enabled) {
			checkTeleportingTipPoint(guide, context, violations);
		}
	}
}

function checkCjkTexts(context, violations) {
	for (const event of context.leafEvents) {
		if (!TEXT_TYPES.has(event.type)) {
			continue;
		}
		const text = String(event.text ?? "");
		if (!CJK_PATTERN.test(text) || [...text].length === 1) {
			continue;
		}
		violations.push(violation("multiCharacterCjk", { time: context.startOf(event), eventIds: [event.id] }));
	}
}

function checkEventsOutsideMusic(context, violations) {
	const music = context.music;
	if (!music || !Number.isFinite(music.duration)) {
		return;
	}
	const start = Number(music.start ?? 0);
	for (const event of context.leafEvents) {
		const from = context.startOf(event);
		const to = context.endOf(event);
		if (from >= start - CHECK_EPSILON && to <= music.duration + CHECK_EPSILON) {
			continue;
		}
		violations.push(violation("eventsOutsideMusic", { time: from, eventIds: [event.id] }));
	}
}

function buildContext(model, options) {
	const timing = model.timing;
	const settings = normalizeChecks(options.checks ?? model.checks);
	const snappees = model.snappees || [];
	const leafEvents = model.allEvents({ includeGroups: false }).filter(event => event.type !== "comment");
	const startCache = new Map();
	const endCache = new Map();
	const positionCache = new Map();
	const startOf = event => {
		if (!startCache.has(event.id)) {
			startCache.set(event.id, timing.beatToSeconds(event.time));
		}
		return startCache.get(event.id);
	};
	const endOf = event => {
		if (!endCache.has(event.id)) {
			const duration = event.duration ? timing.durationToSeconds(event.time, event.duration) : 0;
			endCache.set(event.id, startOf(event) + Math.max(0, duration));
		}
		return endCache.get(event.id);
	};
	const positionOf = event => {
		if (!positionCache.has(event.id)) {
			positionCache.set(event.id, eventPosition(event, snappees));
		}
		return positionCache.get(event.id);
	};
	return {
		model,
		timing,
		settings,
		snappees,
		leafEvents,
		startOf,
		endOf,
		positionOf,
		channels: model.channels || [],
		music: options.music || null,
	};
}

export function runChecks(model, options = {}) {
	const context = buildContext(model, options);
	const settings = context.settings;
	const violations = [];
	if (settings.emptyMetadata.enabled) {
		checkMetadata(model, violations);
	}
	if (settings.irregularDifficulty.enabled) {
		checkDifficulty(model, violations);
	}
	if (settings.requiredFingers.enabled) {
		checkRequiredFingers(context, violations);
	}
	if (settings.outOfBoundaryNotes.enabled || settings.outOfBoundaryBgNotes.enabled) {
		checkBoundaries(context, violations);
	}
	if (settings.shortHold.enabled || settings.shortBgPattern.enabled) {
		checkDurations(context, violations);
	}
	checkTipPoints(context, violations);
	if (settings.multiCharacterCjk.enabled) {
		checkCjkTexts(context, violations);
	}
	if (settings.eventsOutsideMusic.enabled) {
		checkEventsOutsideMusic(context, violations);
	}
	// Violations without a time sort to the top; the rest sort by time.
	return violations.sort((left, right) => {
		if (left.time == null && right.time == null) {
			return CHECK_IDS.indexOf(left.check) - CHECK_IDS.indexOf(right.check);
		}
		if (left.time == null) {
			return -1;
		}
		if (right.time == null) {
			return 1;
		}
		return left.time - right.time || CHECK_IDS.indexOf(left.check) - CHECK_IDS.indexOf(right.check);
	});
}

export function checkBeat(timing, seconds) {
	try {
		return Rational.from(timing.secondsToBeat(seconds)).toNumber();
	} catch {
		return null;
	}
}
