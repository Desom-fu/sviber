(function installSviberMacroApi(global) {
	function clone(value) {
		return value == null ? value : JSON.parse(JSON.stringify(value));
	}

	function createSviberMacroApi(sourceState, output = () => {}) {
		const state = clone(sourceState) || {};
		state.metadata ||= {};
		state.editor ||= {};
		state.timing ||= { offset: 0, initialBpm: 120, bpmChanges: [] };
		state.channels ||= [];
		state.events ||= [];
		state.snappees ||= [];
		state.clips ||= [];

		const collection = key => Array.isArray(state[key]) ? state[key] : (state[key] = []);
		const nextId = key => {
			const ids = collection(key).map(item => Number(item?.id)).filter(Number.isSafeInteger);
			return ids.length ? Math.max(...ids) + 1 : 0;
		};
		const resolveId = value => Number(value && typeof value === "object" ? value.id : value);
		const ANGLES = {
			u: -Math.PI / 2, up: -Math.PI / 2, d: Math.PI / 2, down: Math.PI / 2,
			l: Math.PI, left: Math.PI, r: 0, right: 0,
			ul: -3 * Math.PI / 4, lu: -3 * Math.PI / 4, up_left: -3 * Math.PI / 4, left_up: -3 * Math.PI / 4,
			ur: -Math.PI / 4, ru: -Math.PI / 4, up_right: -Math.PI / 4, right_up: -Math.PI / 4,
			dl: 3 * Math.PI / 4, ld: 3 * Math.PI / 4, down_left: 3 * Math.PI / 4, left_down: 3 * Math.PI / 4,
			dr: Math.PI / 4, rd: Math.PI / 4, down_right: Math.PI / 4, right_down: Math.PI / 4,
		};
		const angleValue = value => typeof value === "string" && Object.hasOwn(ANGLES, value.toLowerCase())
			? ANGLES[value.toLowerCase()] : Number(value);
		const gcd = (a, b) => { a = Math.abs(Math.trunc(a)); b = Math.abs(Math.trunc(b)); while (b) [a, b] = [b, a % b]; return a || 1; };
		const beatTuple = value => {
			if (Array.isArray(value) && value.length === 3 && value.every(Number.isSafeInteger)) return value.map(Number);
			let numerator, denominator;
			if (Array.isArray(value) && value.length === 2) [numerator, denominator] = value.map(Number);
			else if (typeof value === "number") { denominator = 1_000_000; numerator = Math.round(value * denominator); }
			else if (value && typeof value === "object" && Number.isSafeInteger(value.numerator)) { numerator = Number(value.numerator); denominator = Number(value.denominator ?? 1); }
			else return clone(value);
			if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) throw new TypeError("beat must be a number or rational tuple");
			if (denominator < 0) { numerator = -numerator; denominator = -denominator; }
			const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
			const whole = Math.trunc(numerator / denominator); const remainder = numerator - whole * denominator;
			return [whole, remainder, denominator];
		};
		const beatNumber = value => { const tuple = beatTuple(value); return Array.isArray(tuple) ? Number(tuple[0]) + Number(tuple[1]) / Number(tuple[2] || 1) : Number(tuple) || 0; };
		const addBeat = (left, right) => beatTuple(beatNumber(left) + beatNumber(right));
		const subBeat = (left, right) => beatTuple(beatNumber(left) - beatNumber(right));
		const normalizeColor = value => {
			if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffff) return `#${value.toString(16).padStart(6, "0")}`;
			if (typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim())) {
				const text = value.trim().toLowerCase();
				return text.length === 4 ? `#${text.slice(1).split("").map(char => char + char).join("")}` : text;
			}
			return value == null ? "#7f7f7f" : String(value);
		};
		const rawWalk = (items, visit) => { for (const item of Array.isArray(items) ? items : []) { visit(item); if (item.type === "group") rawWalk(item.events, visit); } };
		const rawEvents = () => { const result = []; rawWalk(state.events, item => result.push(item)); return result; };
		const rawEventTime = item => item?.type === "group" ? rawEventsFrom(item).filter(child => child.type !== "group" && child.time != null).map(child => beatNumber(child.time)).sort((a, b) => a - b)[0] ?? 0 : beatNumber(item?.time ?? 0);
		const rawEventsFrom = item => { const result = []; rawWalk(item?.events, child => result.push(child)); return result; };
		const find = (key, value) => (key === "events" ? rawEvents() : collection(key)).find(item => Number(item.id) === resolveId(value)) || null;
		const remove = (key, value) => {
			const id = resolveId(value);
			if (key === "events") {
				const removeFrom = items => { for (let index = 0; index < (items || []).length; index += 1) { if (Number(items[index].id) === id) return items.splice(index, 1)[0]; const nested = items[index].type === "group" ? removeFrom(items[index].events) : null; if (nested) return nested; } return null; };
				return removeFrom(state.events);
			}
			const index = collection(key).findIndex(item => Number(item.id) === id);
			return index < 0 ? null : collection(key).splice(index, 1)[0];
		};
		const update = (key, value, changes = {}) => {
			const item = find(key, value);
			if (item) Object.assign(item, clone(changes));
			return item;
		};

		const event = (type, overrides = {}) => {
			overrides = overrides && typeof overrides === "object" ? (overrides.raw || overrides) : {};
			type = ({ bg_note: "bgNote", big_text: "bigText", diamond_grid: "diamondGrid" })[String(type)] || String(type);
			const normalized = clone(overrides);
			if (normalized.location && typeof normalized.location === "object") {
				normalized.x = Number(normalized.location.x); normalized.y = Number(normalized.location.y); delete normalized.location;
			}
			if (normalized.time != null) normalized.time = beatTuple(normalized.time);
			if (normalized.duration != null) normalized.duration = beatTuple(normalized.duration);
			if (normalized.angle != null) normalized.angle = angleValue(normalized.angle);
			if (normalized.color != null) normalized.color = normalizeColor(normalized.color);
			if (normalized.id == null) delete normalized.id;
			const item = {
				id: nextId("events"),
				type: String(type),
				channel: state.editor.currentChannel ?? state.channels[0]?.id ?? 0,
				time: clone(state.editor.currentTime ?? [0, 0, 1]),
				selected: true,
				...normalized,
			};
			state.events.push(item);
			return item;
		};
		const channel = (name = "Channel", overrides = {}) => {
			const item = { id: nextId("channels"), name: String(name), active: true, ...clone(overrides) };
			state.channels.push(item);
			return item;
		};
		const snappee = (type, overrides = {}) => {
			const item = {
				id: nextId("snappees"), type: String(type), name: String(type), active: true,
				transformation: [1, 0, 0, 1, 0, 0], ...clone(overrides),
			};
			state.snappees.push(item);
			return item;
		};
		const selectedIds = values => new Set(values.flat(Infinity).map(resolveId).filter(Number.isFinite));
		const select = (...values) => {
			const ids = selectedIds(values);
			for (const item of state.events) item.selected = ids.has(Number(item.id));
			return state.events.filter(item => item.selected);
		};
		const addSelection = (...values) => {
			const ids = selectedIds(values);
			for (const item of state.events) if (ids.has(Number(item.id))) item.selected = true;
			return state.events.filter(item => item.selected);
		};
		const removeSelection = (...values) => {
			const ids = selectedIds(values);
			for (const item of state.events) if (ids.has(Number(item.id))) item.selected = false;
			return state.events.filter(item => item.selected);
		};
		const clearSelection = () => {
			for (const item of state.events) item.selected = false;
			return [];
		};
		const setTime = value => {
			state.editor.timeSnapped = Array.isArray(value);
			state.editor.currentTime = clone(value);
			return state.editor.currentTime;
		};
		const setCurrentChannel = value => {
			state.editor.currentChannel = resolveId(value);
			return state.editor.currentChannel;
		};
		const log = (...values) => output("log", values);
		class Vector2D {
			constructor(x = 0, y = 0) { this.x = Number(x) || 0; this.y = Number(y) || 0; }
			add(value) { const point = value instanceof Vector2D ? value : new Vector2D(value.x, value.y); return new Vector2D(this.x + point.x, this.y + point.y); }
			sub(value) { const point = value instanceof Vector2D ? value : new Vector2D(value.x, value.y); return new Vector2D(this.x - point.x, this.y - point.y); }
			mul(value) { return new Vector2D(this.x * Number(value), this.y * Number(value)); }
			toArray() { return [this.x, this.y]; }
			to_ary() { return this.toArray(); }
		}
		class AffineMatrix2D {
			constructor(values = [1, 0, 0, 1, 0, 0]) { this.values = [...values].map(Number); }
			translate(x, y) { const point = x instanceof Vector2D ? x : new Vector2D(x, y); this.values[4] += point.x; this.values[5] += point.y; return this; }
			scale(x, y = x) { this.values[0] *= Number(x); this.values[3] *= Number(y); return this; }
			rotate(angle) { const c = Math.cos(Number(angle)), s = Math.sin(Number(angle)); const [a, b, d, e] = this.values; this.values[0] = a * c - b * s; this.values[1] = a * s + b * c; this.values[2] = d * c - e * s; this.values[3] = d * s + e * c; return this; }
			horizontalFlip() { return this.scale(-1, 1); }
			verticalFlip() { return this.scale(1, -1); }
			compose(matrix) { const other = matrix.values || matrix; const [a,b,c,d,tx,ty] = this.values; this.values = [a*other[0]+c*other[1], b*other[0]+d*other[1], a*other[2]+c*other[3], b*other[2]+d*other[3], a*other[4]+c*other[5]+tx, b*other[4]+d*other[5]+ty]; return this; }
			toArray() { return [...this.values]; }
		}
		const wrapEvent = item => item && {
			raw: item, get type() { return item.type; }, set type(value) { item.type = String(value); },
			get time() { return item.time; }, set time(value) { item.time = clone(value); },
			get channel() { return item.channel; }, set channel(value) { item.channel = resolveId(value); },
			get location() { return new Vector2D(item.x, item.y); }, set location(value) { item.x = Number(value.x); item.y = Number(value.y); item.attached = false; },
			get text() { return item.text; }, set text(value) { item.text = String(value); },
			get angle() { return item.angle; }, set angle(value) { item.angle = Number(value); },
			get duration() { return item.duration; }, set duration(value) { item.duration = clone(value); },
			get group() { return item.type === "group"; }, get id() { return item.id; },
			delete() { remove("events", item); }, toJSON() { return clone(item); },
		};
		const eventList = () => collection("events").map(wrapEvent);
		const chartFacade = {
			get current_time() { return state.editor.currentTime; }, set current_time(value) { setTime(value); },
			get currentTime() { return state.editor.currentTime; }, set currentTime(value) { setTime(value); },
			get channels() { return Channel.list; },
			get events() { return Event.list; }, get selected_events() { return Event.selection; },
			get snappees() { return Snappee.list; }, get selected_snappee() { return Snappee.selected; }, get clips() { return Clip.list; },
			get current_channel() { return Channel.current; },
			get bpm_changes() { return BpmChange.list; }, get bar_lines() { return BarLine.list; },
			get offset() { return state.timing.offset; }, set offset(value) { state.timing.offset = Number(value); },
			get initial_bpm() { return state.timing.initialBpm; }, set initial_bpm(value) { state.timing.initialBpm = Number(value); },
		};
		const copyEvents = values => {
			const selected = (values || rawEvents().filter(item => item.selected)).map(value => value.raw || value);
			if (!selected.length) return [];
			const origin = Math.min(...selected.map(item => beatNumber(item.time || 0)));
			const channelOrigin = Math.min(...selected.filter(item => item.channel != null).map(item => Number(item.channel)));
			return selected.map(item => event(item.type || "tap", { ...clone(item), id: null, time: addBeat(state.editor.currentTime, beatNumber(item.time || 0) - origin), channel: Number(state.editor.currentChannel ?? 0) + Number(item.channel ?? channelOrigin) - channelOrigin }));
		};
		const groupEvents = (values, color) => { const children = (values || []).map(value => clone(value.raw || value)); const retained = state.events.filter(candidate => !children.some(child => candidate.id === child.id)); state.events.splice(0, state.events.length, ...retained); const item = event("group", { color: color || "#ff9d3d", events: children }); return new Event(item); };
		const location = (x = 0, y = 0) => x && typeof x === "object" ? new Vector2D(x.x, x.y) : new Vector2D(x, y);
		const channelShortcut = name => { const existing = collection("channels").find(item => item.name === String(name)); return existing || channel(name); };
		const snappeeShortcut = value => typeof value === "string" ? collection("snappees").find(item => item.name === value) : collection("snappees")[Number(value) || 0];
		const tipShortcut = (type, values = {}) => ({ type, ...clone(values) });
		const ensureAlive = (item, kind) => { if (!item || item.__deleted) throw new Error(`${kind} has been deleted`); return item; };
		const eventContainer = id => {
			const visit = items => { for (const item of items || []) { if (item.id === id) return items; if (item.type === "group") { const found = visit(item.events); if (found) return found; } } return null; };
			return visit(state.events);
		};
		class Location {
			constructor(x = 0, y = 0, snap = null) {
				if (x instanceof Location) { this.x = x.x; this.y = x.y; this.snappee = x.snappee; this.snapPoint = clone(x.snapPoint); return; }
				if (x && typeof x === "object" && !Number.isFinite(Number(x))) { this.x = Number(x.x) || 0; this.y = Number(x.y) || 0; this.snappee = snap || x.snappee || null; this.snapPoint = clone(x.snapPoint); }
				else { this.x = Number(x) || 0; this.y = Number(y) || 0; this.snappee = snap || null; this.snapPoint = null; }
			}
			get pos() { return new Vector2D(this.x, this.y); }
			attached() { return Boolean(this.snappee); }
			attachedQ() { return this.attached(); }
			attach(snappee = null, ...point) { const target = snappee instanceof Snappee ? snappee : snappee ? new Snappee(snappee) : Snappee.list.find(item => item.active); if (!target) return this; this.snappee = target; this.snapPoint = point.length ? (point.length > 1 ? point : point[0]) : [0, 0]; return this; }
			detach() { this.snappee = null; this.snapPoint = null; return this; }
			get snappee() { return this._snappee || null; }
			set snappee(value) { this._snappee = value ? (value instanceof Snappee ? value : new Snappee(value)) : null; }
			get x() { return this._x || 0; }
			set x(value) { this._x = Number(value) || 0; if (this._snappee) this.detach(); }
			get y() { return this._y || 0; }
			set y(value) { this._y = Number(value) || 0; if (this._snappee) this.detach(); }
			toJSON() { return this.attached() ? { attached: true, snappee: this.snappee.id, snapPoint: clone(this.snapPoint) } : { attached: false, x: this.x, y: this.y }; }
		}
		class TipPoint {
			constructor(type = "inherit", values = {}) { this.type = type; Object.assign(this, clone(values)); }
			static inherit() { return new TipPoint("inherit"); }
			static none() { return new TipPoint("none"); }
			static chain(values = {}) { return new TipPoint("chain", values); }
			static drop(values = {}) { return new TipPoint("drop", values); }
			get absolute() { return Boolean(this.location); }
			absoluteQ() { return this.absolute; }
			relativeQ() { return !this.absolute; }
			get timeInSeconds() { return this.timeSeconds != null; }
			timeInSecondsQ() { return this.timeInSeconds; }
			timeInBeatsQ() { return !this.timeInSeconds; }
			toJSON() { return { type: this.type, ...clone(this) }; }
		}
		class BpmChange {
			constructor(time, bpm) { this.raw = { time: beatTuple(time), bpm: Number(bpm) }; }
			get time() { return this.raw.time; } get bpm() { return this.raw.bpm; } set bpm(value) { this.raw.bpm = Number(value); }
			delete() { const index = (state.timing.bpmChanges || []).findIndex(item => JSON.stringify(item.time) === JSON.stringify(this.raw.time)); if (index >= 0) state.timing.bpmChanges.splice(index, 1); return this; }
			toJSON() { return clone(this.raw); }
			static get list() { return (state.timing.bpmChanges ||= []).map(item => new BpmChange(item.time, item.bpm)); }
		}
		class BarLine {
			constructor(time) { this.raw = { time: beatTuple(time) }; if (!(state.timing.barLines || []).some(item => JSON.stringify(item.time) === JSON.stringify(this.raw.time))) (state.timing.barLines ||= []).push(this.raw); }
			get time() { return this.raw.time; }
			delete() { const lines = state.timing.barLines || []; const index = lines.findIndex(item => JSON.stringify(item.time) === JSON.stringify(this.raw.time)); if (index >= 0) lines.splice(index, 1); return this; }
			toJSON() { return clone(this.raw); }
			static get list() { return (state.timing.barLines ||= []).map(item => new BarLineView(item)); }
		}
		class BarLineView { constructor(raw) { this.raw = raw; } get time() { return this.raw.time; } delete() { const index = state.timing.barLines.indexOf(this.raw); if (index >= 0) state.timing.barLines.splice(index, 1); } toJSON() { return clone(this.raw); } }
		class Channel {
			constructor(rawOrName = "Channel", overrides = {}) { this.raw = typeof rawOrName === "object" ? rawOrName : { id: nextId("channels"), name: String(rawOrName), active: true, ...clone(overrides) }; if (typeof rawOrName !== "object") state.channels.push(this.raw); }
			get id() { return ensureAlive(this.raw, "Channel").id; } get name() { return ensureAlive(this.raw, "Channel").name; } set name(value) { ensureAlive(this.raw, "Channel").name = String(value); }
			get color() { return this.raw.color; } set color(value) { this.raw.color = normalizeColor(value); }
			get active() { return this.raw.active !== false; } activeQ() { return this.active; } activate() { this.raw.active = true; return this; } deactivate() { this.raw.active = false; return this; }
			currentQ() { return state.editor.currentChannel === this.id; } select() { setCurrentChannel(this.id); return this; }
			moveUp() { const index = state.channels.indexOf(this.raw); if (index > 0) [state.channels[index - 1], state.channels[index]] = [state.channels[index], state.channels[index - 1]]; return this; }
			moveDown() { const index = state.channels.indexOf(this.raw); if (index >= 0 && index < state.channels.length - 1) [state.channels[index], state.channels[index + 1]] = [state.channels[index + 1], state.channels[index]]; return this; }
			get events() { return rawEvents().filter(item => item.type !== "group" && item.channel === this.id).map(item => new Event(item)); }
			delete() { remove("channels", this.raw); this.raw.__deleted = true; return this; } toJSON() { return clone(this.raw); } to_h() { return this.toJSON(); }
			static get list() { return collection("channels").map(item => new Channel(item)); } static get current() { return new Channel(find("channels", state.editor.currentChannel) || state.channels[0]); }
			static get(n) { const value = typeof n === "string" ? collection("channels").find(item => item.name === n) : collection("channels")[Math.max(0, Number(n) - 1)]; return value ? new Channel(value) : null; }
			static getById(id) { const value = find("channels", id); return value ? new Channel(value) : null; }
		}
		class Snappee {
			constructor(rawOrType = "rectangularMesh", overrides = {}) { this.raw = typeof rawOrType === "object" ? rawOrType : snappee(rawOrType, overrides); }
			get id() { return ensureAlive(this.raw, "Snappee").id; } get name() { return this.raw.name; } set name(value) { this.raw.name = String(value); } get color() { return this.raw.color; } set color(value) { this.raw.color = normalizeColor(value); }
			get active() { return this.raw.active !== false; } activeQ() { return this.active; } activate() { this.raw.active = true; return this; } deactivate() { this.raw.active = false; this.raw.selected = false; return this; }
			selectedQ() { return Boolean(this.raw.selected); } select() { for (const item of state.snappees) item.selected = false; this.raw.selected = true; return this; } static deselect() { for (const item of state.snappees) item.selected = false; }
			get pos() { return (...args) => this.position(...args); } position(i = 0, j = 0) { const x = Number(this.raw.centerX ?? this.raw.topLeftX ?? 0), y = Number(this.raw.centerY ?? this.raw.topLeftY ?? 0); return new Vector2D(x + Number(i) * 0, y + Number(j) * 0); }
			moveUp() { const index = state.snappees.indexOf(this.raw); if (index > 0) [state.snappees[index - 1], state.snappees[index]] = [state.snappees[index], state.snappees[index - 1]]; return this; }
			moveDown() { const index = state.snappees.indexOf(this.raw); if (index >= 0 && index < state.snappees.length - 1) [state.snappees[index], state.snappees[index + 1]] = [state.snappees[index + 1], state.snappees[index]]; return this; }
			duplicate(name = this.name, color = this.color) { const copy = clone(this.raw); copy.id = nextId("snappees"); copy.name = name; copy.color = normalizeColor(color); state.snappees.push(copy); return new Snappee(copy); }
			delete() { remove("snappees", this.raw); this.raw.__deleted = true; return this; } toJSON() { return clone(this.raw); } to_h() { return this.toJSON(); }
			static get list() { return collection("snappees").map(item => new Snappee(item)); } static get selected() { const item = collection("snappees").find(value => value.selected); return item ? new Snappee(item) : null; }
			static get(n) { const item = typeof n === "string" ? collection("snappees").find(value => value.name === n) : collection("snappees")[Number(n)]; return item ? new Snappee(item) : null; } static getById(id) { const item = find("snappees", id); return item ? new Snappee(item) : null; }
		}
		class Event {
			constructor(raw) { this.raw = raw; }
			get id() { return ensureAlive(this.raw, "Event").id; } get type() { return this.raw.type; } set type(value) { this.raw.type = ({ bg_note: "bgNote", big_text: "bigText" })[String(value)] || String(value); }
			get movable() { return ["tap", "hold", "drag", "flick", "bgNote", "group"].includes(this.type); } movableQ() { return this.movable; } haveTimeQ() { return this.raw.time != null || this.groupQ(); } haveChannelQ() { return this.type !== "group" && this.raw.channel != null; } haveDurationQ() { return this.raw.duration != null; } haveTextQ() { return ["tap", "hold", "flick", "bgNote", "bigText", "comment"].includes(this.type); } tipPointableQ() { return ["tap", "hold", "drag", "flick"].includes(this.type); } groupQ() { return this.type === "group"; }
			get location() { return new Location(this.raw.x, this.raw.y, this.raw.attached ? Snappee.getById(this.raw.snappee) : null); }
			set location(value) { const point = value instanceof Location ? value : new Location(value); const before = new Location(this.raw.x || 0, this.raw.y || 0); this.raw.attached = false; this.raw.x = point.x; this.raw.y = point.y; if (this.groupQ()) for (const child of rawEventsFrom(this.raw)) if (Number.isFinite(child.x)) { child.x += point.x - before.x; child.y += point.y - before.y; } }
			get anchor() { return new Location(this.raw.x, this.raw.y); } set anchor(value) { const point = value instanceof Location ? value : new Location(value); this.raw.x = point.x; this.raw.y = point.y; this.raw.attached = false; }
			get text() { return this.raw.text; } set text(value) { this.raw.text = String(value); } get angle() { return this.raw.angle; } set angle(value) { this.raw.angle = angleValue(value); } get duration() { return this.raw.duration; } set duration(value) { this.raw.duration = beatTuple(value); }
			get time() { return beatTuple(this.groupQ() ? rawEventTime(this.raw) : this.raw.time); }
			set time(value) { const target = beatNumber(value); if (!this.groupQ()) this.raw.time = beatTuple(value); else { const delta = target - rawEventTime(this.raw); for (const child of rawEventsFrom(this.raw)) if (child.time != null) child.time = addBeat(child.time, delta); } }
			get channel() { return new Channel(find("channels", this.raw.channel)); } set channel(value) { this.raw.channel = resolveId(value); } get events() { return (this.raw.events || []).map(item => new Event(item)); } get color() { return this.raw.color; } set color(value) { this.raw.color = normalizeColor(value); }
			get tipPoint() { return new TipPoint(this.raw.tipPointSpawnType || "inherit", this.raw); } set tipPoint(value) { Object.assign(this.raw, clone(value?.toJSON?.() || value || {})); }
			delete() { remove("events", this.raw); this.raw.__deleted = true; return this; } toJSON() { return clone(this.raw); }
			static get list() { return rawEvents().map(item => new Event(item)); } static get selection() { return rawEvents().filter(item => item.selected).map(item => new Event(item)); }
			static new(options = {}) { const values = clone(options); const type = values.type || "tap"; delete values.type; return new Event(event(type, values)); }
		}
		class Clip {
			constructor(raw) { this.raw = raw || { name: `Clip ${state.clips.length + 1}`, data: { events: [], snappees: [] } }; if (!raw) state.clips.push(this.raw); }
			get name() { return this.raw.name; } set name(value) { this.raw.name = String(value); } get data() { return this.raw.data; }
			moveUp() { const i = state.clips.indexOf(this.raw); if (i > 0) [state.clips[i - 1], state.clips[i]] = [state.clips[i], state.clips[i - 1]]; return this; } moveDown() { const i = state.clips.indexOf(this.raw); if (i >= 0 && i < state.clips.length - 1) [state.clips[i], state.clips[i + 1]] = [state.clips[i + 1], state.clips[i]]; return this; }
			paste(time = state.editor.currentTime, channel = state.editor.currentChannel) { const values = this.raw.data?.events || []; return values.map(item => event(item.type, { ...clone(item), id: null, time: addBeat(time, item.time || 0), channel: resolveId(channel) })); }
			delete() { const i = state.clips.indexOf(this.raw); if (i >= 0) state.clips.splice(i, 1); return this; } toJSON() { return clone(this.raw); } to_h() { return this.toJSON(); }
			static get list() { return state.clips.map(item => new Clip(item)); } static new(events, name) { const clip = new Clip(); clip.name = name || clip.name; clip.raw.data.events = (events || []).map(item => clone(item.raw || item)); return clip; } static get(n) { const item = state.clips[Number(n)]; return item ? new Clip(item) : null; }
		}
		const RectangularMesh = Snappee, RadialMesh = Snappee, ParametricMesh = Snappee, RegularPolygonCurve = Snappee, BezierCurve = Snappee, PenCurve = Snappee, ParametricCurve = Snappee;

		return {
			state, chart: state, Chart: chartFacade, Vector2D, AffineMatrix2D, Location, TipPoint, BpmChange, BarLine, Channel, Snappee,
			RectangularMesh, RadialMesh, ParametricMesh, RegularPolygonCurve, BezierCurve, PenCurve, ParametricCurve, Event, Clip,
			metadata: state.metadata, editor: state.editor, timing: state.timing,
			events: state.events, channels: state.channels, snappees: state.snappees,
			event, addEvent: event,
			tap: overrides => event("tap", overrides), t: overrides => event("tap", overrides),
			hold: overrides => event("hold", overrides), h: overrides => event("hold", overrides),
			drag: overrides => event("drag", overrides), d: overrides => event("drag", overrides),
			flick: overrides => event("flick", overrides), f: overrides => event("flick", overrides),
			bgNote: overrides => event("bgNote", overrides), bg: overrides => event("bgNote", overrides),
			channel, addChannel: channel, snappee, addSnappee: snappee,
			findEvent: value => find("events", value), findChannel: value => find("channels", value),
			findSnappee: value => find("snappees", value), eventList,
			updateEvent: (value, changes) => update("events", value, changes),
			updateChannel: (value, changes) => update("channels", value, changes),
			updateSnappee: (value, changes) => update("snappees", value, changes),
			removeEvent: value => remove("events", value), removeChannel: value => remove("channels", value),
			removeSnappee: value => remove("snappees", value),
			select, addSelection, removeSelection, clearSelection, setTime, setCurrentChannel, clone, log,
			b: value => value == null ? state.editor.currentTime : setTime(addBeat(state.editor.currentTime, value)),
			bBang: value => value == null ? state.editor.currentTime : setTime(value),
			bpm: value => { const time = clone(state.editor.currentTime); const changes = state.timing.bpmChanges || (state.timing.bpmChanges = []); const existing = changes.find(change => JSON.stringify(change.time) === JSON.stringify(time)); if (existing) existing.bpm = Number(value); else changes.push({ time, bpm: Number(value) }); return value; },
			g: groupEvents, group: groupEvents, copy: copyEvents,
			transform: (things, matrix = [1, 0, 0, 1, 0, 0]) => { const values = matrix?.values || matrix; const [a,b,c,d,tx,ty] = values; const visit = value => { const item = value.raw || value; if (item?.type === "group") for (const child of item.events || []) visit(child); if (item && Number.isFinite(item.x)) { const x = item.x, y = item.y; item.x = a*x+c*y+tx; item.y = b*x+d*y+ty; } if (item?.transformation) item.transformation = [a*item.transformation[0]+c*item.transformation[1], b*item.transformation[0]+d*item.transformation[1], a*item.transformation[2]+c*item.transformation[3], b*item.transformation[2]+d*item.transformation[3], a*item.transformation[4]+c*item.transformation[5]+tx, b*item.transformation[4]+d*item.transformation[5]+ty]; }; for (const value of (Array.isArray(things) ? things : [things])) visit(value); return things; },
			tipPoint: (type = "inherit", values = {}) => new TipPoint(type, values),
			c: channelShortcut, s: snappeeShortcut, l: location,
			tpc: (...args) => new TipPoint("chain", args.length === 1 ? { location: clone(args[0]) } : { distance: args[0], angle: angleValue(args[1]), timeBeats: args[2] }),
			tpd: (...args) => new TipPoint("drop", args.length === 1 ? { location: clone(args[0]) } : { distance: args[0], angle: angleValue(args[1]), timeBeats: args[2] }),
			bigText: overrides => event("bigText", overrides), grid: overrides => event("grid", overrides), diamondGrid: overrides => event("diamondGrid", overrides), hexagon: overrides => event("hexagon", overrides),
		};
	}

	global.createSviberMacroApi = createSviberMacroApi;
})(globalThis);
