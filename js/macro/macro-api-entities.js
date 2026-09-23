import {
	INTERNAL,
	Vector2D,
	angleValue,
	beatTuple,
	checkedSnapPoint,
	clone,
	createBinder,
	ensureAlive,
	moveListItem,
	normalizeColor,
	snapPointPosition,
} from "./macro-api-math.js";
import { snappeeIndexSpec } from "../core/snappee-index.js";
import { writeTipPointSwitch } from "../core/tip-point-track.js";

const { ctxOf, attach, extend } = createBinder();

const SNAPPEE_SUBCLASSES = [
	["rectangularMesh", "RectangularMesh"],
	["radialMesh", "RadialMesh"],
	["parametricMesh", "ParametricMesh"],
	["regularPolygonCurve", "RegularPolygonCurve"],
	["bezierCurve", "BezierCurve"],
	["penCurve", "PenCurve"],
	["parametricCurve", "ParametricCurve"],
];

export class BpmChange {
	constructor(time, bpm, token = null) {
		constructBpmChange(api(new.target), this, time, bpm, token);
	}

	get time() {
		return beatTuple(alive(this, "BpmChange").time);
	}

	get bpm() {
		return alive(this, "BpmChange").bpm;
	}

	set bpm(value) {
		alive(this, "BpmChange").bpm = Number(value);
	}

	delete() {
		const ctx = api(this);
		const raw = alive(this, "BpmChange");
		const index = (ctx.state.timing.bpmChanges || []).indexOf(raw);
		if (index >= 0) {
			ctx.state.timing.bpmChanges.splice(index, 1);
		}
		raw.__deleted = true;
		return this;
	}

	static get list() {
		const ctx = api(this);
		return (ctx.state.timing.bpmChanges ||= []).map(item => new ctx.BpmChange(item, null, INTERNAL));
	}
}

export class BarLine {
	constructor(time, token = null) {
		constructBarLine(api(new.target), this, time, token);
	}

	get time() {
		return beatTuple(alive(this, "BarLine").time);
	}

	delete() {
		const ctx = api(this);
		const raw = alive(this, "BarLine");
		const lines = ctx.state.timing.barLines || [];
		const index = lines.indexOf(raw);
		if (index >= 0) {
			lines.splice(index, 1);
		}
		raw.__deleted = true;
		return this;
	}

	static get list() {
		const ctx = api(this);
		return (ctx.state.timing.barLines ||= []).map(item => new ctx.BarLine(item, INTERNAL));
	}
}

export class Channel {
	constructor(options = {}, token = null) {
		constructChannel(api(new.target), this, options, token);
	}

	get id() {
		return alive(this, "Channel").id;
	}

	get name() {
		return alive(this, "Channel").name;
	}

	set name(value) {
		alive(this, "Channel").name = String(value);
	}

	get color() {
		return alive(this, "Channel").color ?? "#7f7f7f";
	}

	set color(value) {
		alive(this, "Channel").color = normalizeColor(value);
	}

	get active() {
		return alive(this, "Channel").active !== false;
	}

	set active(value) {
		alive(this, "Channel").active = Boolean(value);
	}

	activate() {
		alive(this, "Channel").active = true;
		return this;
	}

	deactivate() {
		alive(this, "Channel").active = false;
		return this;
	}

	get current() {
		return api(this).state.editor.currentChannel === this.id;
	}

	select() {
		api(this).setCurrentChannel(this.id);
		return this;
	}

	moveUp() {
		moveListItem(api(this).state.channels, alive(this, "Channel"), -1);
		return this;
	}

	moveDown() {
		moveListItem(api(this).state.channels, alive(this, "Channel"), 1);
		return this;
	}

	get events() {
		const ctx = api(this);
		alive(this, "Channel");
		return ctx.state.events
			.filter(item => item.type !== "group" && item.channel === this.id)
			.map(ctx.wrapEventClass);
	}

	delete() {
		const ctx = api(this);
		const raw = alive(this, "Channel");
		ctx.remove("channels", raw);
		raw.__deleted = true;
		return this;
	}

	toJSON() {
		return clone(alive(this, "Channel"));
	}

	static get list() {
		const ctx = api(this);
		return ctx.collection("channels").map(ctx.wrapChannel);
	}

	static get current() {
		const ctx = api(this);
		return ctx.wrapChannel(ctx.find("channels", ctx.state.editor.currentChannel) || null);
	}

	static get(n) {
		return getChannel(api(this), n);
	}

	static getById(id) {
		const ctx = api(this);
		return ctx.wrapChannel(ctx.find("channels", id));
	}

	static tipPointSwitch(time, map) {
		applyChannelTipPointSwitch(api(this), time, map);
		return this;
	}
}

export class Snappee {
	constructor(type = "rectangularMesh", options = {}, token = null) {
		constructSnappee(api(new.target), this, type, options, token);
	}

	get id() {
		return alive(this, "Snappee").id;
	}

	get name() {
		return alive(this, "Snappee").name;
	}

	set name(value) {
		alive(this, "Snappee").name = String(value);
	}

	get color() {
		return alive(this, "Snappee").color;
	}

	set color(value) {
		alive(this, "Snappee").color = normalizeColor(value);
	}

	get active() {
		return alive(this, "Snappee").active !== false;
	}

	set active(value) {
		if (value) {
			this.activate();
		} else {
			this.deactivate();
		}
	}

	activate() {
		alive(this, "Snappee").active = true;
		return this;
	}

	deactivate() {
		const raw = alive(this, "Snappee");
		raw.active = false;
		raw.selected = false;
		return this;
	}

	get selected() {
		return Boolean(alive(this, "Snappee").selected);
	}

	select() {
		selectSnappee(api(this), alive(this, "Snappee"));
		return this;
	}

	static deselect() {
		for (const item of api(this).state.snappees) {
			item.selected = false;
		}
	}

	pos(...args) {
		const raw = alive(this, "Snappee");
		const point = snapPointPosition(raw, checkedSnapPoint(raw, args));
		return new Vector2D(point.x, point.y);
	}

	get iRange() {
		return [...snappeeIndexSpec(alive(this, "Snappee")).i];
	}

	get jRange() {
		const spec = snappeeIndexSpec(alive(this, "Snappee"));
		if (!spec.mesh) {
			throw new Error("jRange is only valid for meshes");
		}
		return [...spec.j];
	}

	get iExcludeEnd() {
		return snappeeIndexSpec(alive(this, "Snappee")).iExcludeEnd;
	}

	get jExcludeEnd() {
		const spec = snappeeIndexSpec(alive(this, "Snappee"));
		if (!spec.mesh) {
			throw new Error("jExcludeEnd is only valid for meshes");
		}
		return spec.jExcludeEnd;
	}

	get hasSpecial() {
		return snappeeIndexSpec(alive(this, "Snappee")).hasSpecial;
	}

	get specialI() {
		return snappeeIndexSpec(alive(this, "Snappee")).specialI;
	}

	moveUp() {
		moveListItem(api(this).state.snappees, alive(this, "Snappee"), -1);
		return this;
	}

	moveDown() {
		moveListItem(api(this).state.snappees, alive(this, "Snappee"), 1);
		return this;
	}

	duplicate(name = this.name, color = this.color) {
		return duplicateSnappee(api(this), this, name, color);
	}

	delete() {
		const ctx = api(this);
		const raw = alive(this, "Snappee");
		ctx.remove("snappees", raw);
		raw.__deleted = true;
		return this;
	}

	toJSON() {
		return clone(alive(this, "Snappee"));
	}

	static get list() {
		const ctx = api(this);
		return ctx.collection("snappees").map(ctx.wrapSnappee);
	}

	static get selected() {
		const ctx = api(this);
		return ctx.wrapSnappee(ctx.collection("snappees").find(value => value.selected));
	}

	static get(n) {
		return getSnappee(api(this), n);
	}

	static getById(id) {
		const ctx = api(this);
		return ctx.wrapSnappee(ctx.find("snappees", id));
	}
}

export function installEntitiesApi(ctx) {
	ctx.BpmChange = extend(ctx, BpmChange);
	ctx.BarLine = extend(ctx, BarLine);
	ctx.Channel = extend(ctx, Channel);
	ctx.Snappee = extend(ctx, Snappee);
	ctx.wrapChannel = raw => (raw ? new ctx.Channel(raw, INTERNAL) : null);
	ctx.wrapSnappee = raw => wrapSnappee(ctx, raw);
	ctx.createChannelRecord = (name, overrides) => createChannelRecord(ctx, name, overrides);
	ctx.createSnappeeRecord = (type, overrides) => createSnappeeRecord(ctx, type, overrides);
	installSnappeeSubclasses(ctx);
}

function api(self) {
	return ctxOf(typeof self === "function" ? self : self.constructor);
}

function alive(self, kind) {
	return ensureAlive(api(self).rawOf(self), kind);
}

function constructBpmChange(ctx, self, time, bpm, token) {
	const raw = token === INTERNAL ? time : { time: beatTuple(time), bpm: Number(bpm) };
	ctx.wrapperRecords.set(self, raw);
	if (token !== INTERNAL) {
		(ctx.state.timing.bpmChanges ||= []).push(raw);
	}
}

function constructBarLine(ctx, self, time, token) {
	const raw = token === INTERNAL ? time : { time: beatTuple(time) };
	ctx.wrapperRecords.set(self, raw);
	if (token !== INTERNAL) {
		(ctx.state.timing.barLines ||= []).push(raw);
	}
}

function constructChannel(ctx, self, options, token) {
	if (token === INTERNAL) {
		ctx.wrapperRecords.set(self, options);
		return;
	}
	if (typeof options !== "object" || Array.isArray(options)) {
		throw new TypeError("Channel options must be an object");
	}
	const ordinal = ctx.state.channels.length + 1;
	ctx.wrapperRecords.set(
		self,
		createChannelRecord(ctx, options.name ?? `Channel ${ordinal}`, {
			color: normalizeColor(options.color ?? "#7f7f7f"),
			active: true,
		}),
	);
}

function constructSnappee(ctx, self, type, options, token) {
	if (token === INTERNAL) {
		ctx.wrapperRecords.set(self, type);
		return;
	}
	if (typeof options !== "object" || Array.isArray(options)) {
		throw new TypeError("Snappee options must be an object");
	}
	const count = ctx.state.snappees.filter(item => item.type === type).length + 1;
	ctx.wrapperRecords.set(
		self,
		createSnappeeRecord(ctx, type, {
			...options,
			name: options.name ?? `${type} ${count}`,
			color: normalizeColor(options.color ?? "#7f7f7f"),
		}),
	);
}

function createChannelRecord(ctx, name = "Channel", overrides = {}) {
	const item = { id: ctx.nextId("channels"), name: String(name), active: true, ...clone(overrides) };
	ctx.state.channels.push(item);
	return item;
}

function lookupSwitchTarget(map, channelRaw, resolveId) {
	if (map == null) {
		return channelRaw.id;
	}
	if (typeof map.get === "function" && typeof map.entries === "function") {
		for (const [key, value] of map.entries()) {
			if (resolveId(key) === channelRaw.id) {
				return resolveId(value);
			}
		}
		const byId = map.get(channelRaw.id);
		if (byId !== undefined) {
			return resolveId(byId);
		}
	}
	if (Object.hasOwn(map, channelRaw.id)) {
		return resolveId(map[channelRaw.id]);
	}
	return channelRaw.id;
}

function applyChannelTipPointSwitch(ctx, time, map) {
	const images = ctx.state.channels.map(channel => lookupSwitchTarget(map, channel, ctx.resolveId));
	writeTipPointSwitch(ctx.state.channels, time, images);
}

function createSnappeeRecord(ctx, type, overrides = {}) {
	const item = {
		id: ctx.nextId("snappees"),
		type: String(type),
		name: String(type),
		active: true,
		transformation: [1, 0, 0, 1, 0, 0],
		...clone(overrides),
	};
	ctx.state.snappees.push(item);
	return item;
}

function getChannel(ctx, n) {
	if (typeof n === "string") {
		return ctx.wrapChannel(ctx.collection("channels").find(item => item.name === n));
	}
	if (!Number.isInteger(n)) {
		throw new TypeError("channel number must be an integer or name");
	}
	return ctx.wrapChannel(ctx.collection("channels")[n - 1]);
}

function getSnappee(ctx, n) {
	if (typeof n === "string") {
		return ctx.wrapSnappee(ctx.collection("snappees").find(value => value.name === n));
	}
	if (!Number.isInteger(n)) {
		throw new TypeError("snappee number must be an integer or name");
	}
	return ctx.wrapSnappee(ctx.collection("snappees")[n]);
}

function selectSnappee(ctx, raw) {
	for (const item of ctx.state.snappees) {
		item.selected = false;
	}
	raw.selected = true;
}

function duplicateSnappee(ctx, self, name, color) {
	const copy = clone(alive(self, "Snappee"));
	copy.id = ctx.nextId("snappees");
	copy.name = String(name);
	copy.color = normalizeColor(color);
	ctx.state.snappees.push(copy);
	return ctx.wrapSnappee(copy);
}

function wrapSnappee(ctx, raw) {
	if (!raw) {
		return null;
	}
	const Wrapper = ctx.snappeeClasses?.[raw.type];
	return Wrapper ? new Wrapper(raw, INTERNAL) : new ctx.Snappee(raw, {}, INTERNAL);
}

function installSnappeeSubclasses(ctx) {
	ctx.snappeeClasses = {};
	for (const [type, name] of SNAPPEE_SUBCLASSES) {
		const Class = makeSnappeeClass(ctx.Snappee, type);
		ctx[name] = attach(ctx, Class);
		ctx.snappeeClasses[type] = ctx[name];
	}
}

const SNAPPEE_PROPERTY_FIELDS = {
	rectangularMesh: [
		["topLeftX", "number"],
		["topLeftY", "number"],
		["bottomRightX", "number"],
		["bottomRightY", "number"],
		["horizontalTiles", "integer"],
		["verticalTiles", "integer"],
	],
	radialMesh: [
		["centerX", "number"],
		["centerY", "number"],
		["radius", "number"],
		["azimuthalTiles", "integer"],
		["radialTiles", "integer"],
		["startingAngle", "angle"],
	],
	parametricMesh: [
		["iRange", "range"],
		["jRange", "range"],
		["iRangeExclusive", "boolean"],
		["jRangeExclusive", "boolean"],
		["xExpression", "string"],
		["yExpression", "string"],
	],
	regularPolygonCurve: [
		["centerX", "number"],
		["centerY", "number"],
		["radius", "number"],
		["angle", "angle"],
		["sides", "integer"],
		["segmentsPerSide", "integer"],
		["closed", "boolean"],
	],
	bezierCurve: [
		["degree", "integer"],
		["controlPoints", "points"],
		["segments", "integer"],
		["closed", "boolean"],
	],
	penCurve: [
		["commands", "commands"],
		["segments", "integer"],
		["closed", "boolean"],
	],
	parametricCurve: [
		["iRange", "range"],
		["iRangeExclusive", "boolean"],
		["xExpression", "string"],
		["yExpression", "string"],
		["closed", "boolean"],
	],
};

function coerceSnappeeProperty(kind, value) {
	if (kind === "number") {
		const number = Number(value);
		if (!Number.isFinite(number)) {
			throw new TypeError("property must be a finite number");
		}
		return number;
	}
	if (kind === "integer") {
		const number = Number(value);
		if (!Number.isSafeInteger(number)) {
			throw new TypeError("property must be an integer");
		}
		return number;
	}
	if (kind === "boolean") {
		return Boolean(value);
	}
	if (kind === "string") {
		return String(value);
	}
	if (kind === "angle") {
		return angleValue(value);
	}
	if (kind === "range") {
		if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isSafeInteger)) {
			throw new TypeError("range must contain two integers");
		}
		return [value[0], value[1]];
	}
	if (kind === "points") {
		if (!Array.isArray(value)) {
			throw new TypeError("control points must be an array");
		}
		return value.map(entry => ({
			x: Number(entry?.x ?? entry?.[0]),
			y: Number(entry?.y ?? entry?.[1]),
		}));
	}
	if (kind === "commands") {
		if (!Array.isArray(value)) {
			throw new TypeError("commands must be an array");
		}
		return value.map(command => ({ ...command }));
	}
	return value;
}

function installSnappeeProperties(Class, Parent, type) {
	for (const [name, kind] of SNAPPEE_PROPERTY_FIELDS[type] || []) {
		const inherited = Object.getOwnPropertyDescriptor(Parent.prototype, name);
		Object.defineProperty(Class.prototype, name, {
			configurable: true,
			enumerable: false,
			get: inherited?.get || function propertyValue() {
				return alive(this, "Snappee")[name];
			},
			set(value) {
				alive(this, "Snappee")[name] = coerceSnappeeProperty(kind, value);
			},
		});
	}
}

function makeSnappeeClass(Parent, type) {
	class SnappeeSubclass extends Parent {
		constructor(...args) {
			if (args.at(-1) === INTERNAL) {
				args.pop();
				super(args[0], {}, INTERNAL);
				return;
			}
			const last = args.at(-1);
			const isOptions = last && typeof last === "object" && !Array.isArray(last);
			const options = isOptions ? args.pop() : {};
			super(type, { ...options, ...(args.length ? subclassArgs(type, args) : {}) });
		}
	}
	installSnappeeProperties(SnappeeSubclass, Parent, type);
	return SnappeeSubclass;
}

function subclassArgs(type, args) {
	if (type === "rectangularMesh") {
		return rectangularMeshArgs(args);
	}
	if (type === "radialMesh") {
		return radialMeshArgs(args);
	}
	if (type === "regularPolygonCurve") {
		return regularPolygonArgs(args);
	}
	if (type === "bezierCurve") {
		return { degree: args[0], controlPoints: args[1], segments: args[2] };
	}
	if (type === "parametricMesh") {
		return { iRange: args[0], jRange: args[1], xExpression: args[2], yExpression: args[3] };
	}
	if (type === "parametricCurve") {
		return { iRange: args[0], xExpression: args[1], yExpression: args[2] };
	}
	return { commands: args[0], segments: args[1], closed: args[2] };
}

function rectangularMeshArgs(args) {
	return {
		topLeftX: args[0],
		topLeftY: args[1],
		bottomRightX: args[2],
		bottomRightY: args[3],
		horizontalTiles: args[4],
		verticalTiles: args[5],
	};
}

function radialMeshArgs(args) {
	return {
		centerX: args[0],
		centerY: args[1],
		radius: args[2],
		azimuthalTiles: args[3],
		radialTiles: args[4],
		startingAngle: args[5] == null ? args[5] : angleValue(args[5]),
	};
}

function regularPolygonArgs(args) {
	return {
		centerX: args[0],
		centerY: args[1],
		radius: args[2],
		angle: args[3] == null ? args[3] : angleValue(args[3]),
		sides: args[4],
		segmentsPerSide: args[5],
	};
}
