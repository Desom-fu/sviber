import {
	INTERNAL,
	AffineMatrix2D,
	addBeat,
	affineMatrixValues,
	beatNumber,
	beatTuple,
	clone,
	createBinder,
	ensureAlive,
	moveListItem,
	snapPointPosition,
	transformPoint,
} from "./macro-api-math.js";

const { ctxOf, extend } = createBinder();

export class Clip {
	constructor(events, name = null, token = null) {
		constructClip(api(new.target), this, events, name, token);
	}

	get name() {
		return alive(this, "Clip").name;
	}

	set name(value) {
		alive(this, "Clip").name = String(value);
	}

	moveUp() {
		moveListItem(api(this).state.clips, alive(this, "Clip"), -1);
		return this;
	}

	moveDown() {
		moveListItem(api(this).state.clips, alive(this, "Clip"), 1);
		return this;
	}

	paste(time, channel) {
		const ctx = api(this);
		const raw = alive(this, "Clip");
		return pasteClipData(ctx, raw.data, beatTuple(time), channel);
	}

	delete() {
		const ctx = api(this);
		const raw = alive(this, "Clip");
		const i = ctx.state.clips.indexOf(raw);
		if (i >= 0) {
			ctx.state.clips.splice(i, 1);
		}
		raw.__deleted = true;
		return this;
	}

	toJSON() {
		return clone(alive(this, "Clip"));
	}

	static get(n) {
		if (!Number.isInteger(n)) {
			throw new TypeError("clip number must be an integer");
		}
		const ctx = api(this);
		return ctx.wrapClip(ctx.state.clips[n]);
	}
}

export function installChartApi(ctx) {
	ctx.Chart = createChartFacade(ctx);
	ctx.Clip = extend(ctx, Clip);
	ctx.wrapClip = raw => (raw ? new ctx.Clip(raw, null, INTERNAL) : null);
	ctx.copyEvents = values => copyEvents(ctx, values);
	ctx.transformThings = (things, matrix) => transformThings(ctx, things, matrix);
	ctx.groupShortcut = (values, color, block) => groupShortcut(ctx, values, color, block);
	ctx.locationShortcut = (...args) => new ctx.Location(...args);
	ctx.channelShortcut = name => (ctx.Channel.get(name) || new ctx.Channel({ name })).select();
	ctx.snappeeShortcut = value => ctx.Snappee.get(value);
	ctx.setBpm = value => setBpm(ctx, value);
}

function api(self) {
	return ctxOf(typeof self === "function" ? self : self.constructor);
}

function alive(self, kind) {
	return ensureAlive(api(self).rawOf(self), kind);
}

function constructClip(ctx, self, events, name, token) {
	if (token === INTERNAL) {
		ctx.wrapperRecords.set(self, events);
		return;
	}
	if (!Array.isArray(events)) {
		throw new TypeError("Clip events must be an array");
	}
	const raw = { name: String(name ?? `Clip ${ctx.state.clips.length + 1}`), data: clipDataFor(ctx, events) };
	ctx.wrapperRecords.set(self, raw);
	ctx.state.clips.push(raw);
}

function createChartFacade(ctx) {
	return {
		get currentTime() {
			return beatTuple(ctx.state.editor.currentTime);
		},
		set currentTime(value) {
			ctx.setTime(value);
		},
		get channels() {
			return ctx.Channel.list;
		},
		get currentChannel() {
			return ctx.Channel.current;
		},
		get snappees() {
			return ctx.Snappee.list;
		},
		get selectedSnappee() {
			return ctx.Snappee.selected;
		},
		get clips() {
			return ctx.state.clips.map(ctx.wrapClip);
		},
		get events() {
			return ctx.Event.list;
		},
		get selectedEvents() {
			return ctx.Event.selection;
		},
		get offset() {
			return ctx.state.timing.offset;
		},
		set offset(value) {
			ctx.state.timing.offset = Number(value);
		},
		get initialBpm() {
			return ctx.state.timing.initialBpm;
		},
		set initialBpm(value) {
			ctx.state.timing.initialBpm = Number(value);
		},
		get bpmChanges() {
			return ctx.BpmChange.list;
		},
		get barLines() {
			return ctx.BarLine.list;
		},
	};
}

function eventChannels(ctx, item) {
	return (item.type === "group" ? ctx.rawEventsFrom(item) : [item]).filter(
		child => child.type !== "group" && child.channel != null,
	);
}

function copyEvents(ctx, values) {
	if (!Array.isArray(values)) {
		throw new TypeError("copy expects an array of events");
	}
	return shiftedCopies(ctx, values, ctx.state.editor.currentTime, ctx.state.editor.currentChannel);
}

function shiftedCopies(ctx, values, time, channelValue) {
	const source = values.map(value => ensureAlive(ctx.rawOf(value), "Event"));
	if (!source.length) {
		return [];
	}
	const origin = Math.min(...source.map(ctx.rawEventTime));
	const range = channelRange(ctx, source);
	let targetChannel = ctx.state.channels.findIndex(channel => channel.id === ctx.resolveId(channelValue));
	if (targetChannel < 0) {
		throw new Error("paste channel does not exist");
	}
	while (targetChannel + range.maximumChannel - range.minimumChannel >= ctx.state.channels.length) {
		new ctx.Channel();
	}
	return source.map(item => wrapShiftedCopy(ctx, item, time, origin, targetChannel, range.minimumChannel));
}

function channelRange(ctx, source) {
	const sourceIndices = source
		.flatMap(item => eventChannels(ctx, item))
		.map(item => ctx.state.channels.findIndex(channel => channel.id === item.channel));
	if (sourceIndices.some(index => index < 0)) {
		throw new Error("event refers to a channel that does not exist");
	}
	const minimumChannel = sourceIndices.length ? Math.min(...sourceIndices) : 0;
	const maximumChannel = sourceIndices.length ? Math.max(...sourceIndices) : minimumChannel;
	return { minimumChannel, maximumChannel };
}

function wrapShiftedCopy(ctx, item, time, origin, targetChannel, minimumChannel) {
	const copy = shiftCopy(ctx, item, time, origin, targetChannel, minimumChannel);
	return ctx.wrapEventClass(ctx.createEventRecord(copy.type, copy));
}

function shiftCopy(ctx, item, time, origin, targetChannel, minimumChannel) {
	const copy = clone(item);
	copy.id = null;
	if (copy.time != null) {
		copy.time = addBeat(time, beatNumber(copy.time) - origin);
	}
	if (copy.channel != null) {
		const sourceIndex = ctx.state.channels.findIndex(channel => channel.id === copy.channel);
		copy.channel = ctx.state.channels[targetChannel + sourceIndex - minimumChannel].id;
	}
	if (copy.type === "group") {
		copy.events = (copy.events || []).map(child =>
			shiftCopy(ctx, child, time, origin, targetChannel, minimumChannel),
		);
	}
	return copy;
}

function groupEvents(ctx, values, color) {
	const children = Array.from(values || [], value => ensureAlive(ctx.rawOf(value), "Event"));
	for (const child of children) {
		ctx.detachEvent(child);
	}
	return ctx.wrapEventClass(ctx.createEventRecord("group", { color: color ?? "#ff9d3d", events: children }));
}

function groupShortcut(ctx, values, color, block) {
	if (typeof values === "function") {
		block = values;
		color = null;
		values = null;
	}
	if (typeof color === "function") {
		block = color;
		color = values;
		values = null;
	}
	if (typeof block === "function") {
		const before = new Set(ctx.state.events);
		block();
		const added = ctx.state.events.filter(item => !before.has(item));
		return groupEvents(ctx, added, color);
	}
	return groupEvents(ctx, values || [], color);
}

function transformThings(ctx, things, matrix = ctx.OMITTED) {
	const resolved = resolveTransformMatrix(matrix);
	const values = affineMatrixValues(resolved);
	const targets = Array.isArray(things) ? things : [things];
	assertTransformTargets(ctx, targets);
	for (const value of targets) {
		visitTransformTarget(ctx, value, values);
	}
	return things;
}

function resolveTransformMatrix(matrix) {
	if (typeof matrix === "function") {
		const callback = matrix;
		matrix = new AffineMatrix2D();
		callback.call(matrix, matrix);
	}
	if (!(matrix instanceof AffineMatrix2D)) {
		throw new TypeError("transform matrix must be an AffineMatrix2D or a callback");
	}
	return matrix;
}

function assertTransformTargets(ctx, targets) {
	if (targets.some(value => !(value instanceof ctx.Event) && !(value instanceof ctx.Snappee))) {
		throw new TypeError("transform expects events or snappees");
	}
	if (targets.some(value => value instanceof ctx.Event) && targets.some(value => value instanceof ctx.Snappee)) {
		throw new TypeError("transform arrays cannot mix events and snappees");
	}
}

function visitTransformTarget(ctx, value, values) {
	const kind = value instanceof ctx.Snappee ? "Snappee" : "Event";
	const item = ensureAlive(ctx.rawOf(value), kind);
	if (item.type === "group") {
		for (const child of item.events || []) {
			visitTransformTarget(ctx, ctx.wrapEventClass(child), values);
		}
	}
	transformTipPoint(ctx, item, values);
	transformCoordinates(ctx, item, values);
	transformFlickAngle(item, values);
	transformOwnMatrix(item, values);
}

function transformCoordinates(ctx, item, values) {
	if (item.attached) {
		const position = snapPointPosition(ctx.find("snappees", item.snappee), item.snapPoint);
		const transformed = transformPoint(position, values);
		item.attached = false;
		item.x = transformed.x;
		item.y = transformed.y;
		delete item.snappee;
		delete item.snapPoint;
		return;
	}
	if (Number.isFinite(item.x) && Number.isFinite(item.y)) {
		const transformed = transformPoint({ x: item.x, y: item.y }, values);
		item.x = transformed.x;
		item.y = transformed.y;
	}
}

function transformFlickAngle(item, values) {
	const [a, b, c, d] = values;
	if (item.type === "flick" && Number.isFinite(item.angle)) {
		item.angle = Math.atan2(
			b * Math.cos(item.angle) + d * Math.sin(item.angle),
			a * Math.cos(item.angle) + c * Math.sin(item.angle),
		);
	}
}

function transformOwnMatrix(item, values) {
	const [a, b, c, d, tx, ty] = values;
	if (!item.transformation) {
		return;
	}
	item.transformation = [
		a * item.transformation[0] + c * item.transformation[1],
		b * item.transformation[0] + d * item.transformation[1],
		a * item.transformation[2] + c * item.transformation[3],
		b * item.transformation[2] + d * item.transformation[3],
		a * item.transformation[4] + c * item.transformation[5] + tx,
		b * item.transformation[4] + d * item.transformation[5] + ty,
	];
}

function transformTipPoint(ctx, item, values) {
	if (!ctx.TIP_POINTABLE_TYPES.has(item.type) || !["chain", "drop"].includes(item.tipPointSpawnType)) {
		return;
	}
	if (!item.tipPointSpawnAbsolutePosition) {
		transformRelativeTipPoint(item, values);
		return;
	}
	transformAbsoluteTipPoint(ctx, item, values);
}

function transformRelativeTipPoint(item, values) {
	const distance = Math.max(0, Number(item.tipPointSpawnDistance) || 0);
	const rawAngle = Number(item.tipPointSpawnAngle);
	const angle = Number.isFinite(rawAngle) ? rawAngle : Math.PI / 2;
	const origin = transformPoint({ x: 0, y: 0 }, values);
	const endpoint = transformPoint({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance }, values);
	const dx = endpoint.x - origin.x;
	const dy = endpoint.y - origin.y;
	item.tipPointSpawnDistance = Math.hypot(dx, dy);
	if (item.tipPointSpawnDistance > 1e-12) {
		item.tipPointSpawnAngle = Math.atan2(dy, dx);
	}
}

function transformAbsoluteTipPoint(ctx, item, values) {
	const tipSnappee = item.tipPointSpawnAttached ? ctx.find("snappees", item.tipPointSpawnSnappee) : null;
	if (item.tipPointSpawnAttached && !tipSnappee) {
		throw new Error("attached tip-point snappee does not exist");
	}
	let position = { x: Number(item.tipPointSpawnX) || 0, y: Number(item.tipPointSpawnY) || 0 };
	if (item.tipPointSpawnAttached) {
		position = snapPointPosition(tipSnappee, item.tipPointSpawnSnapPoint);
	}
	const transformed = transformPoint(position, values);
	item.tipPointSpawnAttached = false;
	item.tipPointSpawnX = transformed.x;
	item.tipPointSpawnY = transformed.y;
	delete item.tipPointSpawnSnappee;
	delete item.tipPointSpawnSnapPoint;
}

function clipDataFor(ctx, values) {
	const source = values.map(value => ensureAlive(ctx.rawOf(value), "Event"));
	if (!source.length) {
		return { version: 1, events: [], channels: [], snappees: [] };
	}
	const leaves = clipLeaves(ctx, source);
	const channelIndices = leaves.map(item => ctx.state.channels.findIndex(channel => channel.id === item.channel));
	if (channelIndices.some(index => index < 0)) {
		throw new Error("event refers to a channel that does not exist");
	}
	const minimumChannel = channelIndices.length ? Math.min(...channelIndices) : 0;
	const maximumChannel = channelIndices.length ? Math.max(...channelIndices) : minimumChannel;
	const origin = Math.min(...source.map(ctx.rawEventTime));
	return {
		version: 1,
		events: source.map(item => normalizeClipEvent(ctx, item, origin, minimumChannel)),
		channels: ctx.state.channels
			.slice(minimumChannel, maximumChannel + 1)
			.map((item, index) => ({ ...clone(item), channelOffset: index })),
		snappees: clipSnappees(ctx, leaves),
	};
}

function clipLeaves(ctx, source) {
	return source
		.flatMap(item => (item.type === "group" ? ctx.rawEventsFrom(item) : [item]))
		.filter(item => item.type !== "group");
}

function normalizeClipEvent(ctx, item, origin, minimumChannel) {
	const copy = clone(item);
	copy.id = null;
	if (copy.type === "group") {
		copy.events = (copy.events || []).map(child => normalizeClipEvent(ctx, child, origin, minimumChannel));
	} else {
		copy.time = addBeat(copy.time, -origin);
		copy.channel = ctx.state.channels.findIndex(channel => channel.id === copy.channel) - minimumChannel;
	}
	return copy;
}

function clipSnappees(ctx, leaves) {
	const snappeeIds = new Set(
		leaves.flatMap(item => [item.snappee, item.tipPointSpawnSnappee]).filter(value => value != null),
	);
	return ctx.state.snappees.filter(item => snappeeIds.has(item.id)).map(clone);
}

function pasteClipData(ctx, data, time, channelValue) {
	const source = Array.isArray(data?.events) ? data.events : [];
	if (!source.length) {
		return [];
	}
	const targetChannel = ctx.state.channels.findIndex(channel => channel.id === ctx.resolveId(channelValue));
	if (targetChannel < 0) {
		throw new Error("paste channel does not exist");
	}
	ensurePasteChannels(ctx, source, targetChannel);
	return source.map(item => {
		const copy = shiftPastedEvent(ctx, item, time, targetChannel);
		return ctx.wrapEventClass(ctx.createEventRecord(copy.type, copy));
	});
}

function ensurePasteChannels(ctx, source, targetChannel) {
	const leaves = source
		.flatMap(item => (item.type === "group" ? ctx.rawEventsFrom(item) : [item]))
		.filter(item => item.type !== "group");
	const offsets = leaves.map(item => Number(item.channel));
	if (offsets.some(value => !Number.isInteger(value) || value < 0)) {
		throw new TypeError("clip channel offsets must be nonnegative integers");
	}
	const maximumOffset = offsets.length ? Math.max(...offsets) : 0;
	while (targetChannel + maximumOffset >= ctx.state.channels.length) {
		new ctx.Channel();
	}
}

function shiftPastedEvent(ctx, item, time, targetChannel) {
	const copy = clone(item);
	copy.id = null;
	if (copy.type === "group") {
		copy.events = (copy.events || []).map(child => shiftPastedEvent(ctx, child, time, targetChannel));
	} else {
		copy.time = addBeat(time, copy.time);
		copy.channel = ctx.state.channels[targetChannel + Number(copy.channel)].id;
	}
	return copy;
}

function setBpm(ctx, value) {
	const time = clone(ctx.state.editor.currentTime);
	const changes = ctx.state.timing.bpmChanges || (ctx.state.timing.bpmChanges = []);
	const existing = changes.find(change => JSON.stringify(change.time) === JSON.stringify(time));
	if (existing) {
		existing.bpm = Number(value);
	} else {
		changes.push({ time, bpm: Number(value) });
	}
	return value;
}
