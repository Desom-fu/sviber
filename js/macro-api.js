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
			if (typeof value === "string") {
				const text = value.trim().toLowerCase();
				if (/^#[0-9a-f]{3,8}$/i.test(text)) return text.length === 4 ? `#${text.slice(1).split("").map(char => char + char).join("")}` : text;
				const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
				if (rgb) return `#${rgb.slice(1, 4).map(channel => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, "0")).join("")}`;
				const named = { red: "#ff0000", green: "#008000", blue: "#0000ff", white: "#ffffff", black: "#000000", yellow: "#ffff00", magenta: "#ff00ff", cyan: "#00ffff", transparent: "#00000000" };
				if (named[text]) return named[text];
			}
			return value == null ? "#7f7f7f" : String(value);
		};
		const transformPoint = (point, matrix) => {
			const [a, b, c, d, tx, ty] = matrix;
			return { x: a * point.x + c * point.y + tx, y: b * point.x + d * point.y + ty };
		};
		const snapPointKey = point => Array.isArray(point) ? point.join(",") : String(point);
		const evaluateExpression = (expression, scope) => {
			if (typeof expression === "number") return expression;
			if (typeof expression === "function") return Number(expression(scope));
			const text = String(expression ?? "0").trim();
			if (Object.hasOwn(scope, text)) return Number(scope[text]);
			if (global.math?.evaluate) return Number(global.math.evaluate(text, scope));
			if (/^[+-]?[\d.]+$/.test(text)) return Number(text);
			return 0;
		};
		const snapPointPosition = (raw, point) => {
			const p = Array.isArray(point) ? point : [point];
			let x = 0, y = 0;
			switch (raw?.type) {
				case "rectangularMesh": {
					const i = Number(p[0] ?? 0), j = Number(p[1] ?? 0);
					x = Number(raw.topLeftX ?? -100) + i * (Number(raw.bottomRightX ?? 100) - Number(raw.topLeftX ?? -100)) / Math.max(1, Number(raw.horizontalTiles ?? 1));
					y = Number(raw.topLeftY ?? 50) + j * (Number(raw.bottomRightY ?? -50) - Number(raw.topLeftY ?? 50)) / Math.max(1, Number(raw.verticalTiles ?? 1));
					break;
				}
				case "radialMesh": {
					const i = Number(p[0] ?? 0), j = Number(p[1] ?? 0), m = Math.max(1, Number(raw.azimuthalTiles ?? 1)), n = Math.max(1, Number(raw.radialTiles ?? 1));
					const angle = Number(raw.startingAngle ?? raw.angle ?? 0) + i * Math.PI * 2 / m;
					x = Number(raw.centerX ?? 0) + Number(raw.radius ?? 50) * j / n * Math.cos(angle);
					y = Number(raw.centerY ?? 0) + Number(raw.radius ?? 50) * j / n * Math.sin(angle);
					break;
				}
				case "parametricMesh": {
					const scope = { i: Number(p[0] ?? 0), j: Number(p[1] ?? 0) };
					x = evaluateExpression(raw.xExpression, scope); y = evaluateExpression(raw.yExpression, scope); break;
				}
				case "regularPolygonCurve": {
					const sides = Math.max(3, Number(raw.sides ?? raw.numberOfSides ?? 3)), segments = Math.max(1, Number(raw.segmentsPerSide ?? 1));
					const index = Number(p[0] ?? 0), side = Math.floor(index / segments), part = (index % segments) / segments;
					const angle = Number(raw.angle ?? 0), radius = Number(raw.radius ?? 50), vertex = k => ({ x: Number(raw.centerX ?? 0) + radius * Math.cos(angle + k * Math.PI * 2 / sides), y: Number(raw.centerY ?? 0) + radius * Math.sin(angle + k * Math.PI * 2 / sides) });
					const a = vertex(side), b = vertex((side + 1) % sides); x = a.x + (b.x - a.x) * part; y = a.y + (b.y - a.y) * part; break;
				}
				case "bezierCurve": {
					const points = raw.controlPoints || []; const t = Number(p[0] ?? 0) / Math.max(1, Number(raw.segments ?? 1));
					const work = points.map(value => ({ x: Number(value.x ?? value[0] ?? 0), y: Number(value.y ?? value[1] ?? 0) }));
					for (let level = work.length - 1; level > 0; level -= 1) for (let i = 0; i < level; i += 1) { work[i].x += (work[i + 1].x - work[i].x) * t; work[i].y += (work[i + 1].y - work[i].y) * t; }
					x = work[0]?.x ?? 0; y = work[0]?.y ?? 0; break;
				}
				case "penCurve": {
					const node = (raw.penNodes || raw.commands || [])[Number(p[0] ?? 0)]; x = Number(node?.x ?? node?.[1] ?? 0); y = Number(node?.y ?? node?.[2] ?? 0); break;
				}
				case "parametricCurve": {
					const scope = { i: Number(p[0] ?? 0) }; x = evaluateExpression(raw.xExpression, scope); y = evaluateExpression(raw.yExpression, scope); break;
				}
				default: x = Number(raw?.centerX ?? raw?.topLeftX ?? 0); y = Number(raw?.centerY ?? raw?.topLeftY ?? 0);
			}
			return transformPoint({ x, y }, raw?.transformation || [1, 0, 0, 1, 0, 0]);
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
			const sourceLocation = overrides.location;
			const normalized = clone(overrides);
			if (sourceLocation && typeof sourceLocation === "object") { const point = sourceLocation instanceof Location ? sourceLocation : new Location(sourceLocation); if (point.attached()) { normalized.attached = true; normalized.snappee = point.snappee.id; normalized.snapPoint = clone(point.snapPoint); delete normalized.x; delete normalized.y; } else { normalized.x = Number(point.x); normalized.y = Number(point.y); delete normalized.attached; delete normalized.snappee; delete normalized.snapPoint; } delete normalized.location; }
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
			for (const item of rawEvents()) item.selected = ids.has(Number(item.id));
			return rawEvents().filter(item => item.selected);
		};
		const addSelection = (...values) => {
			const ids = selectedIds(values);
			for (const item of rawEvents()) if (ids.has(Number(item.id))) item.selected = true;
			return rawEvents().filter(item => item.selected);
		};
		const removeSelection = (...values) => {
			const ids = selectedIds(values);
			for (const item of rawEvents()) if (ids.has(Number(item.id))) item.selected = false;
			return rawEvents().filter(item => item.selected);
		};
		const clearSelection = () => {
			for (const item of rawEvents()) item.selected = false;
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
			constructor(...args) { const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : (args.length ? args : [1, 0, 0, 1, 0, 0]); this.values = [...values, 1, 0, 0, 1, 0, 0].slice(0, 6).map(Number); }
			get a() { return this.values[0]; } set a(value) { this.values[0] = Number(value); }
			get b() { return this.values[1]; } set b(value) { this.values[1] = Number(value); }
			get c() { return this.values[2]; } set c(value) { this.values[2] = Number(value); }
			get d() { return this.values[3]; } set d(value) { this.values[3] = Number(value); }
			get tx() { return this.values[4]; } set tx(value) { this.values[4] = Number(value); }
			get ty() { return this.values[5]; } set ty(value) { this.values[5] = Number(value); }
			translate(x, y) { const point = x instanceof Vector2D ? x : new Vector2D(x, y); this.tx += point.x; this.ty += point.y; return this; }
			scale(x, y = x) { this.a *= Number(x); this.b *= Number(x); this.c *= Number(y); this.d *= Number(y); return this; }
			rotate(angle) { const c = Math.cos(Number(angle)), s = Math.sin(Number(angle)); return this.compose([c, s, -s, c, 0, 0]); }
			horizontalFlip() { return this.scale(-1, 1); } flipHorizontally() { return this.horizontalFlip(); }
			verticalFlip() { return this.scale(1, -1); } flipVertically() { return this.verticalFlip(); }
			compose(matrix) { const other = matrix instanceof AffineMatrix2D ? matrix.values : matrix; const [a,b,c,d,tx,ty] = this.values; this.values = [a*other[0]+c*other[1], b*other[0]+d*other[1], a*other[2]+c*other[3], b*other[2]+d*other[3], a*other[4]+c*other[5]+tx, b*other[4]+d*other[5]+ty]; return this; }
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
			const origin = Math.min(...selected.map(item => rawEventTime(item)));
			const channelValues = selected.filter(item => item.channel != null).map(item => Number(item.channel)); const channelOrigin = channelValues.length ? Math.min(...channelValues) : 0;
			const shift = item => { const copy = clone(item); copy.id = null; if (copy.time != null) copy.time = addBeat(state.editor.currentTime, beatNumber(copy.time) - origin); if (copy.channel != null) copy.channel = Number(state.editor.currentChannel ?? 0) + Number(copy.channel) - channelOrigin; if (copy.type === "group") copy.events = (copy.events || []).map(shift); return copy; };
			return selected.map(item => { const copy = shift(item); if (copy.type === "group") { const raw = event("group", copy); state.events.pop(); state.events.push(raw); return new Event(raw); } return new Event(event(copy.type || "tap", copy)); });
		};
		const groupEvents = (values, color) => { const children = (values || []).map(value => clone(value.raw || value)); const retained = state.events.filter(candidate => !children.some(child => candidate.id === child.id)); state.events.splice(0, state.events.length, ...retained); const item = event("group", { color: color || "#ff9d3d", events: children }); return new Event(item); };
		const groupShortcut = (values, color, block) => {
			if (typeof values === "function") { block = values; color = null; values = null; }
			if (typeof color === "function") { block = color; color = values; values = null; }
			if (typeof block === "function") { const before = new Set(rawEvents().map(item => item.id)); block(); const added = rawEvents().filter(item => !before.has(item.id)); return groupEvents(added, color); }
			return groupEvents(values || [], color);
		};
		const transformThings = (things, matrix = [1, 0, 0, 1, 0, 0]) => {
			const values = matrix?.values || matrix; const [a, b, c, d, tx, ty] = values;
			const visit = value => { const item = value?.raw || value; if (!item) return; if (item.type === "group") for (const child of item.events || []) visit(child); if (item.attached) { const position = snapPointPosition(Snappee.getById(item.snappee)?.raw, item.snapPoint); const transformed = transformPoint(position, values); item.attached = false; item.x = transformed.x; item.y = transformed.y; delete item.snappee; delete item.snapPoint; } else if (Number.isFinite(item.x)) { const transformed = transformPoint({ x: item.x, y: item.y }, values); item.x = transformed.x; item.y = transformed.y; } if (item.type === "flick" && Number.isFinite(item.angle)) item.angle = Math.atan2(b * Math.cos(item.angle) + d * Math.sin(item.angle), a * Math.cos(item.angle) + c * Math.sin(item.angle)); if (item.transformation) item.transformation = [a*item.transformation[0]+c*item.transformation[1], b*item.transformation[0]+d*item.transformation[1], a*item.transformation[2]+c*item.transformation[3], b*item.transformation[2]+d*item.transformation[3], a*item.transformation[4]+c*item.transformation[5]+tx, b*item.transformation[4]+d*item.transformation[5]+ty]; };
			for (const value of (Array.isArray(things) ? things : [things])) visit(value); return things;
		};
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
				if (x instanceof Location) { this._x = x.x; this._y = x.y; this._snappee = x.snappee; this.snapPoint = clone(x.snapPoint); return; }
				if (x instanceof Snappee || x?.raw?.type) { this._snappee = x instanceof Snappee ? x : new Snappee(x); this.snapPoint = y == null ? 0 : (arguments.length > 2 ? [y, snap] : y); const point = snapPointPosition(this._snappee.raw, this.snapPoint); this._x = point.x; this._y = point.y; return; }
				if (x && typeof x === "object") { this._x = Number(x.x) || 0; this._y = Number(x.y) || 0; this._snappee = x.snappee ? (x.snappee instanceof Snappee ? x.snappee : new Snappee(x.snappee)) : null; this.snapPoint = clone(x.snapPoint); }
				else { this._x = Number(x) || 0; this._y = Number(y) || 0; this._snappee = snap instanceof Snappee ? snap : null; this.snapPoint = null; }
			}
			get pos() { if (this.attached()) { const point = snapPointPosition(this.snappee.raw, this.snapPoint); return new Vector2D(point.x, point.y); } return new Vector2D(this._x || 0, this._y || 0); }
			attached() { return Boolean(this._snappee); } attachedQ() { return this.attached(); } isAttached() { return this.attached(); }
			attach(snappee = null, ...point) {
				const target = snappee instanceof Snappee ? snappee : snappee ? new Snappee(snappee) : null;
				if (target) { this._snappee = target; this.snapPoint = point.length > 1 ? point : (point[0] ?? 0); }
				else { const nearest = Snappee.list.filter(item => item.active).map(item => { const p = snapPointPosition(item.raw, this.pos.toArray()); return { item, p, distance: Math.hypot(p.x - this.x, p.y - this.y) }; }).sort((a, b) => a.distance - b.distance)[0]; if (nearest) { this._snappee = nearest.item; this.snapPoint = nearest.item.nearestPoint(this.x, this.y).snapPoint; } }
				return this;
			}
			detach() { const point = this.pos; this._snappee = null; this.snapPoint = null; this._x = point.x; this._y = point.y; return this; }
			get snappee() { return this._snappee || null; }
			set snappee(value) { if (value == null) this.detach(); else { this._snappee = value instanceof Snappee ? value : new Snappee(value); if (this.snapPoint == null) this.snapPoint = 0; } }
			get x() { return this.pos.x; } set x(value) { this.detach(); this._x = Number(value) || 0; }
			get y() { return this.pos.y; } set y(value) { this.detach(); this._y = Number(value) || 0; }
			toJSON() { return this.attached() ? { attached: true, snappee: this.snappee.id, snapPoint: clone(this.snapPoint) } : { attached: false, x: this.x, y: this.y }; }
		}
		class TipPoint {
			constructor(type = "inherit", values = {}) { this.type = type; this.distance = values.distance ?? null; this.angle = values.angle == null ? null : angleValue(values.angle); this.location = values.location ? (values.location instanceof Location ? values.location : new Location(values.location)) : null; this.timeSeconds = values.timeSeconds ?? values.time_seconds ?? null; this.timeBeats = values.timeBeats ?? values.time_beats ?? null; if (this.location && (this.distance != null || this.angle != null)) throw new TypeError("absolute tip points cannot have distance or angle"); if (this.timeSeconds != null && this.timeBeats != null) throw new TypeError("tip point time must be seconds or beats"); }
			static inherit() { return new TipPoint("inherit"); }
			static none() { return new TipPoint("none"); }
			static chain(...args) { return new TipPoint("chain", tipValues(args)); }
			static drop(...args) { return new TipPoint("drop", tipValues(args)); }
			get absolute() { return Boolean(this.location); }
			absoluteQ() { return this.absolute; }
			relativeQ() { return !this.absolute; }
			get timeInSeconds() { return this.timeSeconds != null; }
			timeInSecondsQ() { return this.timeInSeconds; }
			timeInBeatsQ() { return !this.timeInSeconds; }
			toJSON() { const value = { tipPointSpawnType: this.type }; if (this.absolute) { value.tipPointSpawnAbsolutePosition = true; if (this.location.attached()) Object.assign(value, { tipPointSpawnAttached: true, tipPointSpawnSnappee: this.location.snappee.id, tipPointSpawnSnapPoint: clone(this.location.snapPoint) }); else Object.assign(value, { tipPointSpawnAttached: false, tipPointSpawnX: this.location.x, tipPointSpawnY: this.location.y }); } else { value.tipPointSpawnAbsolutePosition = false; value.tipPointSpawnDistance = this.distance ?? 100; value.tipPointSpawnAngle = this.angle ?? Math.PI / 2; } value.tipPointSpawnTimeBeats = this.timeInBeats; if (this.timeInBeats) value.tipPointSpawnTime = clone(this.timeBeats ?? [1, 0, 1]); else value.tipPointSpawnTime = Number(this.timeSeconds ?? 1); return value; }
		}
		const tipValues = args => { if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) return args[0]; if (args[0] instanceof Location || args[0]?.x != null && args[0]?.y != null) return { location: args[0], timeBeats: args[1] }; return { distance: args[0], angle: args[1], timeBeats: args[2] }; };
		class BpmChange {
			constructor(time, bpm, raw = null) { this.raw = raw || { time: beatTuple(time), bpm: Number(bpm) }; if (!raw) (state.timing.bpmChanges ||= []).push(this.raw); }
			get time() { ensureAlive(this.raw, "BpmChange"); return this.raw.time; } get bpm() { ensureAlive(this.raw, "BpmChange"); return this.raw.bpm; } set bpm(value) { ensureAlive(this.raw, "BpmChange"); this.raw.bpm = Number(value); }
			delete() { ensureAlive(this.raw, "BpmChange"); const index = (state.timing.bpmChanges || []).indexOf(this.raw); if (index >= 0) state.timing.bpmChanges.splice(index, 1); this.raw.__deleted = true; return this; }
			toJSON() { return clone(this.raw); }
			static get list() { return (state.timing.bpmChanges ||= []).map(item => new BpmChange(null, null, item)); }
		}
		class BarLine {
			constructor(time) { this.raw = { time: beatTuple(time) }; if (!(state.timing.barLines || []).some(item => JSON.stringify(item.time) === JSON.stringify(this.raw.time))) (state.timing.barLines ||= []).push(this.raw); }
			get time() { ensureAlive(this.raw, "BarLine"); return this.raw.time; }
			delete() { ensureAlive(this.raw, "BarLine"); const lines = state.timing.barLines || []; const index = lines.indexOf(this.raw); if (index >= 0) lines.splice(index, 1); this.raw.__deleted = true; return this; }
			toJSON() { return clone(this.raw); }
			static get list() { return (state.timing.barLines ||= []).map(item => new BarLineView(item)); }
		}
		class BarLineView { constructor(raw) { this.raw = raw; } get time() { ensureAlive(this.raw, "BarLine"); return this.raw.time; } delete() { ensureAlive(this.raw, "BarLine"); const index = state.timing.barLines.indexOf(this.raw); if (index >= 0) state.timing.barLines.splice(index, 1); this.raw.__deleted = true; } toJSON() { return clone(this.raw); } }
		class Channel {
			constructor(rawOrName = "Channel", overrides = {}) { this.raw = typeof rawOrName === "object" ? rawOrName : { id: nextId("channels"), name: String(rawOrName), active: true, ...clone(overrides) }; if (typeof rawOrName !== "object") state.channels.push(this.raw); }
			get id() { return ensureAlive(this.raw, "Channel").id; } get name() { return ensureAlive(this.raw, "Channel").name; } set name(value) { ensureAlive(this.raw, "Channel").name = String(value); }
			get color() { return this.raw.color; } set color(value) { this.raw.color = normalizeColor(value); }
			get active() { return this.raw.active !== false; } activeQ() { return this.active; } activate() { this.raw.active = true; return this; } deactivate() { this.raw.active = false; return this; }
			currentQ() { return state.editor.currentChannel === this.id; } select() { ensureAlive(this.raw, "Channel"); setCurrentChannel(this.id); return this; }
			moveUp() { const index = state.channels.indexOf(this.raw); if (index > 0) [state.channels[index - 1], state.channels[index]] = [state.channels[index], state.channels[index - 1]]; return this; }
			moveDown() { const index = state.channels.indexOf(this.raw); if (index >= 0 && index < state.channels.length - 1) [state.channels[index], state.channels[index + 1]] = [state.channels[index + 1], state.channels[index]]; return this; }
			get events() { return rawEvents().filter(item => item.type !== "group" && item.channel === this.id).map(item => new Event(item)); }
			delete() { remove("channels", this.raw); this.raw.__deleted = true; return this; } toJSON() { return clone(this.raw); } to_h() { return this.toJSON(); }
			static new(name = "Channel", overrides = {}) { return new Channel(name, overrides); }
			static get list() { return collection("channels").map(item => new Channel(item)); } static get current() { return new Channel(find("channels", state.editor.currentChannel) || state.channels[0]); }
			static get(n) { const value = typeof n === "string" ? collection("channels").find(item => item.name === n) : collection("channels")[Math.max(0, Number(n) - 1)]; return value ? new Channel(value) : null; }
			static getById(id) { const value = find("channels", id); return value ? new Channel(value) : null; }
		}
		class Snappee {
			constructor(rawOrType = "rectangularMesh", overrides = {}) { this.raw = typeof rawOrType === "object" ? rawOrType : snappee(rawOrType, overrides); }
			get id() { return ensureAlive(this.raw, "Snappee").id; } get name() { return this.raw.name; } set name(value) { this.raw.name = String(value); } get color() { return this.raw.color; } set color(value) { this.raw.color = normalizeColor(value); }
			get active() { return this.raw.active !== false; } activeQ() { return this.active; } activate() { this.raw.active = true; return this; } deactivate() { this.raw.active = false; this.raw.selected = false; return this; }
			selectedQ() { return Boolean(this.raw.selected); } select() { ensureAlive(this.raw, "Snappee"); for (const item of state.snappees) item.selected = false; this.raw.selected = true; return this; } static deselect() { for (const item of state.snappees) item.selected = false; }
			pos(...args) { ensureAlive(this.raw, "Snappee"); const point = snapPointPosition(this.raw, args.length > 1 ? args : args[0]); return new Vector2D(point.x, point.y); }
			position(...args) { return this.pos(...args); }
			points() { const count = this.raw.type === "rectangularMesh" ? (Number(this.raw.horizontalTiles ?? 1) + 1) * (Number(this.raw.verticalTiles ?? 1) + 1) : Number(this.raw.segments ?? this.raw.segmentsPerSide ?? 16) + 1; return Array.from({ length: Math.max(1, count) }, (_, index) => ({ snapPoint: index, ...snapPointPosition(this.raw, index) })); }
			nearestPoint(x, y) { return this.points().map(point => ({ ...point, distance: Math.hypot(point.x - x, point.y - y) })).sort((a, b) => a.distance - b.distance)[0] || { snapPoint: 0, x: this.pos(0).x, y: this.pos(0).y }; }
			moveUp() { const index = state.snappees.indexOf(this.raw); if (index > 0) [state.snappees[index - 1], state.snappees[index]] = [state.snappees[index], state.snappees[index - 1]]; return this; }
			moveDown() { const index = state.snappees.indexOf(this.raw); if (index >= 0 && index < state.snappees.length - 1) [state.snappees[index], state.snappees[index + 1]] = [state.snappees[index + 1], state.snappees[index]]; return this; }
			duplicate(name = this.name, color = this.color) { const copy = clone(this.raw); copy.id = nextId("snappees"); copy.name = name; copy.color = normalizeColor(color); state.snappees.push(copy); return new Snappee(copy); }
			delete() { remove("snappees", this.raw); this.raw.__deleted = true; return this; } toJSON() { return clone(this.raw); } to_h() { return this.toJSON(); }
			static new(type = "rectangularMesh", overrides = {}) { return new Snappee(type, overrides); }
			static get list() { return collection("snappees").map(item => new Snappee(item)); } static get selected() { const item = collection("snappees").find(value => value.selected); return item ? new Snappee(item) : null; }
			static get(n) { const item = typeof n === "string" ? collection("snappees").find(value => value.name === n) : collection("snappees")[Number(n)]; return item ? new Snappee(item) : null; } static getById(id) { const item = find("snappees", id); return item ? new Snappee(item) : null; }
		}
		class Event {
			constructor(raw) { this.raw = raw; }
			get id() { return ensureAlive(this.raw, "Event").id; } get type() { ensureAlive(this.raw, "Event"); return this.raw.type; }
			set type(value) { ensureAlive(this.raw, "Event"); const normalized = ({ bg_note: "bgNote", big_text: "bigText", diamond_grid: "diamondGrid" })[String(value)] || String(value); const rebuilt = event(normalized, { ...clone(this.raw), id: this.raw.id }); state.events.pop(); for (const key of Object.keys(this.raw)) delete this.raw[key]; Object.assign(this.raw, rebuilt); }
			get movable() { return ["tap", "hold", "drag", "flick", "bgNote", "group"].includes(this.type); } movableQ() { return this.movable; } isMovable() { return this.movable; }
			haveTimeQ() { return this.raw.time != null || this.groupQ(); } haveTime() { return this.haveTimeQ(); }
			haveChannelQ() { return this.type !== "group" && this.raw.channel != null; } haveChannel() { return this.haveChannelQ(); }
			haveDurationQ() { return this.raw.duration != null; } haveDuration() { return this.haveDurationQ(); }
			haveTextQ() { return ["tap", "hold", "flick", "bgNote", "bigText", "comment"].includes(this.type); } haveText() { return this.haveTextQ(); }
			tipPointableQ() { return ["tap", "hold", "drag", "flick"].includes(this.type); } tipPointable() { return this.tipPointableQ(); }
			groupQ() { return this.type === "group"; } group() { return this.groupQ(); }
			assertMovable() { if (!this.movable) throw new Error(`${this.type} events do not have a location`); ensureAlive(this.raw, "Event"); }
			get location() { this.assertMovable(); const point = this.raw.attached ? new Location(Snappee.getById(this.raw.snappee), this.raw.snapPoint) : new Location(this.raw.x ?? 0, this.raw.y ?? 0); return point; }
			set location(value) { this.assertMovable(); const point = value instanceof Location ? value : new Location(value); const before = this.location.pos; if (this.groupQ()) for (const child of rawEventsFrom(this.raw)) { if (!Number.isFinite(child.x) || !Number.isFinite(child.y)) continue; child.x += point.pos.x - before.x; child.y += point.pos.y - before.y; child.attached = false; delete child.snappee; delete child.snapPoint; } this.raw.attached = point.attached(); if (point.attached()) { this.raw.snappee = point.snappee.id; this.raw.snapPoint = clone(point.snapPoint); delete this.raw.x; delete this.raw.y; } else { this.raw.x = point.x; this.raw.y = point.y; delete this.raw.snappee; delete this.raw.snapPoint; } }
			get anchor() { if (!this.groupQ()) throw new Error("anchor is only valid for groups"); return new Location(this.raw.x ?? 0, this.raw.y ?? 0); }
			set anchor(value) { if (!this.groupQ()) throw new Error("anchor is only valid for groups"); const point = value instanceof Location ? value : new Location(value); this.raw.x = point.x; this.raw.y = point.y; this.raw.attached = false; }
			get text() { if (!this.haveTextQ()) throw new Error(`${this.type} events do not have text`); return this.raw.text; } set text(value) { if (!this.haveTextQ()) throw new Error(`${this.type} events do not have text`); this.raw.text = String(value); }
			get angle() { if (this.type !== "flick") throw new Error("angle is only valid for flick events"); return this.raw.angle; } set angle(value) { this.raw.angle = angleValue(value); }
			get duration() { if (!this.haveDurationQ()) throw new Error(`${this.type} events do not have duration`); return this.raw.duration; } set duration(value) { if (!this.haveDurationQ()) throw new Error(`${this.type} events do not have duration`); this.raw.duration = beatTuple(value); }
			get time() { return beatTuple(this.groupQ() ? rawEventTime(this.raw) : this.raw.time); }
			set time(value) { const target = beatNumber(value); if (!this.groupQ()) this.raw.time = beatTuple(value); else { const delta = target - rawEventTime(this.raw); for (const child of rawEventsFrom(this.raw)) if (child.time != null) child.time = addBeat(child.time, delta); } }
			get channel() { if (!this.haveChannelQ()) throw new Error("groups do not have channels"); return new Channel(find("channels", this.raw.channel)); } set channel(value) { if (!this.haveChannelQ()) throw new Error("groups do not have channels"); this.raw.channel = resolveId(value); }
			get events() { if (!this.groupQ()) throw new Error("only groups have events"); return (this.raw.events || []).map(item => new Event(item)); }
			get color() { if (!this.groupQ()) throw new Error("only groups have colors"); return this.raw.color; } set color(value) { if (!this.groupQ()) throw new Error("only groups have colors"); this.raw.color = normalizeColor(value); }
			get tipPoint() { if (!this.tipPointableQ()) throw new Error(`${this.type} events do not have tip points`); const absolute = Boolean(this.raw.tipPointSpawnAbsolutePosition); const location = absolute ? (this.raw.tipPointSpawnAttached ? new Location(Snappee.getById(this.raw.tipPointSpawnSnappee), this.raw.tipPointSpawnSnapPoint) : new Location(this.raw.tipPointSpawnX, this.raw.tipPointSpawnY)) : null; return new TipPoint(this.raw.tipPointSpawnType || "inherit", { location, distance: this.raw.tipPointSpawnDistance, angle: this.raw.tipPointSpawnAngle, timeSeconds: this.raw.tipPointSpawnTimeBeats ? null : this.raw.tipPointSpawnTime, timeBeats: this.raw.tipPointSpawnTimeBeats ? this.raw.tipPointSpawnTime : null }); }
			set tipPoint(value) { if (!this.tipPointableQ()) throw new Error(`${this.type} events do not have tip points`); for (const key of Object.keys(this.raw)) if (key.startsWith("tipPointSpawn")) delete this.raw[key]; Object.assign(this.raw, clone(value?.toJSON?.() || value || {})); }
			delete() { remove("events", this.raw); this.raw.__deleted = true; return this; } toJSON() { return clone(this.raw); }
			static get list() { return rawEvents().map(item => new Event(item)); } static get selection() { return rawEvents().filter(item => item.selected).map(item => new Event(item)); }
			static new(options = {}) { const values = { ...options }; const type = values.type || "tap"; delete values.type; return new Event(event(type, values)); }
		}
		class Clip {
			constructor(raw) { this.raw = raw || { name: `Clip ${state.clips.length + 1}`, data: { events: [], snappees: [] } }; if (!raw) state.clips.push(this.raw); }
			get name() { return this.raw.name; } set name(value) { this.raw.name = String(value); } get data() { return this.raw.data; }
			moveUp() { const i = state.clips.indexOf(this.raw); if (i > 0) [state.clips[i - 1], state.clips[i]] = [state.clips[i], state.clips[i - 1]]; return this; } moveDown() { const i = state.clips.indexOf(this.raw); if (i >= 0 && i < state.clips.length - 1) [state.clips[i], state.clips[i + 1]] = [state.clips[i + 1], state.clips[i]]; return this; }
			paste(time = state.editor.currentTime, channel = state.editor.currentChannel) { const values = this.raw.data?.events || []; if (!values.length) return []; const origin = Math.min(...values.map(item => beatNumber(item.time ?? 0))); const channels = values.filter(item => item.channel != null).map(item => Number(item.channel)); const channelOrigin = channels.length ? Math.min(...channels) : 0; return values.map(item => event(item.type, { ...clone(item), id: null, time: addBeat(time, beatNumber(item.time ?? 0) - origin), channel: resolveId(channel) + Number(item.channel ?? channelOrigin) - channelOrigin })); }
			delete() { ensureAlive(this.raw, "Clip"); const i = state.clips.indexOf(this.raw); if (i >= 0) state.clips.splice(i, 1); this.raw.__deleted = true; return this; } toJSON() { return clone(this.raw); } to_h() { return this.toJSON(); }
			static get list() { return state.clips.map(item => new Clip(item)); } static new(events, name) { const clip = new Clip(); clip.name = name || clip.name; clip.raw.data.events = (events || []).map(item => clone(item.raw || item)); return clip; } static get(n) { const item = state.clips[Number(n)]; return item ? new Clip(item) : null; }
		}
		const subclassArgs = (type, args) => {
			if (type === "rectangularMesh") return { topLeftX: args[0], topLeftY: args[1], bottomRightX: args[2], bottomRightY: args[3], horizontalTiles: args[4], verticalTiles: args[5] };
			if (type === "radialMesh") return { centerX: args[0], centerY: args[1], radius: args[2], azimuthalTiles: args[3], radialTiles: args[4], startingAngle: args[5] };
			if (type === "regularPolygonCurve") return { centerX: args[0], centerY: args[1], radius: args[2], angle: args[3], sides: args[4], segmentsPerSide: args[5] };
			if (type === "bezierCurve") return { degree: args[0], controlPoints: args[1], segments: args[2] };
			if (type === "parametricMesh") return { iRange: args[0], jRange: args[1], xExpression: args[2], yExpression: args[3] };
			if (type === "parametricCurve") return { iRange: args[0], xExpression: args[1], yExpression: args[2] };
			return { commands: args[0], segments: args[1], closed: args[2] };
		};
		const makeSnappeeClass = type => class extends Snappee {
			constructor(...args) { const last = args.at(-1); const options = last && typeof last === "object" && !Array.isArray(last) ? args.pop() : {}; super(type, { ...options, ...(args.length ? subclassArgs(type, args) : {}) }); }
		};
		const RectangularMesh = makeSnappeeClass("rectangularMesh");
		const RadialMesh = makeSnappeeClass("radialMesh");
		const ParametricMesh = makeSnappeeClass("parametricMesh");
		const RegularPolygonCurve = makeSnappeeClass("regularPolygonCurve");
		const BezierCurve = makeSnappeeClass("bezierCurve");
		const PenCurve = makeSnappeeClass("penCurve");
		const ParametricCurve = makeSnappeeClass("parametricCurve");

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
			g: groupShortcut, group: groupShortcut, copy: copyEvents,
			transform: transformThings,
			tipPoint: (type = "inherit", values = {}) => new TipPoint(type, values),
			c: channelShortcut, s: snappeeShortcut, l: location,
			tpc: (...args) => TipPoint.chain(...args),
			tpd: (...args) => TipPoint.drop(...args),
			bigText: overrides => event("bigText", overrides), grid: overrides => event("grid", overrides), diamondGrid: overrides => event("diamondGrid", overrides), hexagon: overrides => event("hexagon", overrides),
		};
	}

	global.createSviberMacroApi = createSviberMacroApi;
})(globalThis);
