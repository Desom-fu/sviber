import {
	INTERNAL,
	addBeat,
	angleValue,
	beatNumber,
	beatTuple,
	clone,
	createBinder,
	ensureAlive,
	normalizeColor,
} from "./macro-api-math.js";
import { POSITION_FIELDS, tipPointFields } from "./macro-api-location.js";

export const EVENT_TYPES = new Set([
	"tap",
	"hold",
	"drag",
	"flick",
	"bgNote",
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
	"comment",
	"group",
]);
export const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote", "group"]);
export const DURATION_TYPES = new Set([
	"hold",
	"bgNote",
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
	"comment",
]);
export const TEXT_TYPES = new Set(["tap", "hold", "flick", "bgNote", "bigText", "comment"]);
export const TIP_POINTABLE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
export const TIP_POINT_FIELDS = [
	"tipPointSpawnType",
	"tipPointSpawnAbsolutePosition",
	"tipPointSpawnAttached",
	"tipPointSpawnX",
	"tipPointSpawnY",
	"tipPointSpawnSnappee",
	"tipPointSpawnSnapPoint",
	"tipPointSpawnDistance",
	"tipPointSpawnAngle",
	"tipPointSpawnTimeBeats",
	"tipPointSpawnTime",
];

const EVENT_SUBCLASSES = [
	["tap", "Tap"],
	["hold", "Hold"],
	["drag", "Drag"],
	["flick", "Flick"],
	["bgNote", "BgNote"],
	["bigText", "BigText"],
	["grid", "Grid"],
	["diamondGrid", "DiamondGrid"],
	["hexagon", "Hexagon"],
	["checkerboard", "Checkerboard"],
	["pentagon", "Pentagon"],
	["turntable", "Turntable"],
	["hexagram", "Hexagram"],
	["comment", "Comment"],
	["group", "Group"],
];

const { ctxOf, attach, extend } = createBinder();

export class Event {
	constructor(options = {}, token = null) {
		constructEvent(api(new.target), this, options, token);
	}

	get type() {
		return alive(this).type;
	}

	set type(value) {
		assignEventType(api(this), this, value);
	}

	get movable() {
		return MOVABLE_TYPES.has(this.type);
	}

	get haveTime() {
		const raw = alive(this);
		return raw.time != null || raw.type === "group";
	}

	get haveChannel() {
		return this.type !== "group" && api(this).rawOf(this).channel != null;
	}

	get haveDuration() {
		return DURATION_TYPES.has(this.type);
	}

	get haveText() {
		return TEXT_TYPES.has(this.type);
	}

	get tipPointable() {
		return TIP_POINTABLE_TYPES.has(this.type);
	}

	get group() {
		return this.type === "group";
	}

	assertMovable() {
		if (!this.movable) {
			throw new Error(`${this.type} events do not have a location`);
		}
	}

	get location() {
		this.assertMovable();
		return api(this).rawLocation(alive(this));
	}

	set location(value) {
		assignEventLocation(api(this), this, value);
	}

	get anchor() {
		assertGroupField(this, "anchor is only valid for groups");
		return api(this).rawLocation(alive(this));
	}

	set anchor(value) {
		assignEventAnchor(api(this), this, value);
	}

	get text() {
		assertHasText(this);
		return api(this).rawOf(this).text;
	}

	set text(value) {
		assignEventText(this, value);
	}

	get angle() {
		assertFlick(this);
		return api(this).rawOf(this).angle;
	}

	set angle(value) {
		assignEventAngle(this, value);
	}

	get time() {
		return readEventTime(api(this), this);
	}

	set time(value) {
		assignEventTime(api(this), this, value);
	}

	get channel() {
		return readEventChannel(api(this), this);
	}

	set channel(value) {
		assignEventChannel(api(this), this, value);
	}

	get events() {
		assertGroupField(this, "only groups have events");
		return (alive(this).events || []).map(api(this).wrapEventClass);
	}

	get color() {
		assertGroupField(this, "only groups have colors");
		return alive(this).color;
	}

	set color(value) {
		assignEventColor(this, value);
	}

	get tipPoint() {
		return readEventTipPoint(api(this), this);
	}

	set tipPoint(value) {
		assignEventTipPoint(api(this), this, value);
	}

	delete() {
		const ctx = api(this);
		const raw = alive(this);
		ctx.remove("events", raw);
		raw.__deleted = true;
		return this;
	}

	static get list() {
		const ctx = api(this);
		return ctx.state.events.map(ctx.wrapEventClass);
	}

	static get selection() {
		const ctx = api(this);
		return ctx
			.rawEvents()
			.filter(item => item.selected)
			.map(ctx.wrapEventClass);
	}
}

export function installEventApi(ctx) {
	ctx.Event = extend(ctx, Event);
	ctx.wrapEventClass = raw => (raw ? new (ctx.eventClasses?.[raw.type] || ctx.Event)(raw, INTERNAL) : null);
	ctx.createEventRecord = (type, overrides) => createEventRecord(ctx, type, overrides);
	ctx.detachEvent = target => detachEvent(ctx, target);
	ctx.MOVABLE_TYPES = MOVABLE_TYPES;
	ctx.TIP_POINTABLE_TYPES = TIP_POINTABLE_TYPES;
	installEventSubclasses(ctx);
}

export function detachEvent(ctx, target) {
	const detachFrom = items => {
		const index = items.indexOf(target);
		if (index >= 0) {
			items.splice(index, 1);
			return true;
		}
		return items.some(item => item.type === "group" && detachFrom(item.events || []));
	};
	detachFrom(ctx.state.events);
}

function api(self) {
	return ctxOf(typeof self === "function" ? self : self.constructor);
}

function alive(self, kind = "Event") {
	return ensureAlive(api(self).rawOf(self), kind);
}

function constructEvent(ctx, self, options, token) {
	if (token === INTERNAL) {
		ctx.wrapperRecords.set(self, options);
		return;
	}
	if (typeof options !== "object" || Array.isArray(options)) {
		throw new TypeError("Event options must be an object");
	}
	const values = { ...options };
	if (!Object.hasOwn(values, "type")) {
		throw new TypeError("Event type is required");
	}
	if (values.channel != null && !(values.channel instanceof ctx.Channel)) {
		throw new TypeError("channel must be a Channel");
	}
	const type = values.type;
	delete values.type;
	ctx.wrapperRecords.set(self, createEventRecord(ctx, type, values));
}

function assignEventType(ctx, self, value) {
	const raw = alive(self);
	const oldId = raw.id;
	const rebuilt = createEventRecord(ctx, value, clone(raw));
	ctx.state.events.pop();
	rebuilt.id = oldId;
	for (const key of Object.keys(raw)) {
		delete raw[key];
	}
	Object.assign(raw, rebuilt);
	const Wrapper = ctx.eventClasses?.[rebuilt.type];
	if (Wrapper) {
		Object.setPrototypeOf(self, Wrapper.prototype);
	}
}

function assignEventLocation(ctx, self, value) {
	self.assertMovable();
	if (!(value instanceof ctx.Location)) {
		throw new TypeError("location must be a Location");
	}
	const raw = ctx.rawOf(self);
	const before = self.location.pos;
	const after = value.pos;
	if (self.group) {
		shiftGroupLocations(ctx, raw, before, after);
	}
	ctx.assignRawLocation(raw, value);
}

function shiftGroupLocations(ctx, raw, before, after) {
	for (const child of ctx.rawEventsFrom(raw)) {
		if (!MOVABLE_TYPES.has(child.type)) {
			continue;
		}
		const childPoint = ctx.rawLocation(child).pos;
		ctx.assignRawLocation(
			child,
			new ctx.Location(childPoint.x + after.x - before.x, childPoint.y + after.y - before.y),
		);
	}
}

function assignEventAnchor(ctx, self, value) {
	assertGroupField(self, "anchor is only valid for groups");
	if (!(value instanceof ctx.Location)) {
		throw new TypeError("anchor must be a Location");
	}
	ctx.assignRawLocation(ctx.rawOf(self), value);
}

function assignEventText(self, value) {
	assertHasText(self);
	api(self).rawOf(self).text = String(value);
}

function assignEventAngle(self, value) {
	assertFlick(self);
	api(self).rawOf(self).angle = angleValue(value);
}

function readEventTime(ctx, self) {
	const raw = alive(self);
	return beatTuple(self.group ? ctx.rawEventTime(raw) : raw.time);
}

function assignEventTime(ctx, self, value) {
	const raw = alive(self);
	if (!self.group) {
		raw.time = beatTuple(value);
		return;
	}
	const delta = beatNumber(value) - ctx.rawEventTime(raw);
	for (const child of ctx.rawEventsFrom(raw)) {
		if (child.time != null) {
			child.time = addBeat(child.time, delta);
		}
	}
}

function readEventChannel(ctx, self) {
	if (!self.haveChannel) {
		throw new Error("groups do not have channels");
	}
	return ctx.wrapChannel(ctx.find("channels", ctx.rawOf(self).channel));
}

function assignEventChannel(ctx, self, value) {
	if (!self.haveChannel) {
		throw new Error("groups do not have channels");
	}
	const channel = ensureAlive(ctx.rawOf(value), "Channel");
	ctx.rawOf(self).channel = channel.id;
}

function assignEventColor(self, value) {
	assertGroupField(self, "only groups have colors");
	alive(self).color = normalizeColor(value);
}

function readEventTipPoint(ctx, self) {
	if (!self.tipPointable) {
		throw new Error(`${self.type} events do not have tip points`);
	}
	const raw = ctx.rawOf(self);
	return new ctx.TipPoint(raw.tipPointSpawnType || "inherit", tipPointOptions(ctx, raw));
}

function tipPointOptions(ctx, raw) {
	const absolute = Boolean(raw.tipPointSpawnAbsolutePosition);
	return {
		location: absoluteTipLocation(ctx, raw, absolute),
		distance: raw.tipPointSpawnDistance,
		angle: raw.tipPointSpawnAngle,
		timeSeconds: raw.tipPointSpawnTimeBeats ? null : raw.tipPointSpawnTime,
		timeBeats: raw.tipPointSpawnTimeBeats ? raw.tipPointSpawnTime : null,
	};
}

function absoluteTipLocation(ctx, raw, absolute) {
	if (!absolute) {
		return null;
	}
	if (raw.tipPointSpawnAttached) {
		return ctx.attachedLocation(ctx.Snappee.getById(raw.tipPointSpawnSnappee), raw.tipPointSpawnSnapPoint);
	}
	return new ctx.Location(raw.tipPointSpawnX, raw.tipPointSpawnY);
}

function assignEventTipPoint(ctx, self, value) {
	if (!self.tipPointable) {
		throw new Error(`${self.type} events do not have tip points`);
	}
	const raw = ctx.rawOf(self);
	for (const key of Object.keys(raw)) {
		if (key.startsWith("tipPointSpawn")) {
			delete raw[key];
		}
	}
	Object.assign(raw, tipPointFields(value));
}

function createEventRecord(ctx, type, overrides = {}) {
	overrides = overrides && typeof overrides === "object" ? ctx.rawOf(overrides) : {};
	type = String(type);
	if (!EVENT_TYPES.has(type)) {
		throw new TypeError(`Unsupported event type: ${type}`);
	}
	const normalized = normalizeEventOverrides(ctx, type, overrides);
	const item = {
		id: ctx.nextId("events"),
		type: String(type),
		channel: ctx.state.editor.currentChannel ?? ctx.state.channels[0]?.id ?? 0,
		time: beatTuple(ctx.state.editor.currentTime ?? [0, 0, 1]),
		selected: true,
		...normalized,
	};
	applyEventTypeFields(ctx, item, type);
	ctx.state.events.push(item);
	return item;
}

function normalizeEventOverrides(ctx, type, overrides) {
	const normalized = clone(overrides);
	assignOverrideLocation(ctx, normalized, overrides.location);
	if (normalized.time != null) {
		normalized.time = beatTuple(normalized.time);
	}
	if (normalized.duration != null) {
		normalized.duration = beatTuple(normalized.duration);
	}
	if (overrides.channel != null) {
		normalized.channel = ctx.resolveId(overrides.channel);
	}
	if (normalized.angle != null) {
		normalized.angle = angleValue(normalized.angle);
	}
	if (normalized.color != null) {
		normalized.color = normalizeColor(normalized.color);
	}
	assignOverrideTipPoint(ctx, normalized, overrides.tipPoint);
	if (type === "group") {
		normalized.events = (overrides.events || []).map(value => prepareGroupChild(ctx, value));
	}
	delete normalized.id;
	delete normalized.type;
	return normalized;
}

function assignOverrideLocation(ctx, normalized, sourceLocation) {
	if (sourceLocation == null) {
		return;
	}
	if (!(sourceLocation instanceof ctx.Location)) {
		throw new TypeError("location must be a Location");
	}
	const point = sourceLocation;
	if (point.attached) {
		normalized.attached = true;
		normalized.snappee = point.snappee.id;
		normalized.snapPoint = clone(point._snapPoint);
		delete normalized.x;
		delete normalized.y;
	} else {
		normalized.x = Number(point.x);
		normalized.y = Number(point.y);
		delete normalized.attached;
		delete normalized.snappee;
		delete normalized.snapPoint;
	}
	delete normalized.location;
}

function assignOverrideTipPoint(ctx, normalized, tipPoint) {
	if (!(tipPoint instanceof ctx.TipPoint)) {
		return;
	}
	Object.assign(normalized, tipPointFields(tipPoint));
	delete normalized.tipPoint;
}

function prepareGroupChild(ctx, value) {
	const child = ctx.rawOf(value);
	if (child.id == null) {
		child.id = ctx.nextId("events");
	}
	if (child.type === "group") {
		child.events = (child.events || []).map(nested => prepareGroupChild(ctx, nested));
	}
	return child;
}

function applyEventPosition(item, type) {
	if (!MOVABLE_TYPES.has(type)) {
		for (const field of POSITION_FIELDS) {
			delete item[field];
		}
		return;
	}
	item.attached = Boolean(item.attached);
	if (item.attached) {
		item.snapPoint = clone(item.snapPoint ?? 0);
		delete item.x;
		delete item.y;
		return;
	}
	item.x = Number(item.x) || 0;
	item.y = Number(item.y) || 0;
	delete item.snappee;
	delete item.snapPoint;
}

function applyEventTipPoint(item, type) {
	if (!TIP_POINTABLE_TYPES.has(type)) {
		for (const field of TIP_POINT_FIELDS) {
			delete item[field];
		}
		return;
	}
	item.tipPointSpawnType ||= "inherit";
	item.tipPointSpawnAbsolutePosition = Boolean(item.tipPointSpawnAbsolutePosition);
	item.tipPointSpawnTimeBeats = Boolean(item.tipPointSpawnTimeBeats);
	item.tipPointSpawnTime = eventTipPointTime(item);
	if (item.tipPointSpawnAbsolutePosition) {
		delete item.tipPointSpawnDistance;
		delete item.tipPointSpawnAngle;
		return;
	}
	item.tipPointSpawnDistance = Number(item.tipPointSpawnDistance ?? 100);
	item.tipPointSpawnAngle = angleValue(item.tipPointSpawnAngle ?? Math.PI / 2);
	for (const field of [
		"tipPointSpawnAttached",
		"tipPointSpawnX",
		"tipPointSpawnY",
		"tipPointSpawnSnappee",
		"tipPointSpawnSnapPoint",
	]) {
		delete item[field];
	}
}

function eventTipPointTime(item) {
	if (item.tipPointSpawnTimeBeats) {
		return beatTuple(item.tipPointSpawnTime ?? 1);
	}
	return Number(item.tipPointSpawnTime ?? 1);
}

function applyEventTypeFields(ctx, item, type) {
	applyEventPosition(item, type);
	if (DURATION_TYPES.has(type)) {
		item.duration = beatTuple(item.duration ?? (type === "bgNote" || type === "comment" ? 0 : 1));
	} else {
		delete item.duration;
	}
	if (TEXT_TYPES.has(type)) {
		item.text = String(item.text ?? "");
	} else {
		delete item.text;
	}
	if (type === "flick") {
		item.angle = angleValue(item.angle ?? Math.PI / 2);
	} else {
		delete item.angle;
	}
	applyEventTipPoint(item, type);
	applyGroupFields(ctx, item, type);
}

function applyGroupFields(ctx, item, type) {
	if (type === "group") {
		delete item.time;
		delete item.channel;
		item.color = normalizeColor(item.color ?? "#ff9d3d");
		for (const child of item.events || []) {
			ctx.detachEvent(child);
		}
		return;
	}
	delete item.events;
	delete item.color;
}

function installEventSubclasses(ctx) {
	ctx.eventClasses = {};
	for (const [type, name] of EVENT_SUBCLASSES) {
		ctx[name] = attach(ctx, makeEventClass(ctx.Event, type));
		ctx.eventClasses[type] = ctx[name];
	}
}

function makeEventClass(Parent, type) {
	return class extends Parent {
		constructor(options = {}, token = null) {
			super(token === INTERNAL ? options : { ...options, type }, token);
		}
	};
}

function assertGroupField(self, message) {
	if (!self.group) {
		throw new Error(message);
	}
}

function assertHasText(self) {
	if (!self.haveText) {
		throw new Error(`${self.type} events do not have text`);
	}
}

function assertFlick(self) {
	if (self.type !== "flick") {
		throw new Error("angle is only valid for flick events");
	}
}
