import {
	Vector2D,
	angleValue,
	beatTuple,
	checkedSnapPoint,
	clone,
	createBinder,
	ensureAlive,
	nearestSnapPoint,
	snapPointPosition,
} from "./macro-api-math.js";

export const POSITION_FIELDS = ["attached", "x", "y", "snappee", "snapPoint"];

const { ctxOf, extend } = createBinder();

export class Location {
	constructor(x, y, snap) {
		constructLocation(api(new.target), this, x, y, arguments);
	}

	get pos() {
		return locationPos(api(this), this);
	}

	get attached() {
		return Boolean(this._snappee);
	}

	attach() {
		return attachLocation(api(this), this);
	}

	detach() {
		return detachLocation(this);
	}

	get snappee() {
		return this._snappee || null;
	}

	set snappee(value) {
		setLocationSnappee(api(this), this, value);
	}

	get x() {
		return this.pos.x;
	}

	set x(value) {
		this.detach();
		this._x = Number(value) || 0;
	}

	get y() {
		return this.pos.y;
	}

	set y(value) {
		this.detach();
		this._y = Number(value) || 0;
	}
}

export class TipPoint {
	constructor(type = "inherit", values = {}) {
		constructTipPoint(this, type, values);
	}

	static inherit() {
		return new TipPoint("inherit");
	}

	static none() {
		return new TipPoint("none");
	}

	static chain(values = {}) {
		return namedTipPoint("chain", values);
	}

	static drop(values = {}) {
		return namedTipPoint("drop", values);
	}

	get absolute() {
		return Boolean(this._location);
	}

	get relative() {
		return !this.absolute;
	}

	get timeInSeconds() {
		return this._timeSeconds != null;
	}

	get timeInBeats() {
		return !this.timeInSeconds;
	}

	get distance() {
		return this._distance;
	}

	set distance(value) {
		this._distance = finiteOrNull(value, "distance");
		if (value != null) {
			this._location = null;
		}
	}

	get angle() {
		return this._angle;
	}

	set angle(value) {
		this._angle = value == null ? null : angleValue(value);
		if (value != null) {
			this._location = null;
		}
	}

	get location() {
		return this._location;
	}

	set location(value) {
		if (value != null && !(value instanceof Location)) {
			throw new TypeError("location must be a Location");
		}
		this._location = value;
		if (value != null) {
			this._distance = null;
			this._angle = null;
		}
	}

	get timeSeconds() {
		return this._timeSeconds;
	}

	set timeSeconds(value) {
		this._timeSeconds = finiteOrNull(value, "timeSeconds");
		if (value != null) {
			this._timeBeats = null;
		}
	}

	get timeBeats() {
		return this._timeBeats;
	}

	set timeBeats(value) {
		this._timeBeats = value == null ? null : beatTuple(value);
		if (value != null) {
			this._timeSeconds = null;
		}
	}
}

export function installLocationApi(ctx) {
	ctx.Location = extend(ctx, Location);
	ctx.TipPoint = TipPoint;
	ctx.locationFields = locationFields;
	ctx.tipPointFields = tipPointFields;
	ctx.tipValues = tipValues;
	ctx.attachedLocation = (target, snapPoint) => attachedLocation(ctx, target, snapPoint);
	ctx.rawLocation = raw => rawLocation(ctx, raw);
	ctx.assignRawLocation = assignRawLocation;
}

export function locationFields(location) {
	if (!location.attached) {
		return { attached: false, x: location.x, y: location.y };
	}
	return { attached: true, snappee: location.snappee.id, snapPoint: clone(location._snapPoint) };
}

export function tipPointFields(tipPoint) {
	if (!(tipPoint instanceof TipPoint)) {
		throw new TypeError("tipPoint must be a TipPoint");
	}
	const value = { tipPointSpawnType: tipPoint._type, tipPointSpawnAbsolutePosition: tipPoint.absolute };
	assignTipPointPlace(value, tipPoint);
	assignTipPointTime(value, tipPoint);
	return value;
}

export function tipValues(args) {
	if (args[0] instanceof Location && args.length === 2) {
		return { location: args[0], ...tipTime(args[1]) };
	}
	if (!(args[0] instanceof Location) && args.length === 3) {
		return { distance: args[0], angle: args[1], ...tipTime(args[2]) };
	}
	throw new TypeError("tip-point helper expects (location, time) or (distance, angle, time)");
}

export function attachedLocation(ctx, target, snapPoint) {
	const BoundLocation = ctx.Location;
	if (Array.isArray(snapPoint)) {
		return new BoundLocation(target, ...snapPoint);
	}
	return new BoundLocation(target, snapPoint);
}

export function rawLocation(ctx, raw) {
	if (!raw.attached) {
		return new ctx.Location(raw.x ?? 0, raw.y ?? 0);
	}
	const target = ctx.Snappee.getById(raw.snappee);
	if (!target) {
		throw new Error("attached snappee does not exist");
	}
	return attachedLocation(ctx, target, raw.snapPoint);
}

export function assignRawLocation(raw, location) {
	const fields = locationFields(location);
	for (const key of POSITION_FIELDS) {
		delete raw[key];
	}
	Object.assign(raw, fields);
}

function api(self) {
	return ctxOf(typeof self === "function" ? self : self.constructor);
}

function constructLocation(ctx, self, x, y, args) {
	if (x instanceof ctx.Snappee) {
		const raw = ensureAlive(ctx.rawOf(x), "Snappee");
		self._snappee = x;
		self._snapPoint = checkedSnapPoint(raw, Array.from(args).slice(1));
		const point = snapPointPosition(raw, self._snapPoint);
		self._x = point.x;
		self._y = point.y;
		return;
	}
	if (args.length !== 2) {
		throw new TypeError("Location expects (x, y), (curve, i), or (mesh, i, j)");
	}
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		throw new TypeError("Location coordinates must be numbers");
	}
	self._x = x;
	self._y = y;
	self._snappee = null;
	self._snapPoint = null;
}

function locationPos(ctx, self) {
	if (self.attached) {
		const point = snapPointPosition(ensureAlive(ctx.rawOf(self.snappee), "Snappee"), self._snapPoint);
		return new Vector2D(point.x, point.y);
	}
	return new Vector2D(self._x || 0, self._y || 0);
}

function attachLocation(ctx, self) {
	const nearest = ctx.Snappee.list
		.filter(item => item.active)
		.map(item => ({ item, hit: nearestSnapPoint(ctx.rawOf(item), self.x, self.y) }))
		.sort((a, b) => a.hit.distance - b.hit.distance)[0];
	if (nearest) {
		self._snappee = nearest.item;
		self._snapPoint = clone(nearest.hit.snapPoint);
	}
	return self;
}

function detachLocation(self) {
	const point = self.pos;
	self._snappee = null;
	self._snapPoint = null;
	self._x = point.x;
	self._y = point.y;
	return self;
}

function setLocationSnappee(ctx, self, value) {
	if (value == null) {
		self.detach();
		return;
	}
	if (!(value instanceof ctx.Snappee)) {
		throw new TypeError("snappee must be a Snappee");
	}
	const point = self.pos;
	const raw = ensureAlive(ctx.rawOf(value), "Snappee");
	self._snappee = value;
	self._snapPoint = clone(nearestSnapPoint(raw, point.x, point.y).snapPoint);
}

function constructTipPoint(self, type, values) {
	if (values.location != null && (values.distance != null || values.angle != null)) {
		throw new TypeError("absolute tip points cannot have distance or angle");
	}
	if (values.timeSeconds != null && values.timeBeats != null) {
		throw new TypeError("tip point time must be seconds or beats");
	}
	self._type = String(type);
	self._distance = finiteOrNull(values.distance, "distance");
	self._angle = values.angle == null ? null : angleValue(values.angle);
	self._location = values.location ?? null;
	if (self._location != null && !(self._location instanceof Location)) {
		throw new TypeError("location must be a Location");
	}
	self._timeSeconds = finiteOrNull(values.timeSeconds, "timeSeconds");
	self._timeBeats = values.timeBeats == null ? null : beatTuple(values.timeBeats);
}

function namedTipPoint(type, values) {
	if (!values || typeof values !== "object" || Array.isArray(values) || values instanceof Location) {
		throw new TypeError(`TipPoint.${type} expects an options object`);
	}
	return new TipPoint(type, values);
}

function finiteOrNull(value, label) {
	const number = value == null ? null : Number(value);
	if (number != null && !Number.isFinite(number)) {
		throw new TypeError(`${label} must be a finite number`);
	}
	return number;
}

function tipTime(value) {
	if (typeof value === "number" && !Number.isInteger(value)) {
		return { timeSeconds: value };
	}
	return { timeBeats: value };
}

function assignTipPointPlace(value, tipPoint) {
	if (!tipPoint.absolute) {
		value.tipPointSpawnDistance = tipPoint.distance ?? 100;
		value.tipPointSpawnAngle = tipPoint.angle ?? Math.PI / 2;
		return;
	}
	const fields = locationFields(tipPoint.location);
	value.tipPointSpawnAttached = fields.attached;
	if (fields.attached) {
		value.tipPointSpawnSnappee = fields.snappee;
		value.tipPointSpawnSnapPoint = fields.snapPoint;
		return;
	}
	value.tipPointSpawnX = fields.x;
	value.tipPointSpawnY = fields.y;
}

function assignTipPointTime(value, tipPoint) {
	value.tipPointSpawnTimeBeats = tipPoint.timeInBeats;
	if (tipPoint.timeInBeats) {
		value.tipPointSpawnTime = clone(tipPoint.timeBeats ?? [1, 0, 1]);
		return;
	}
	value.tipPointSpawnTime = Number(tipPoint.timeSeconds ?? 1);
}
