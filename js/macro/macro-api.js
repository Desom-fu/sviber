import {
	INTERNAL,
	OMITTED,
	AffineMatrix2D,
	Vector2D,
	addBeat,
	beatNumber,
	beatTuple,
	clone,
} from "./macro-api-math.js";
import { installLocationApi } from "./macro-api-location.js";
import { installEntitiesApi } from "./macro-api-entities.js";
import { installEventApi } from "./macro-api-event.js";
import { installChartApi } from "./macro-api-chart.js";

export function createSviberMacroApi(sourceState, output = () => {}) {
	const state = initializeMacroState(sourceState);
	const ctx = createMacroContext(state, output);
	installLocationApi(ctx);
	installEntitiesApi(ctx);
	installEventApi(ctx);
	installChartApi(ctx);
	return { state, globals: createMacroGlobals(ctx) };
}

globalThis.createSviberMacroApi = createSviberMacroApi;

function initializeMacroState(sourceState) {
	const state = clone(sourceState) || {};
	state.metadata ||= {};
	state.editor ||= {};
	state.timing ||= { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] };
	state.timing.barLines ||= [];
	state.channels ||= [];
	state.events ||= [];
	state.snappees ||= [];
	state.clips ||= [];
	return state;
}

function createMacroContext(state, output) {
	const ctx = { state, output, INTERNAL, OMITTED, wrapperRecords: new WeakMap() };
	bindStateHelpers(ctx);
	return ctx;
}

function bindStateHelpers(ctx) {
	ctx.rawOf = value => rawOf(ctx, value);
	ctx.collection = key => collectionOf(ctx, key);
	ctx.nextId = key => nextId(ctx, key);
	ctx.resolveId = value => Number(ctx.rawOf(value)?.id ?? value);
	ctx.rawWalk = (items, visit) => rawWalk(items, visit);
	ctx.rawEvents = () => collectEvents(ctx.state.events);
	ctx.rawEventsFrom = item => collectEvents(item?.events);
	ctx.rawEventTime = item => rawEventTime(ctx, item);
	ctx.find = (key, value) => findItem(ctx, key, value);
	ctx.remove = (key, value) => removeItem(ctx, key, value);
	ctx.setTime = value => setTime(ctx, value);
	ctx.setCurrentChannel = value => setCurrentChannel(ctx, value);
}

function rawOf(ctx, value) {
	return value && typeof value === "object" ? ctx.wrapperRecords.get(value) || value : value;
}

function collectionOf(ctx, key) {
	return Array.isArray(ctx.state[key]) ? ctx.state[key] : (ctx.state[key] = []);
}

function collectEvents(values, result = []) {
	for (const item of values || []) {
		result.push(item);
		if (item.type === "group") {
			collectEvents(item.events, result);
		}
	}
	return result;
}

function rawWalk(items, visit) {
	for (const item of Array.isArray(items) ? items : []) {
		visit(item);
		if (item.type === "group") {
			rawWalk(item.events, visit);
		}
	}
}

function nextId(ctx, key) {
	// Ids are allocated per collection. Events nest inside groups, so every descendant counts
	// when looking for the highest id in use.
	const items = key === "events" ? collectEvents(ctx.state.events) : collectionOf(ctx, key);
	const ids = items.map(item => Number(item?.id)).filter(Number.isSafeInteger);
	const counterKey = { events: "event", channels: "channel", snappees: "snappee" }[key];
	const next = Math.max(ids.length ? Math.max(...ids) + 1 : 0, Number(ctx.state.nextIds?.[counterKey]) || 0);
	ctx.state.nextIds ||= {};
	ctx.state.nextIds[counterKey] = next + 1;
	return next;
}

function rawEventTime(ctx, item) {
	if (item?.type !== "group") {
		return beatNumber(item?.time ?? 0);
	}
	const times = collectEvents(item?.events)
		.filter(child => child.type !== "group" && child.time != null)
		.map(child => beatNumber(child.time))
		.sort((a, b) => a - b);
	return times[0] ?? 0;
}

function findItem(ctx, key, value) {
	const items = key === "events" ? collectEvents(ctx.state.events) : collectionOf(ctx, key);
	return items.find(item => Number(item.id) === ctx.resolveId(value)) || null;
}

function removeItem(ctx, key, value) {
	const id = ctx.resolveId(value);
	if (key === "events") {
		return removeEventById(ctx.state.events, id);
	}
	const items = collectionOf(ctx, key);
	const index = items.findIndex(item => Number(item.id) === id);
	return index < 0 ? null : items.splice(index, 1)[0];
}

function removeEventById(items, id) {
	for (let index = 0; index < (items || []).length; index += 1) {
		if (Number(items[index].id) === id) {
			return items.splice(index, 1)[0];
		}
		const nested = items[index].type === "group" ? removeEventById(items[index].events, id) : null;
		if (nested) {
			return nested;
		}
	}
	return null;
}

function setTime(ctx, value) {
	ctx.state.editor.timeSnapped = true;
	ctx.state.editor.currentTime = beatTuple(value);
	return ctx.state.editor.currentTime;
}

function setCurrentChannel(ctx, value) {
	ctx.state.editor.currentChannel = ctx.resolveId(value);
	return ctx.state.editor.currentChannel;
}

function createMacroGlobals(ctx) {
	return {
		...classGlobals(ctx),
		...helperGlobals(ctx),
		...noteGlobals(ctx),
	};
}

function classGlobals(ctx) {
	return {
		Chart: ctx.Chart,
		Vector2D,
		AffineMatrix2D,
		Location: ctx.Location,
		TipPoint: ctx.TipPoint,
		BpmChange: ctx.BpmChange,
		BarLine: ctx.BarLine,
		Channel: ctx.Channel,
		Snappee: ctx.Snappee,
		RectangularMesh: ctx.RectangularMesh,
		RadialMesh: ctx.RadialMesh,
		ParametricMesh: ctx.ParametricMesh,
		RegularPolygonCurve: ctx.RegularPolygonCurve,
		BezierCurve: ctx.BezierCurve,
		PenCurve: ctx.PenCurve,
		ParametricCurve: ctx.ParametricCurve,
		Event: ctx.Event,
		Tap: ctx.Tap,
		Hold: ctx.Hold,
		Drag: ctx.Drag,
		Flick: ctx.Flick,
		BgNote: ctx.BgNote,
		BigText: ctx.BigText,
		Grid: ctx.Grid,
		DiamondGrid: ctx.DiamondGrid,
		Hexagon: ctx.Hexagon,
		Checkerboard: ctx.Checkerboard,
		Pentagon: ctx.Pentagon,
		Turntable: ctx.Turntable,
		Hexagram: ctx.Hexagram,
		Comment: ctx.Comment,
		Group: ctx.Group,
		Clip: ctx.Clip,
	};
}

function helperGlobals(ctx) {
	const { state, OMITTED: omitted } = ctx;
	return {
		b: (value = omitted) => advanceTime(ctx, value, omitted),
		bBang: (value = omitted) => (value === omitted ? beatTuple(state.editor.currentTime) : ctx.setTime(value)),
		bpm: value => ctx.setBpm(value),
		g: ctx.groupShortcut,
		copy: ctx.copyEvents,
		transform: ctx.transformThings,
		c: ctx.channelShortcut,
		s: ctx.snappeeShortcut,
		l: ctx.locationShortcut,
		tpc: (...args) => new ctx.TipPoint("chain", ctx.tipValues(args)),
		tpd: (...args) => new ctx.TipPoint("drop", ctx.tipValues(args)),
	};
}

function advanceTime(ctx, value, omitted) {
	if (value === omitted) {
		return beatTuple(ctx.state.editor.currentTime);
	}
	return ctx.setTime(addBeat(ctx.state.editor.currentTime, value));
}

function noteGlobals(ctx) {
	const time = () => ctx.Chart.currentTime;
	const channel = () => ctx.Channel.current;
	return {
		t: (location, text = "") => new ctx.Tap({ location, time: time(), channel: channel(), text }),
		h: (location, duration, text = "") =>
			new ctx.Hold({ location, time: time(), channel: channel(), duration, text }),
		d: location => new ctx.Drag({ location, time: time(), channel: channel() }),
		f: (location, angle, text = "") =>
			new ctx.Flick({ location, time: time(), channel: channel(), angle, text }),
		bgNote: (location, duration = 0, text = "") => {
			if (typeof duration === "string" && text === "") {
				text = duration;
				duration = 0;
			}
			return new ctx.BgNote({
				location,
				time: time(),
				channel: channel(),
				duration,
				text,
			});
		},
		bigText: (duration, text = "") => new ctx.BigText({ time: time(), channel: channel(), duration, text }),
		grid: duration => new ctx.Grid({ time: time(), channel: channel(), duration }),
		diamondGrid: duration => new ctx.DiamondGrid({ time: time(), channel: channel(), duration }),
		hexagon: duration => new ctx.Hexagon({ time: time(), channel: channel(), duration }),
		checkerboard: duration => new ctx.Checkerboard({ time: time(), channel: channel(), duration }),
		pentagon: duration => new ctx.Pentagon({ time: time(), channel: channel(), duration }),
		turntable: duration => new ctx.Turntable({ time: time(), channel: channel(), duration }),
		hexagram: duration => new ctx.Hexagram({ time: time(), channel: channel(), duration }),
	};
}
