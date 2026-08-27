// Event construction and tip-point chain wiring. This is the single place that decides
// which fields an event of a given type is allowed to carry: `createEvent` strips every
// field the type cannot use and fills in the ones it must have, `normalizeEventTree`
// applies that to a whole (possibly nested) event list, and `connectSelectedTipPointChain`
// rewrites the spawn modes of a contiguous run of notes into one trail.
// Split out of js/core/chart-model.js.

import { Rational } from "./rational.js";
import {
	DURATION_TYPES,
	EVENT_TYPE_SET,
	MOVABLE_TYPES,
	POSITION_FIELDS,
	TEXT_TYPES,
	TIP_POINTABLE_TYPES,
	TIP_POINT_FIELDS,
	TIP_SPAWN_TYPES,
} from "./chart-vocabulary.js";
import {
	clone,
	finiteNumber,
	normalizeColor,
	normalizeDuration,
	normalizeEventType,
	normalizeSnapPoint,
	validId,
} from "./chart-normalize.js";

export function normalizeTipPointFields(event, source) {
	event.tipPointSpawnType = TIP_SPAWN_TYPES.has(source.tipPointSpawnType) ? source.tipPointSpawnType : "inherit";
	event.tipPointSpawnAbsolutePosition = Boolean(source.tipPointSpawnAbsolutePosition);
	if (event.tipPointSpawnAbsolutePosition) {
		event.tipPointSpawnAttached = Boolean(source.tipPointSpawnAttached);
		if (event.tipPointSpawnAttached) {
			event.tipPointSpawnSnappee = source.tipPointSpawnSnappee ?? null;
			event.tipPointSpawnSnapPoint = normalizeSnapPoint(source.tipPointSpawnSnapPoint ?? 0);
			delete event.tipPointSpawnX;
			delete event.tipPointSpawnY;
		} else {
			event.tipPointSpawnX = finiteNumber(source.tipPointSpawnX, 0);
			event.tipPointSpawnY = finiteNumber(source.tipPointSpawnY, 100);
			delete event.tipPointSpawnSnappee;
			delete event.tipPointSpawnSnapPoint;
		}
		delete event.tipPointSpawnDistance;
		delete event.tipPointSpawnAngle;
	} else {
		event.tipPointSpawnDistance = Math.max(0, finiteNumber(source.tipPointSpawnDistance, 100));
		event.tipPointSpawnAngle = finiteNumber(source.tipPointSpawnAngle, Math.PI / 2);
		delete event.tipPointSpawnAttached;
		delete event.tipPointSpawnX;
		delete event.tipPointSpawnY;
		delete event.tipPointSpawnSnappee;
		delete event.tipPointSpawnSnapPoint;
	}
	event.tipPointSpawnTimeBeats = Boolean(source.tipPointSpawnTimeBeats);
	if (event.tipPointSpawnTimeBeats) {
		let spawnTime;
		try {
			spawnTime = Rational.from(source.tipPointSpawnTime ?? 1);
		} catch {
			spawnTime = Rational.from(1);
		}
		event.tipPointSpawnTime = (spawnTime.compare(0) < 0 ? spawnTime.negate() : spawnTime).toJSON();
	} else {
		event.tipPointSpawnTime = Math.max(0, finiteNumber(source.tipPointSpawnTime, 1));
	}
}

// Drops every field the event type cannot carry. Copied overrides may come from another
// event type entirely (duplicating a hold as a tap, for instance), so this runs both
// before and after the per-capability defaults are filled in.
function stripUnsupportedFields(event, type) {
	if (!MOVABLE_TYPES.has(type)) {
		POSITION_FIELDS.forEach(field => delete event[field]);
	}
	if (!DURATION_TYPES.has(type)) {
		delete event.duration;
	}
	if (!TEXT_TYPES.has(type)) {
		delete event.text;
	}
	if (type !== "flick") {
		delete event.angle;
	}
	if (!TIP_POINTABLE_TYPES.has(type)) {
		TIP_POINT_FIELDS.forEach(field => delete event[field]);
	}
}

// A movable event is positioned either by absolute coordinates or by a snappee snap point,
// never by both, so the unused pair of fields is removed rather than left stale.
function applyPosition(event, type, overrides) {
	if (!MOVABLE_TYPES.has(type)) {
		delete event.attached;
		delete event.x;
		delete event.y;
		delete event.snappee;
		delete event.snapPoint;
		return;
	}
	event.attached = Boolean(overrides.attached);
	if (event.attached) {
		event.snappee = overrides.snappee ?? null;
		event.snapPoint = normalizeSnapPoint(overrides.snapPoint ?? 0);
		delete event.x;
		delete event.y;
	} else {
		event.x = finiteNumber(overrides.x, 0);
		event.y = finiteNumber(overrides.y, 0);
		delete event.snappee;
		delete event.snapPoint;
	}
}

function applyCapabilities(event, type, overrides) {
	applyPosition(event, type, overrides);
	if (DURATION_TYPES.has(type)) {
		event.duration = normalizeDuration(overrides.duration, type);
	} else {
		delete event.duration;
	}
	if (TEXT_TYPES.has(type)) {
		event.text = String(overrides.text ?? "");
	} else {
		delete event.text;
	}
	if (type === "flick") {
		event.angle = finiteNumber(overrides.angle, Math.PI / 2);
	} else {
		delete event.angle;
	}
	if (TIP_POINTABLE_TYPES.has(type)) {
		normalizeTipPointFields(event, overrides);
	} else {
		for (const key of Object.keys(event)) {
			if (key.startsWith("tipPoint")) {
				delete event[key];
			}
		}
	}
}

// Groups hold their members instead of a time and a channel, so they get their own pass.
function applyGrouping(event, type, overrides) {
	if (type !== "group") {
		delete event.events;
		delete event.color;
		return;
	}
	event.color = normalizeColor(overrides.color, "#ff9d3d");
	event.events = (Array.isArray(overrides.events) ? overrides.events : []).map(child =>
		createEvent(child.type, child),
	);
	delete event.time;
	delete event.channel;
}

export function createEvent(type, overrides = {}) {
	type = normalizeEventType(type);
	if (!EVENT_TYPE_SET.has(type)) {
		throw new TypeError(`Unsupported event type: ${type}`);
	}
	const event = {
		...clone(overrides),
		id: validId(overrides.id) ? overrides.id : null,
		type,
		time: Rational.from(overrides.time ?? 0).toJSON(),
		selected: Boolean(overrides.selected),
		channel: validId(overrides.channel) ? overrides.channel : 0,
	};
	stripUnsupportedFields(event, type);
	applyCapabilities(event, type, overrides);
	applyGrouping(event, type, overrides);
	return event;
}

// Rebuilds a stored event list through `createEvent`, handing out ids that no sibling or
// descendant already claims and pinning orphaned events back onto the first channel.
export function normalizeEventTree(items, channels) {
	const used = new Set();
	let next = 0;
	const visit = source => {
		const raw = source && typeof source === "object" ? source : {};
		let id = validId(raw.id) && !used.has(raw.id) ? raw.id : next;
		while (used.has(id)) {
			id += 1;
		}
		used.add(id);
		next = Math.max(next, id + 1);
		const event = createEvent(raw.type, { ...raw, id });
		if (event.type === "group") {
			event.events = (raw.events || []).map(visit);
		} else if (!channels.some(channel => channel.id === event.channel)) {
			event.channel = channels[0].id;
		}
		return event;
	};
	return (Array.isArray(items) ? items : []).map(visit);
}

export function connectSelectedTipPointChain(events) {
	const indexed = (events || []).map((event, sequence) => ({ event, sequence }));
	const selectedRecords = indexed.filter(({ event }) => event.selected);
	if (selectedRecords.length < 2 || selectedRecords.some(({ event }) => !TIP_POINTABLE_TYPES.has(event.type))) {
		return { ok: false, reason: "selection" };
	}
	const channel = selectedRecords[0].event.channel;
	if (selectedRecords.some(({ event }) => event.channel !== channel)) {
		return { ok: false, reason: "channel" };
	}

	const selectedEvents = new Set(selectedRecords.map(({ event }) => event));
	const channelEvents = indexed
		.filter(({ event }) => event.channel === channel && TIP_POINTABLE_TYPES.has(event.type))
		.toSorted(
			(left, right) => Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence,
		);
	const selectedIndexes = channelEvents
		.map(({ event }, index) => (selectedEvents.has(event) ? index : -1))
		.filter(index => index >= 0);
	const firstIndex = selectedIndexes[0];
	const lastIndex = selectedIndexes.at(-1);
	if (lastIndex - firstIndex + 1 !== selectedIndexes.length) {
		return { ok: false, reason: "contiguous" };
	}

	channelEvents[firstIndex].event.tipPointSpawnType = "chain";
	for (let index = firstIndex + 1; index <= lastIndex; index += 1) {
		channelEvents[index].event.tipPointSpawnType = "inherit";
	}
	const nextEvent = channelEvents[lastIndex + 1]?.event;
	const stoppedEventId = nextEvent?.tipPointSpawnType === "inherit" ? nextEvent.id : null;
	if (stoppedEventId != null) {
		nextEvent.tipPointSpawnType = "none";
	}
	return {
		ok: true,
		eventIds: channelEvents.slice(firstIndex, lastIndex + 1).map(({ event }) => event.id),
		stoppedEventId,
	};
}
