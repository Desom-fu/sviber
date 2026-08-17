import { Rational } from "./rational.js";
import { TimingMap } from "./timing.js";
import {
	IDENTITY_TRANSFORM,
	SNAPPEE_TYPES,
	normalizeTransform,
	resolveAttachedPosition,
} from "./geometry.js";

export const SUNNIESNOW_SCHEMA = "https://sunniesnow.github.io/schema/chart-1.0.json";

export const EVENT_TYPES = Object.freeze([
	"tap", "hold", "drag", "flick", "bgNote", "bigText",
	"grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram", "comment",
]);

export const DIFFICULTY_COLORS = Object.freeze({
	easy: "#3eb9fd",
	normal: "#f19e56",
	hard: "#e75e74",
	master: "#8c68f3",
	special: "#f156ee",
});

const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const SNAPPEE_TYPE_SET = new Set(SNAPPEE_TYPES);
const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote"]);
const TIP_POINTABLE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
const DURATION_TYPES = new Set([
	"hold", "bgNote", "bigText", "grid", "hexagon", "checkerboard",
	"diamondGrid", "pentagon", "turntable", "hexagram", "comment",
]);
const TEXT_TYPES = new Set(["tap", "hold", "flick", "bgNote", "bigText", "comment"]);
const POSITIVE_DURATION_TYPES = new Set([
	"hold", "bigText", "grid", "hexagon", "checkerboard",
	"diamondGrid", "pentagon", "turntable", "hexagram",
]);
const TIP_SPAWN_TYPES = new Set(["inherit", "chain", "drop", "none"]);
const POSITION_FIELDS = ["attached", "x", "y", "snappee", "snapPoint"];
const TIP_POINT_FIELDS = [
	"tipPointSpawnType", "tipPointSpawnAbsolutePosition", "tipPointSpawnAttached",
	"tipPointSpawnX", "tipPointSpawnY", "tipPointSpawnSnappee", "tipPointSpawnSnapPoint",
	"tipPointSpawnDistance", "tipPointSpawnAngle", "tipPointSpawnTimeBeats", "tipPointSpawnTime",
];

const DEFAULT_METADATA = Object.freeze({
	title: "Untitled",
	artist: "",
	charter: "",
	difficultyName: "Normal",
	difficultyColor: DIFFICULTY_COLORS.normal,
	difficulty: "",
	difficultySup: "",
});

const DEFAULT_EDITOR = Object.freeze({
	timeSnapped: true,
	subdivision: 2,
	currentTime: [0, 0, 1],
	visibleRangeBeginning: 0,
	visibleRangeEnd: 10,
	speed: 1,
	currentChannel: 0,
	allowOutOfBounds: false,
});

function clone(value) {
	if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback = 0) {
	const result = Number(value);
	return Number.isFinite(result) ? result : fallback;
}

function positiveInteger(value, fallback) {
	const result = Number(value);
	return Number.isSafeInteger(result) && result > 0 ? result : fallback;
}

function validId(value) {
	return Number.isSafeInteger(value) && value >= 0;
}

function normalizeColor(value, fallback = "#7f7f7f") {
	if (typeof value === "string" && value.trim()) return value;
	if (Number.isSafeInteger(value) && value >= 0 && value <= 0xffffff) return value;
	return fallback;
}

function normalizeEventType(type) {
	const aliases = {
		bg_note: "bgNote",
		big_text: "bigText",
		diamond_grid: "diamondGrid",
	};
	return aliases[type] ?? type;
}

function normalizeMetadata(source = {}) {
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

function normalizeDuration(value, type) {
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

function normalizeSnapPoint(value) {
	if (Array.isArray(value)) return value.map((item) => Number(item));
	return Number(value);
}

function normalizeTipPointFields(event, source) {
	event.tipPointSpawnType = TIP_SPAWN_TYPES.has(source.tipPointSpawnType)
		? source.tipPointSpawnType
		: "inherit";
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

export function createEvent(type, overrides = {}) {
	type = normalizeEventType(type);
	if (!EVENT_TYPE_SET.has(type)) throw new TypeError(`Unsupported event type: ${type}`);
	const event = {
		...clone(overrides),
		id: validId(overrides.id) ? overrides.id : null,
		type,
		time: Rational.from(overrides.time ?? 0).toJSON(),
		selected: Boolean(overrides.selected),
		channel: validId(overrides.channel) ? overrides.channel : 0,
	};
	if (!MOVABLE_TYPES.has(type)) POSITION_FIELDS.forEach(field => delete event[field]);
	if (!DURATION_TYPES.has(type)) delete event.duration;
	if (!TEXT_TYPES.has(type)) delete event.text;
	if (type !== "flick") delete event.angle;
	if (!TIP_POINTABLE_TYPES.has(type)) TIP_POINT_FIELDS.forEach(field => delete event[field]);

	if (MOVABLE_TYPES.has(type)) {
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
	else {
		delete event.attached;
		delete event.x;
		delete event.y;
		delete event.snappee;
		delete event.snapPoint;
	}
	if (DURATION_TYPES.has(type)) event.duration = normalizeDuration(overrides.duration, type);
	else delete event.duration;
	if (TEXT_TYPES.has(type)) event.text = String(overrides.text ?? "");
	else delete event.text;
	if (type === "flick") event.angle = finiteNumber(overrides.angle, Math.PI / 2);
	else delete event.angle;
	if (TIP_POINTABLE_TYPES.has(type)) normalizeTipPointFields(event, overrides);
	else {
		for (const key of Object.keys(event)) {
			if (key.startsWith("tipPoint")) delete event[key];
		}
	}
	return event;
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
		.toSorted((left, right) => Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence);
	const selectedIndexes = channelEvents
		.map(({ event }, index) => selectedEvents.has(event) ? index : -1)
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
	if (stoppedEventId != null) nextEvent.tipPointSpawnType = "none";
	return {
		ok: true,
		eventIds: channelEvents.slice(firstIndex, lastIndex + 1).map(({ event }) => event.id),
		stoppedEventId,
	};
}

function defaultSnappeeFields(type) {
	switch (type) {
		case "rectangularMesh":
			return { topLeftX: -100, topLeftY: 50, bottomRightX: 100, bottomRightY: -50, horizontalTiles: 16, verticalTiles: 8 };
		case "radialMesh":
			return { centerX: 0, centerY: 0, radius: 50, azimuthalTiles: 8, radialTiles: 4, startingAngle: 0 };
		case "parametricMesh":
			return { iRange: [-4, 5], iRangeExclusive: true, jRange: [-2, 3], jRangeExclusive: true, xExpression: "i * 25", yExpression: "j * 25" };
		case "regularPolygonCurve":
			return { centerX: 0, centerY: 0, angle: Math.PI / 2, radius: 50, sides: 5, segmentsPerSide: 4, closed: true };
		case "bezierCurve":
			return { degree: 3, controlPoints: [{ x: -75, y: 0 }, { x: -25, y: 50 }, { x: 25, y: -50 }, { x: 75, y: 0 }], segments: 16, closed: false };
		case "circularArcCurve":
			return { centerX: 0, centerY: 0, radius: 50, closed: false, beginningAngle: 0, endAngle: Math.PI, clockwise: false, segments: 16 };
		case "penCurve":
			return { commands: [{ type: "M", x: -50, y: 0 }, { type: "L", x: 50, y: 0 }], segments: 8, closed: false };
		case "parametricCurve":
			return { iRange: [0, 16], iRangeExclusive: true, xExpression: "50 * cos(2 * pi * i / 16)", yExpression: "50 * sin(2 * pi * i / 16)", closed: true };
		default:
			throw new TypeError(`Unsupported snappee type: ${type}`);
	}
}

export function createSnappee(type, overrides = {}) {
	if (!SNAPPEE_TYPE_SET.has(type)) throw new TypeError(`Unsupported snappee type: ${type}`);
	let transformation;
	try {
		transformation = normalizeTransform(overrides.transformation ?? IDENTITY_TRANSFORM);
	} catch {
		transformation = [...IDENTITY_TRANSFORM];
	}
	const snappee = {
		...defaultSnappeeFields(type),
		...clone(overrides),
		id: validId(overrides.id) ? overrides.id : null,
		name: String(overrides.name ?? type),
		color: normalizeColor(overrides.color, "#00e0ad"),
		type,
		transformation,
		active: Boolean(overrides.active ?? true),
		selected: Boolean(overrides.selected),
	};
	if (type === "radialMesh") snappee.startingAngle = finiteNumber(overrides.startingAngle ?? overrides.angle, 0);
	if (type === "regularPolygonCurve") {
		snappee.sides = positiveInteger(overrides.sides ?? overrides.numberOfSides ?? snappee.sides, 3);
	}
	return snappee;
}

export function createDefaultSnappees() {
	return [
		createSnappee("rectangularMesh", {
			name: "Playfield grid", topLeftX: -100, topLeftY: 50,
			bottomRightX: 100, bottomRightY: -50, horizontalTiles: 16, verticalTiles: 8,
		}),
		createSnappee("radialMesh", {
			name: "Radial grid", centerX: 0, centerY: 0, radius: 50,
			azimuthalTiles: 16, radialTiles: 4, active: false,
		}),
		createSnappee("regularPolygonCurve", {
			name: "Outer hexagon", centerX: 0, centerY: 0, radius: 100 / Math.sqrt(3),
			angle: 0, sides: 6, segmentsPerSide: 4, active: false,
		}),
		createSnappee("regularPolygonCurve", {
			name: "Middle hexagon", centerX: 0, centerY: 0, radius: 50,
			angle: Math.PI / 2, sides: 6, segmentsPerSide: 4, active: false,
		}),
		createSnappee("regularPolygonCurve", {
			name: "Inner hexagon", centerX: 0, centerY: 0, radius: 50 / Math.sqrt(3),
			angle: 0, sides: 6, segmentsPerSide: 2, active: false,
		}),
		createSnappee("regularPolygonCurve", {
			name: "Pentagon", centerX: 0, centerY: 20 * Math.sqrt(5) - 50,
			radius: 100 - 20 * Math.sqrt(5), angle: Math.PI / 2,
			sides: 5, segmentsPerSide: 4, active: false,
		}),
	];
}

function assignStableIds(items, factory) {
	const used = new Set();
	let next = 0;
	return (Array.isArray(items) ? items : []).map((item, index) => {
		let id = item?.id;
		if (!validId(id) || used.has(id)) {
			while (used.has(next)) next += 1;
			id = next;
		}
		used.add(id);
		next = Math.max(next, id + 1);
		return factory(item, id, index);
	});
}

function normalizeChannels(channels) {
	const source = Array.isArray(channels) && channels.length ? channels : [{ id: 0 }];
	return assignStableIds(source, (channel, id, index) => ({
		...clone(channel ?? {}),
		id,
		name: String(channel?.name ?? `Channel ${index + 1}`),
		active: channel?.active !== false,
	}));
}

function normalizeEditor(editor, channels) {
	const source = editor ?? {};
	const subdivision = positiveInteger(source.subdivision, DEFAULT_EDITOR.subdivision);
	const timeSnapped = source.timeSnapped ?? true;
	let currentTime;
	try {
		currentTime = timeSnapped
			? Rational.from(source.currentTime ?? DEFAULT_EDITOR.currentTime).toJSON()
			: finiteNumber(source.currentTime, 0);
	} catch {
		currentTime = timeSnapped ? [...DEFAULT_EDITOR.currentTime] : 0;
	}
	const channelIds = new Set(channels.map(({ id }) => id));
	const requestedChannel = channelIds.has(source.currentChannel) ? source.currentChannel : channels[0].id;
	const requested = channels.find(channel => channel.id === requestedChannel);
	const activeFallback = channels.find(channel => channel.active !== false);
	return {
		timeSnapped: Boolean(timeSnapped),
		subdivision,
		currentTime,
		visibleRangeBeginning: finiteNumber(source.visibleRangeBeginning, DEFAULT_EDITOR.visibleRangeBeginning),
		visibleRangeEnd: finiteNumber(source.visibleRangeEnd, DEFAULT_EDITOR.visibleRangeEnd),
		speed: Math.max(0.01, finiteNumber(source.speed, DEFAULT_EDITOR.speed)),
		currentChannel: requested?.active !== false || !activeFallback ? requestedChannel : activeFallback.id,
		allowOutOfBounds: Boolean(source.allowOutOfBounds),
	};
}

function parseSource(source) {
	if (typeof source === "string") return JSON.parse(source);
	if (!source || typeof source !== "object") throw new TypeError("chart data must be an object or JSON string");
	return source;
}

function nextCounter(items, provided) {
	const derived = items.reduce((maximum, item) => Math.max(maximum, item.id + 1), 0);
	return validId(provided) ? Math.max(derived, provided) : derived;
}

export class ChartModel {
	constructor(state = {}) {
		this.metadata = normalizeMetadata(state);
		this.music = typeof state.music === "string" ? state.music : "";
		this.image = typeof state.image === "string" ? state.image : "";
		this.timing = state.timing instanceof TimingMap ? state.timing.clone() : new TimingMap(state.timing ?? {});
		this.channels = normalizeChannels(state.channels);
		this.editor = normalizeEditor(state.editor, this.channels);
		this.snappees = assignStableIds(state.snappees, (snappee, id) => createSnappee(snappee.type, { ...snappee, id }));
		for (const snappee of this.snappees) {
			if (snappee.active === false) snappee.selected = false;
		}
		const validChannels = new Set(this.channels.map(({ id }) => id));
		const activeChannels = new Set(this.channels
			.filter(channel => channel.active !== false).map(channel => channel.id));
		this.events = assignStableIds(state.events, (event, id) => {
			const normalized = createEvent(event.type, { ...event, id });
			if (!validChannels.has(normalized.channel)) normalized.channel = this.channels[0].id;
			if (!activeChannels.has(normalized.channel)) normalized.selected = false;
			return normalized;
		});
		const nextIds = state.nextIds ?? {};
		this._nextChannelId = nextCounter(this.channels, nextIds.channel);
		this._nextEventId = nextCounter(this.events, nextIds.event);
		this._nextSnappeeId = nextCounter(this.snappees, nextIds.snappee);
		this.importWarnings = Array.isArray(state.importWarnings) ? [...state.importWarnings] : [];
	}

	static createDefault(overrides = {}) {
		return new ChartModel({
			metadata: DEFAULT_METADATA,
			music: "",
			image: "",
			editor: DEFAULT_EDITOR,
			timing: { offset: 0, initialBpm: 120, bpmChanges: [] },
			channels: [{ id: 0 }],
			events: [],
			snappees: createDefaultSnappees(),
			...clone(overrides),
		});
	}

	static import(source, options = {}) {
		const document = parseSource(source);
		return document.sviber && typeof document.sviber === "object"
			? ChartModel._importSviber(document)
			: ChartModel._importSunniesnow(document, options);
	}

	static fromJSON(source, options = {}) {
		return ChartModel.import(source, options);
	}

	static _importSviber(document) {
		return new ChartModel({
			...clone(document.sviber),
			metadata: normalizeMetadata(document),
		});
	}

	static _importSunniesnow(document, options) {
		const warnings = [];
		const timingOptions = options.timing ?? options;
		const timing = new TimingMap({
			offset: timingOptions.offset ?? 0,
			initialBpm: timingOptions.initialBpm ?? 120,
			bpmChanges: timingOptions.bpmChanges ?? [],
		});
		const maxDenominator = positiveInteger(options.maxDenominator ?? options.largestDenominator, 192);
		const chartOffset = finiteNumber(document.offset, 0);
		const model = ChartModel.createDefault({ metadata: normalizeMetadata(document), timing: timing.toJSON() });
		const placeholders = new Map();
		const tipGroups = new Map();
		const sourceEvents = Array.isArray(document.events) ? document.events : [];
		if (document.filters && Object.keys(document.filters).length) {
			warnings.push("Chart filters are not editable in sviber and were omitted");
		}

		for (let index = 0; index < sourceEvents.length; index += 1) {
			const sourceEvent = sourceEvents[index];
			if (!sourceEvent || typeof sourceEvent !== "object" || !Number.isFinite(sourceEvent.time)) {
				warnings.push(`Ignored malformed event at index ${index}`);
				continue;
			}
			const effectiveSeconds = sourceEvent.time + chartOffset;
			const properties = sourceEvent.properties && typeof sourceEvent.properties === "object"
				? sourceEvent.properties
				: {};
			if (sourceEvent.type === "placeholder") {
				if (typeof properties.tipPoint === "string") {
					const list = placeholders.get(properties.tipPoint) ?? [];
					list.push({ sourceEvent, properties, effectiveSeconds, index });
					placeholders.set(properties.tipPoint, list);
				}
				continue;
			}
			const type = normalizeEventType(sourceEvent.type);
			if (!EVENT_TYPE_SET.has(type)) {
				warnings.push(`Ignored unsupported event type ${sourceEvent.type} at index ${index}`);
				continue;
			}

			const beat = timing.secondsToBeat(effectiveSeconds, maxDenominator);
			const overrides = { time: beat.toJSON(), channel: model.channels[0].id };
			if (MOVABLE_TYPES.has(type)) {
				overrides.x = finiteNumber(properties.x, 0);
				overrides.y = finiteNumber(properties.y, 0);
			}
			if (DURATION_TYPES.has(type)) {
				const durationSeconds = Math.max(0, finiteNumber(properties.duration, 0));
				overrides.duration = timing.secondsDurationToBeats(
					effectiveSeconds,
					durationSeconds,
					maxDenominator,
				).toJSON();
			}
			if (TEXT_TYPES.has(type)) overrides.text = String(properties.text ?? "");
			if (type === "flick") {
				overrides.angle = finiteNumber(Array.isArray(properties.angle) ? properties.angle[0] : properties.angle, Math.PI / 2);
				if (Array.isArray(properties.angle) && properties.angle.length > 1) {
					warnings.push(`Only the first flick angle was imported at index ${index}`);
				}
			}
			const event = model.addEvent(type, overrides);
			if (TIP_POINTABLE_TYPES.has(type) && typeof properties.tipPoint === "string") {
				const list = tipGroups.get(properties.tipPoint) ?? [];
				list.push({ event, effectiveSeconds, index });
				tipGroups.set(properties.tipPoint, list);
			} else if (type === "bgNote" && typeof properties.tipPoint === "string") {
				warnings.push(`The bgNote tip point was omitted at index ${index}`);
			}
			if (sourceEvent.timeDependent || sourceEvent.filters) {
				warnings.push(`Visual-only data was omitted from event at index ${index}`);
			}
		}

		for (const [tipPoint, records] of tipGroups) {
			records.sort((left, right) => left.effectiveSeconds - right.effectiveSeconds || left.index - right.index);
			const first = records[0];
			first.event.tipPointSpawnType = records.length > 1 ? "chain" : "drop";
			for (let index = 1; index < records.length; index += 1) {
				records[index].event.tipPointSpawnType = "inherit";
			}
			const candidates = (placeholders.get(tipPoint) ?? [])
				.toSorted((left, right) => left.effectiveSeconds - right.effectiveSeconds || left.index - right.index);
			const placeholder = candidates.findLast((candidate) => candidate.effectiveSeconds <= first.effectiveSeconds)
				?? candidates[0];
			if (placeholder) {
				first.event.tipPointSpawnAbsolutePosition = true;
				first.event.tipPointSpawnAttached = false;
				first.event.tipPointSpawnX = finiteNumber(placeholder.properties.x, 0);
				first.event.tipPointSpawnY = finiteNumber(placeholder.properties.y, 100);
				first.event.tipPointSpawnTimeBeats = false;
				first.event.tipPointSpawnTime = Math.max(0, first.effectiveSeconds - placeholder.effectiveSeconds);
				delete first.event.tipPointSpawnDistance;
				delete first.event.tipPointSpawnAngle;
			} else {
				warnings.push(`Tip point ${tipPoint} has no placeholder; default spawn settings were used`);
			}
		}

		model.importWarnings = warnings;
		return model;
	}

	_allocate(kind) {
		const field = `_next${kind[0].toUpperCase()}${kind.slice(1)}Id`;
		const id = this[field];
		this[field] += 1;
		return id;
	}

	createEvent(type, overrides = {}) {
		return createEvent(type, {
			...overrides,
			id: this._allocate("event"),
			channel: validId(overrides.channel) ? overrides.channel : this.editor.currentChannel,
		});
	}

	addEvent(typeOrEvent, overrides = {}) {
		const event = typeof typeOrEvent === "string"
			? this.createEvent(typeOrEvent, overrides)
			: createEvent(typeOrEvent.type, { ...typeOrEvent, id: this._allocate("event") });
		if (!this.channels.some(({ id }) => id === event.channel)) event.channel = this.editor.currentChannel;
		if (this.channels.find(channel => channel.id === event.channel)?.active === false) event.selected = false;
		this.events.push(event);
		return event;
	}

	removeEvent(id) {
		const index = this.events.findIndex((event) => event.id === id);
		return index < 0 ? null : this.events.splice(index, 1)[0];
	}

	addChannel(index = this.channels.length, data = {}) {
		const names = new Set(this.channels.map(channel => channel.name));
		let ordinal = this.channels.length + 1;
		while (names.has(`Channel ${ordinal}`)) ordinal += 1;
		const channel = {
			...clone(data),
			id: this._allocate("channel"),
			name: String(data.name ?? `Channel ${ordinal}`),
			active: data.active !== false,
		};
		const insertion = Math.max(0, Math.min(this.channels.length, Number(index) || 0));
		this.channels.splice(insertion, 0, channel);
		this.editor.currentChannel = channel.id;
		return channel;
	}

	removeChannel(id) {
		if (this.channels.length <= 1) return null;
		const index = this.channels.findIndex((channel) => channel.id === id);
		if (index < 0) return null;
		const [removed] = this.channels.splice(index, 1);
		this.events = this.events.filter((event) => event.channel !== id);
		if (this.editor.currentChannel === id) {
			const above = this.channels.slice(0, index).reverse().find(channel => channel.active !== false);
			const below = this.channels.slice(index).find(channel => channel.active !== false);
			this.editor.currentChannel = (above || below || this.channels[Math.max(0, index - 1)]).id;
		}
		return removed;
	}

	addSnappee(typeOrSnappee, overrides = {}) {
		const source = typeof typeOrSnappee === "string" ? overrides : typeOrSnappee;
		const type = typeof typeOrSnappee === "string" ? typeOrSnappee : typeOrSnappee.type;
		const snappee = createSnappee(type, { ...source, id: this._allocate("snappee") });
		this.snappees.push(snappee);
		return snappee;
	}

	removeSnappee(id, options = {}) {
		const index = this.snappees.findIndex((snappee) => snappee.id === id);
		if (index < 0) return null;
		for (const event of this.events) {
			if (event.attached && event.snappee === id) {
				const position = resolveAttachedPosition(event, this.snappees, options);
				event.attached = false;
				event.x = position?.x ?? 0;
				event.y = position?.y ?? 0;
				delete event.snappee;
				delete event.snapPoint;
			}
			if (event.tipPointSpawnAbsolutePosition && event.tipPointSpawnAttached && event.tipPointSpawnSnappee === id) {
				const position = resolveAttachedPosition(event, this.snappees, { ...options, prefix: "tipPointSpawn" });
				event.tipPointSpawnAttached = false;
				event.tipPointSpawnX = position?.x ?? 0;
				event.tipPointSpawnY = position?.y ?? 100;
				delete event.tipPointSpawnSnappee;
				delete event.tipPointSpawnSnapPoint;
			}
		}
		return this.snappees.splice(index, 1)[0];
	}

	serializeSviber() {
		return {
			music: this.music,
			image: this.image,
			editor: clone(this.editor),
			timing: this.timing.toJSON(),
			channels: clone(this.channels),
			events: clone(this.events),
			snappees: clone(this.snappees),
			nextIds: {
				channel: this._nextChannelId,
				event: this._nextEventId,
				snappee: this._nextSnappeeId,
			},
		};
	}

	snapshot() {
		return { metadata: clone(this.metadata), ...this.serializeSviber() };
	}

	restore(snapshot) {
		const restored = new ChartModel(snapshot);
		Object.assign(this, restored);
		return this;
	}

	_exportEvent(event) {
		const time = this.timing.beatToSeconds(event.time);
		const properties = {};
		if (MOVABLE_TYPES.has(event.type)) {
			const position = resolveAttachedPosition(event, this.snappees) ?? {
				x: finiteNumber(event.x, 0),
				y: finiteNumber(event.y, 0),
			};
			properties.x = position.x;
			properties.y = position.y;
		}
		if (DURATION_TYPES.has(event.type)) {
			properties.duration = Math.max(0, this.timing.durationToSeconds(event.time, event.duration));
		}
		if (TEXT_TYPES.has(event.type)) properties.text = String(event.text ?? "");
		if (event.type === "flick") properties.angle = finiteNumber(event.angle, Math.PI / 2);
		return { type: event.type, time, properties };
	}

	_spawnPosition(event, targetPosition) {
		if (!event.tipPointSpawnAbsolutePosition) {
			const distance = Math.max(0, finiteNumber(event.tipPointSpawnDistance, 100));
			const angle = finiteNumber(event.tipPointSpawnAngle, Math.PI / 2);
			return {
				x: targetPosition.x + distance * Math.cos(angle),
				y: targetPosition.y + distance * Math.sin(angle),
			};
		}
		return resolveAttachedPosition(event, this.snappees, { prefix: "tipPointSpawn" }) ?? {
			x: finiteNumber(event.tipPointSpawnX, 0),
			y: finiteNumber(event.tipPointSpawnY, 100),
		};
	}

	_makePlaceholder(targetEvent, spawnSettings, tipPoint, sequence) {
		const targetPosition = resolveAttachedPosition(targetEvent, this.snappees) ?? {
			x: finiteNumber(targetEvent.x, 0),
			y: finiteNumber(targetEvent.y, 0),
		};
		const spawnPosition = this._spawnPosition(spawnSettings, targetPosition);
		const targetTime = this.timing.beatToSeconds(targetEvent.time);
		const spawnTime = spawnSettings.tipPointSpawnTimeBeats
			? this.timing.beatToSeconds(Rational.from(targetEvent.time).sub(spawnSettings.tipPointSpawnTime ?? 1))
			: targetTime - Math.max(0, finiteNumber(spawnSettings.tipPointSpawnTime, 1));
		return {
			exported: {
				type: "placeholder",
				time: spawnTime,
				properties: { x: spawnPosition.x, y: spawnPosition.y, tipPoint },
			},
			sequence,
			placeholder: true,
		};
	}

	generateSunniesnowEvents() {
		const activeChannels = new Set(this.channels
			.filter(channel => channel.active !== false)
			.map(channel => channel.id));
		const records = this.events
			.filter(event => event.type !== "comment" && activeChannels.has(event.channel))
			.map((event, sequence) => ({
			event,
			exported: this._exportEvent(event),
			sequence,
			placeholder: false,
		}));
		const placeholders = [];
		let guideSerial = 0;

		for (const channel of this.channels) {
			const channelEvents = records
				.filter(({ event }) => event.channel === channel.id && TIP_POINTABLE_TYPES.has(event.type))
				.toSorted((left, right) => Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence);
			let previousMode = "none";
			let previousSettings = null;
			let chainTipPoint = null;
			for (const record of channelEvents) {
				const declaredMode = TIP_SPAWN_TYPES.has(record.event.tipPointSpawnType)
					? record.event.tipPointSpawnType
					: "inherit";
				const effectiveMode = declaredMode === "inherit" ? previousMode : declaredMode;
				if (effectiveMode === "chain") {
					if (declaredMode === "chain" || !chainTipPoint) {
						previousSettings = record.event;
						chainTipPoint = `sviber-tip-${record.event.id}-${guideSerial++}`;
						placeholders.push(this._makePlaceholder(record.event, previousSettings, chainTipPoint, record.sequence));
					}
					record.exported.properties.tipPoint = chainTipPoint;
				} else if (effectiveMode === "drop") {
					if (declaredMode === "drop" || !previousSettings) previousSettings = record.event;
					const tipPoint = `sviber-tip-${record.event.id}-${guideSerial++}`;
					record.exported.properties.tipPoint = tipPoint;
					placeholders.push(this._makePlaceholder(record.event, previousSettings, tipPoint, record.sequence));
					chainTipPoint = null;
				} else {
					chainTipPoint = null;
					if (effectiveMode === "none") previousSettings = null;
				}

				previousMode = effectiveMode;
				if (declaredMode === "chain" || declaredMode === "drop") previousSettings = record.event;
				if (declaredMode === "none") {
					previousMode = "none";
					previousSettings = null;
				}
			}
		}

		return [...records, ...placeholders]
			.toSorted((left, right) => left.exported.time - right.exported.time
				|| Number(right.placeholder) - Number(left.placeholder)
				|| left.sequence - right.sequence)
			.map(({ exported }) => exported);
	}

	exportSunniesnow(options = {}) {
		const result = {
			...clone(this.metadata),
			events: this.generateSunniesnowEvents(),
		};
		if (options.includeSchema ?? true) result.$schema = SUNNIESNOW_SCHEMA;
		return result;
	}

	toJSON() {
		return { ...this.exportSunniesnow(), sviber: this.serializeSviber() };
	}

	serialize(space = 2) {
		return JSON.stringify(this.toJSON(), null, space);
	}

	clone() {
		return ChartModel.import(this.toJSON());
	}
}

export function createDefaultChartState(overrides = {}) {
	return ChartModel.createDefault(overrides).snapshot();
}

export function importChart(source, options = {}) {
	return ChartModel.import(source, options);
}

export function exportSunniesnowChart(model, options = {}) {
	return (model instanceof ChartModel ? model : new ChartModel(model)).exportSunniesnow(options);
}

export default ChartModel;
