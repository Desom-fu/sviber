(function installSviberMacroApi(global) {
	function clone(value) {
		return value == null ? value : JSON.parse(JSON.stringify(value));
	}

	function createSviberMacroApi(sourceState, output = () => {}) {
		const state = clone(sourceState) || {};
		state.metadata ||= {};
		state.editor ||= {};
		state.timing ||= { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] };
		state.timing.barLines ||= [];
		state.channels ||= [];
		state.events ||= [];
		state.snappees ||= [];
		state.clips ||= [];
		const wrapperRecords = new WeakMap();
		const rawOf = value => value && typeof value === "object" ? (wrapperRecords.get(value) || value) : value;

		const collection = key => Array.isArray(state[key]) ? state[key] : (state[key] = []);
		const nextId = key => {
			const items = key === "events" ? (() => {
				const result = [];
				const visit = values => { for (const item of values || []) { result.push(item); if (item.type === "group") visit(item.events); } };
				visit(state.events);
				return result;
			})() : collection(key);
			const ids = items.map(item => Number(item?.id)).filter(Number.isSafeInteger);
			const counterKey = { events: "event", channels: "channel", snappees: "snappee" }[key];
			const next = Math.max(ids.length ? Math.max(...ids) + 1 : 0, Number(state.nextIds?.[counterKey]) || 0);
			state.nextIds ||= {};
			state.nextIds[counterKey] = next + 1;
			return next;
		};
		const resolveId = value => Number(rawOf(value)?.id ?? value);
		const ANGLES = {
			u: Math.PI / 2, up: Math.PI / 2, d: -Math.PI / 2, down: -Math.PI / 2,
			l: Math.PI, left: Math.PI, r: 0, right: 0,
			ul: 3 * Math.PI / 4, lu: 3 * Math.PI / 4, upleft: 3 * Math.PI / 4, leftup: 3 * Math.PI / 4,
			ur: Math.PI / 4, ru: Math.PI / 4, upright: Math.PI / 4, rightup: Math.PI / 4,
			dl: -3 * Math.PI / 4, ld: -3 * Math.PI / 4, downleft: -3 * Math.PI / 4, leftdown: -3 * Math.PI / 4,
			dr: -Math.PI / 4, rd: -Math.PI / 4, downright: -Math.PI / 4, rightdown: -Math.PI / 4,
		};
		const angleValue = value => {
			if (typeof value === "string" && Object.hasOwn(ANGLES, value.toLowerCase())) return ANGLES[value.toLowerCase()];
			if (typeof value === "number" && Number.isFinite(value)) return value;
			throw new TypeError("angle must be a finite number or direction name");
		};
		const gcd = (a, b) => { a = Math.abs(Math.trunc(a)); b = Math.abs(Math.trunc(b)); while (b) [a, b] = [b, a % b]; return a || 1; };
		const beatTuple = value => {
			let numerator, denominator;
			if (Array.isArray(value) && value.length === 3 && value.every(Number.isSafeInteger)) {
				if (value[2] === 0) throw new TypeError("beat denominator must not be zero");
				denominator = Number(value[2]);
				numerator = Number(value[0]) * denominator + Number(value[1]);
			} else if (Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger)) [numerator, denominator] = value;
			else if (typeof value === "number" && Number.isFinite(value)) { denominator = 1_000_000; numerator = Math.round(value * denominator); }
			else throw new TypeError("beat must be a number or rational tuple");
			if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) throw new TypeError("beat must be a number or rational tuple");
			if (denominator < 0) { numerator = -numerator; denominator = -denominator; }
			const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
			const whole = Math.trunc(numerator / denominator); const remainder = numerator - whole * denominator;
			return [whole, remainder, denominator];
		};
		const beatNumber = value => { const tuple = beatTuple(value); return Number(tuple[0]) + Number(tuple[1]) / Number(tuple[2]); };
		const addBeat = (left, right) => beatTuple(beatNumber(left) + beatNumber(right));
		const normalizeColor = value => {
			if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffff) return `#${value.toString(16).padStart(6, "0")}`;
			if (typeof value === "string") {
				const text = value.trim().toLowerCase();
				if (global.document?.createElement) {
					const context = global.document.createElement("canvas").getContext("2d");
					if (context) { context.fillStyle = "#010203"; context.fillStyle = text; if (context.fillStyle !== "#010203" || text === "#010203") return context.fillStyle; }
				}
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
			const finiteResult = value => {
				const number = Number(value);
				if (!Number.isFinite(number)) throw new TypeError("parametric expression must produce a finite number");
				return number;
			};
			if (typeof expression === "number") return finiteResult(expression);
			if (typeof expression === "function") return finiteResult(expression(scope));
			const text = String(expression ?? "0").trim();
			if (Object.hasOwn(scope, text)) return finiteResult(scope[text]);
			const math = global.math ?? global.parent?.math;
			if (math?.evaluate) return finiteResult(math.evaluate(text, scope));
			if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return finiteResult(text);
			throw new Error("Parametric snappees require math.js");
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
		const EVENT_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote", "bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram", "comment", "group"]);
		const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote", "group"]);
		const DURATION_TYPES = new Set(["hold", "bgNote", "bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram", "comment"]);
		const TEXT_TYPES = new Set(["tap", "hold", "flick", "bgNote", "bigText", "comment"]);
		const TIP_POINTABLE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
		const MESH_SNAPPEE_TYPES = new Set(["rectangularMesh", "radialMesh", "parametricMesh"]);
		const CURVE_SNAPPEE_TYPES = new Set(["regularPolygonCurve", "bezierCurve", "circularArcCurve", "penCurve", "parametricCurve"]);
		const POSITION_FIELDS = ["attached", "x", "y", "snappee", "snapPoint"];
		const TIP_POINT_FIELDS = ["tipPointSpawnType", "tipPointSpawnAbsolutePosition", "tipPointSpawnAttached", "tipPointSpawnX", "tipPointSpawnY", "tipPointSpawnSnappee", "tipPointSpawnSnapPoint", "tipPointSpawnDistance", "tipPointSpawnAngle", "tipPointSpawnTimeBeats", "tipPointSpawnTime"];
		const event = (type, overrides = {}) => {
			overrides = overrides && typeof overrides === "object" ? rawOf(overrides) : {};
			type = String(type);
			if (!EVENT_TYPES.has(type)) throw new TypeError(`Unsupported event type: ${type}`);
			const sourceLocation = overrides.location;
			const normalized = clone(overrides);
			if (sourceLocation != null) { if (!(sourceLocation instanceof Location)) throw new TypeError("location must be a Location"); const point = sourceLocation; if (point.attached) { normalized.attached = true; normalized.snappee = point.snappee.id; normalized.snapPoint = clone(point._snapPoint); delete normalized.x; delete normalized.y; } else { normalized.x = Number(point.x); normalized.y = Number(point.y); delete normalized.attached; delete normalized.snappee; delete normalized.snapPoint; } delete normalized.location; }
			if (normalized.time != null) normalized.time = beatTuple(normalized.time);
			if (normalized.duration != null) normalized.duration = beatTuple(normalized.duration);
			if (overrides.channel != null) normalized.channel = resolveId(overrides.channel);
			if (normalized.angle != null) normalized.angle = angleValue(normalized.angle);
			if (normalized.color != null) normalized.color = normalizeColor(normalized.color);
			if (overrides.tipPoint instanceof TipPoint) { Object.assign(normalized, tipPointFields(overrides.tipPoint)); delete normalized.tipPoint; }
			if (type === "group") {
				const prepareChild = value => {
					const child = rawOf(value);
					if (child.id == null) child.id = nextId("events");
					if (child.type === "group") child.events = (child.events || []).map(prepareChild);
					return child;
				};
				normalized.events = (overrides.events || []).map(prepareChild);
			}
			delete normalized.id;
			delete normalized.type;
			const item = {
				id: nextId("events"),
				type: String(type),
				channel: state.editor.currentChannel ?? state.channels[0]?.id ?? 0,
				time: beatTuple(state.editor.currentTime ?? [0, 0, 1]),
				selected: true,
				...normalized,
			};
			if (MOVABLE_TYPES.has(type)) {
				item.attached = Boolean(item.attached);
				if (item.attached) { item.snapPoint = clone(item.snapPoint ?? 0); delete item.x; delete item.y; }
				else { item.x = Number(item.x) || 0; item.y = Number(item.y) || 0; delete item.snappee; delete item.snapPoint; }
			} else for (const field of POSITION_FIELDS) delete item[field];
			if (DURATION_TYPES.has(type)) item.duration = beatTuple(item.duration ?? (type === "bgNote" || type === "comment" ? 0 : 1));
			else delete item.duration;
			if (TEXT_TYPES.has(type)) item.text = String(item.text ?? ""); else delete item.text;
			if (type === "flick") item.angle = angleValue(item.angle ?? Math.PI / 2); else delete item.angle;
			if (TIP_POINTABLE_TYPES.has(type)) {
				item.tipPointSpawnType ||= "inherit";
				item.tipPointSpawnAbsolutePosition = Boolean(item.tipPointSpawnAbsolutePosition);
				item.tipPointSpawnTimeBeats = Boolean(item.tipPointSpawnTimeBeats);
				item.tipPointSpawnTime = item.tipPointSpawnTimeBeats ? beatTuple(item.tipPointSpawnTime ?? 1) : Number(item.tipPointSpawnTime ?? 1);
				if (item.tipPointSpawnAbsolutePosition) {
					delete item.tipPointSpawnDistance; delete item.tipPointSpawnAngle;
				} else {
					item.tipPointSpawnDistance = Number(item.tipPointSpawnDistance ?? 100);
					item.tipPointSpawnAngle = angleValue(item.tipPointSpawnAngle ?? Math.PI / 2);
					for (const field of ["tipPointSpawnAttached", "tipPointSpawnX", "tipPointSpawnY", "tipPointSpawnSnappee", "tipPointSpawnSnapPoint"]) delete item[field];
				}
			} else for (const field of TIP_POINT_FIELDS) delete item[field];
			if (type === "group") { delete item.time; delete item.channel; item.color = normalizeColor(item.color ?? "#ff9d3d"); }
			else { delete item.events; delete item.color; }
			if (type === "group") for (const child of item.events || []) detachEvent(child);
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
		const setTime = value => {
			state.editor.timeSnapped = true;
			state.editor.currentTime = beatTuple(value);
			return state.editor.currentTime;
		};
		const setCurrentChannel = value => {
			state.editor.currentChannel = resolveId(value);
			return state.editor.currentChannel;
		};
		const INTERNAL = Symbol("sviber macro wrapper");
		const OMITTED = Symbol("omitted macro argument");
		class Vector2D {
			constructor(x = 0, y = 0) { this.x = Number(x) || 0; this.y = Number(y) || 0; }
			add(value) { const point = value instanceof Vector2D ? value : new Vector2D(value.x, value.y); return new Vector2D(this.x + point.x, this.y + point.y); }
			sub(value) { const point = value instanceof Vector2D ? value : new Vector2D(value.x, value.y); return new Vector2D(this.x - point.x, this.y - point.y); }
			mul(value) { return new Vector2D(this.x * Number(value), this.y * Number(value)); }
			div(value) { return new Vector2D(this.x / Number(value), this.y / Number(value)); }
		}
		const matrixValues = new WeakMap();
		class AffineMatrix2D {
			constructor(...args) {
				if (args.length > 6) throw new TypeError("AffineMatrix2D expects at most six numbers");
				if (args.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new TypeError("matrix elements must be finite numbers");
				const defaults = [1, 0, 0, 1, 0, 0];
				const values = defaults.map((fallback, index) => index < args.length ? args[index] : fallback);
				matrixValues.set(this, values);
			}
			get a() { return matrixValues.get(this)[0]; } set a(value) { matrixValues.get(this)[0] = Number(value); }
			get b() { return matrixValues.get(this)[1]; } set b(value) { matrixValues.get(this)[1] = Number(value); }
			get c() { return matrixValues.get(this)[2]; } set c(value) { matrixValues.get(this)[2] = Number(value); }
			get d() { return matrixValues.get(this)[3]; } set d(value) { matrixValues.get(this)[3] = Number(value); }
			get tx() { return matrixValues.get(this)[4]; } set tx(value) { matrixValues.get(this)[4] = Number(value); }
			get ty() { return matrixValues.get(this)[5]; } set ty(value) { matrixValues.get(this)[5] = Number(value); }
			translate(x, y) { const point = x instanceof Vector2D ? x : new Vector2D(x, y); this.tx += point.x; this.ty += point.y; return this; }
			scale(x, y = x) { this.a *= Number(x); this.b *= Number(x); this.c *= Number(y); this.d *= Number(y); return this; }
			rotate(angle) { const radians = angleValue(angle), c = Math.cos(radians), s = Math.sin(radians); return this.compose(new AffineMatrix2D(c, s, -s, c, 0, 0)); }
			horizontalFlip() { return this.scale(-1, 1); } flipHorizontally() { return this.horizontalFlip(); }
			verticalFlip() { return this.scale(1, -1); } flipVertically() { return this.verticalFlip(); }
			compose(matrix) { if (!(matrix instanceof AffineMatrix2D)) throw new TypeError("matrix must be an AffineMatrix2D"); const other = matrixValues.get(matrix); const [a,b,c,d,tx,ty] = matrixValues.get(this); matrixValues.set(this, [a*other[0]+c*other[1], b*other[0]+d*other[1], a*other[2]+c*other[3], b*other[2]+d*other[3], a*other[4]+c*other[5]+tx, b*other[4]+d*other[5]+ty]); return this; }
		}
		const chartFacade = {
			get currentTime() { return beatTuple(state.editor.currentTime); }, set currentTime(value) { setTime(value); },
			get channels() { return Channel.list; }, get currentChannel() { return Channel.current; },
			get snappees() { return Snappee.list; }, get selectedSnappee() { return Snappee.selected; },
			get clips() { return state.clips.map(wrapClip); }, get events() { return Event.list; }, get selectedEvents() { return Event.selection; },
			get offset() { return state.timing.offset; }, set offset(value) { state.timing.offset = Number(value); },
			get initialBpm() { return state.timing.initialBpm; }, set initialBpm(value) { state.timing.initialBpm = Number(value); },
			get bpmChanges() { return BpmChange.list; }, get barLines() { return BarLine.list; },
		};
		const eventChannels = item => (item.type === "group" ? rawEventsFrom(item) : [item]).filter(child => child.type !== "group" && child.channel != null);
		const shiftedCopies = (values, time, channelValue) => {
			const source = values.map(value => ensureAlive(rawOf(value), "Event"));
			if (!source.length) return [];
			const origin = Math.min(...source.map(rawEventTime));
			const sourceIndices = source.flatMap(eventChannels).map(item => state.channels.findIndex(channel => channel.id === item.channel));
			if (sourceIndices.some(index => index < 0)) throw new Error("event refers to a channel that does not exist");
			const minimumChannel = sourceIndices.length ? Math.min(...sourceIndices) : 0;
			const maximumChannel = sourceIndices.length ? Math.max(...sourceIndices) : minimumChannel;
			let targetChannel = state.channels.findIndex(channel => channel.id === resolveId(channelValue));
			if (targetChannel < 0) throw new Error("paste channel does not exist");
			while (targetChannel + maximumChannel - minimumChannel >= state.channels.length) new Channel();
			const shift = item => {
				const copy = clone(item);
				copy.id = null;
				if (copy.time != null) copy.time = addBeat(time, beatNumber(copy.time) - origin);
				if (copy.channel != null) {
					const sourceIndex = state.channels.findIndex(channel => channel.id === copy.channel);
					copy.channel = state.channels[targetChannel + sourceIndex - minimumChannel].id;
				}
				if (copy.type === "group") copy.events = (copy.events || []).map(shift);
				return copy;
			};
			return source.map(item => { const copy = shift(item); return wrapEventClass(event(copy.type, copy)); });
		};
		const copyEvents = values => {
			if (!Array.isArray(values)) throw new TypeError("copy expects an array of events");
			return shiftedCopies(values, state.editor.currentTime, state.editor.currentChannel);
		};
		const detachEvent = target => {
			const detachFrom = items => {
				const index = items.indexOf(target);
				if (index >= 0) { items.splice(index, 1); return true; }
				return items.some(item => item.type === "group" && detachFrom(item.events || []));
			};
			detachFrom(state.events);
		};
		const groupEvents = (values, color) => {
			const children = Array.from(values || [], value => ensureAlive(rawOf(value), "Event"));
			for (const child of children) detachEvent(child);
			return wrapEventClass(event("group", { color: color ?? "#ff9d3d", events: children }));
		};
		const groupShortcut = (values, color, block) => {
			if (typeof values === "function") { block = values; color = null; values = null; }
			if (typeof color === "function") { block = color; color = values; values = null; }
			if (typeof block === "function") { const before = new Set(state.events); block(); const added = state.events.filter(item => !before.has(item)); return groupEvents(added, color); }
			return groupEvents(values || [], color);
		};
		const transformThings = (things, matrix = OMITTED) => {
			if (typeof matrix === "function") { const callback = matrix; matrix = new AffineMatrix2D(); callback.call(matrix, matrix); }
			if (!(matrix instanceof AffineMatrix2D)) throw new TypeError("transform matrix must be an AffineMatrix2D or a callback");
			const values = matrixValues.get(matrix);
			const [a, b, c, d, tx, ty] = values;
			const targets = Array.isArray(things) ? things : [things];
			if (targets.some(value => !(value instanceof Event) && !(value instanceof Snappee))) throw new TypeError("transform expects events or snappees");
			if (targets.some(value => value instanceof Event) && targets.some(value => value instanceof Snappee)) throw new TypeError("transform arrays cannot mix events and snappees");
			const transformTipPoint = item => {
				if (!TIP_POINTABLE_TYPES.has(item.type) || !["chain", "drop"].includes(item.tipPointSpawnType)) return;
				if (!item.tipPointSpawnAbsolutePosition) {
					const distance = Math.max(0, Number(item.tipPointSpawnDistance) || 0);
					const angle = Number.isFinite(Number(item.tipPointSpawnAngle)) ? Number(item.tipPointSpawnAngle) : Math.PI / 2;
					const origin = transformPoint({ x: 0, y: 0 }, values);
					const endpoint = transformPoint({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance }, values);
					const dx = endpoint.x - origin.x, dy = endpoint.y - origin.y;
					item.tipPointSpawnDistance = Math.hypot(dx, dy);
					if (item.tipPointSpawnDistance > 1e-12) item.tipPointSpawnAngle = Math.atan2(dy, dx);
					return;
				}
				const tipSnappee = item.tipPointSpawnAttached ? find("snappees", item.tipPointSpawnSnappee) : null;
				if (item.tipPointSpawnAttached && !tipSnappee) throw new Error("attached tip-point snappee does not exist");
				const position = item.tipPointSpawnAttached
					? snapPointPosition(tipSnappee, item.tipPointSpawnSnapPoint)
					: { x: Number(item.tipPointSpawnX) || 0, y: Number(item.tipPointSpawnY) || 0 };
				const transformed = transformPoint(position, values);
				item.tipPointSpawnAttached = false;
				item.tipPointSpawnX = transformed.x; item.tipPointSpawnY = transformed.y;
				delete item.tipPointSpawnSnappee; delete item.tipPointSpawnSnapPoint;
			};
			const visit = value => {
				const item = ensureAlive(rawOf(value), value instanceof Snappee ? "Snappee" : "Event");
				if (item.type === "group") for (const child of item.events || []) visit(child);
				transformTipPoint(item);
				if (item.attached) {
					const position = snapPointPosition(find("snappees", item.snappee), item.snapPoint);
					const transformed = transformPoint(position, values);
					item.attached = false; item.x = transformed.x; item.y = transformed.y; delete item.snappee; delete item.snapPoint;
				} else if (Number.isFinite(item.x) && Number.isFinite(item.y)) {
					const transformed = transformPoint({ x: item.x, y: item.y }, values); item.x = transformed.x; item.y = transformed.y;
				}
				if (item.type === "flick" && Number.isFinite(item.angle)) item.angle = Math.atan2(b * Math.cos(item.angle) + d * Math.sin(item.angle), a * Math.cos(item.angle) + c * Math.sin(item.angle));
				if (item.transformation) item.transformation = [a*item.transformation[0]+c*item.transformation[1], b*item.transformation[0]+d*item.transformation[1], a*item.transformation[2]+c*item.transformation[3], b*item.transformation[2]+d*item.transformation[3], a*item.transformation[4]+c*item.transformation[5]+tx, b*item.transformation[4]+d*item.transformation[5]+ty];
			};
			for (const value of targets) visit(value); return things;
		};
		const location = (...args) => new Location(...args);
		const channelShortcut = name => (Channel.get(name) || new Channel({ name })).select();
		const snappeeShortcut = value => Snappee.get(value);
		const ensureAlive = (item, kind) => { if (!item || item.__deleted) throw new Error(`${kind} has been deleted`); return item; };
		const integerRange = (range, exclusive = false, forceExclusive = false) => {
			if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger)) throw new TypeError("range must contain two integers");
			const [start, end] = range;
			const direction = end >= start ? 1 : -1;
			const points = [];
			for (let value = start; direction > 0 ? value < end : value > end; value += direction) points.push(value);
			if (!exclusive && !forceExclusive) points.push(end);
			return points;
		};
		const snapPoints = raw => {
			const points = [];
			if (raw.type === "rectangularMesh") for (let i = 0; i <= Number(raw.horizontalTiles ?? 1); i += 1) for (let j = 0; j <= Number(raw.verticalTiles ?? 1); j += 1) points.push([i, j]);
			else if (raw.type === "radialMesh") for (let i = 0; i < Number(raw.azimuthalTiles ?? 1); i += 1) for (let j = 0; j <= Number(raw.radialTiles ?? 1); j += 1) points.push([i, j]);
			else if (raw.type === "parametricMesh") for (const i of integerRange(raw.iRange, raw.iRangeExclusive)) for (const j of integerRange(raw.jRange, raw.jRangeExclusive)) points.push([i, j]);
			else if (raw.type === "parametricCurve") points.push(...integerRange(raw.iRange, raw.iRangeExclusive, Boolean(raw.closed)));
			else {
				const count = Math.max(1, raw.type === "regularPolygonCurve" ? Number(raw.sides ?? 3) * Number(raw.segmentsPerSide ?? 1) : Number(raw.segments ?? 16));
				const exclusiveEnd = raw.type === "regularPolygonCurve" || Boolean(raw.closed);
				for (let i = 0; i < count + (exclusiveEnd ? 0 : 1); i += 1) points.push(i);
			}
			return points.map(snapPoint => ({ snapPoint, ...snapPointPosition(raw, snapPoint) }));
		};
		const nearestSnapPoint = (raw, x, y) => snapPoints(raw).map(point => ({ ...point, distance: Math.hypot(point.x - x, point.y - y) })).sort((a, b) => a.distance - b.distance)[0] || { snapPoint: 0, ...snapPointPosition(raw, 0) };
		const checkedSnapPoint = (raw, args) => {
			const expected = MESH_SNAPPEE_TYPES.has(raw.type) ? 2 : CURVE_SNAPPEE_TYPES.has(raw.type) ? 1 : 0;
			if (!expected || args.length !== expected || args.some(value => !Number.isInteger(value))) {
				throw new TypeError("snap point expects one curve index or two mesh indices");
			}
			return expected === 2 ? [args[0], args[1]] : args[0];
		};
		class Location {
			constructor(x, y, snap) {
				if (x instanceof Snappee) { const raw = ensureAlive(rawOf(x), "Snappee"); this._snappee = x; this._snapPoint = checkedSnapPoint(raw, Array.from(arguments).slice(1)); const point = snapPointPosition(raw, this._snapPoint); this._x = point.x; this._y = point.y; return; }
				if (arguments.length !== 2) throw new TypeError("Location expects (x, y), (curve, i), or (mesh, i, j)");
				if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("Location coordinates must be numbers");
				this._x = x; this._y = y; this._snappee = null; this._snapPoint = null;
			}
			get pos() { if (this.attached) { const point = snapPointPosition(ensureAlive(rawOf(this.snappee), "Snappee"), this._snapPoint); return new Vector2D(point.x, point.y); } return new Vector2D(this._x || 0, this._y || 0); }
			get attached() { return Boolean(this._snappee); }
			attach() {
				const nearest = Snappee.list.filter(item => item.active).map(item => ({ item, hit: nearestSnapPoint(rawOf(item), this.x, this.y) })).sort((a, b) => a.hit.distance - b.hit.distance)[0];
				if (nearest) { this._snappee = nearest.item; this._snapPoint = clone(nearest.hit.snapPoint); }
				return this;
			}
			detach() { const point = this.pos; this._snappee = null; this._snapPoint = null; this._x = point.x; this._y = point.y; return this; }
			get snappee() { return this._snappee || null; }
			set snappee(value) { if (value == null) this.detach(); else { if (!(value instanceof Snappee)) throw new TypeError("snappee must be a Snappee"); const point = this.pos; const raw = ensureAlive(rawOf(value), "Snappee"); this._snappee = value; this._snapPoint = clone(nearestSnapPoint(raw, point.x, point.y).snapPoint); } }
			get x() { return this.pos.x; } set x(value) { this.detach(); this._x = Number(value) || 0; }
			get y() { return this.pos.y; } set y(value) { this.detach(); this._y = Number(value) || 0; }
		}
		class TipPoint {
			constructor(type = "inherit", values = {}) {
				if (values.location != null && (values.distance != null || values.angle != null)) throw new TypeError("absolute tip points cannot have distance or angle");
				if (values.timeSeconds != null && values.timeBeats != null) throw new TypeError("tip point time must be seconds or beats");
				this._type = String(type);
				this._distance = values.distance == null ? null : Number(values.distance);
				if (this._distance != null && !Number.isFinite(this._distance)) throw new TypeError("distance must be a finite number");
				this._angle = values.angle == null ? null : angleValue(values.angle);
				this._location = values.location ?? null;
				if (this._location != null && !(this._location instanceof Location)) throw new TypeError("location must be a Location");
				this._timeSeconds = values.timeSeconds == null ? null : Number(values.timeSeconds);
				if (this._timeSeconds != null && !Number.isFinite(this._timeSeconds)) throw new TypeError("timeSeconds must be a finite number");
				this._timeBeats = values.timeBeats == null ? null : beatTuple(values.timeBeats);
			}
			static inherit() { return new TipPoint("inherit"); }
			static none() { return new TipPoint("none"); }
			static chain(values = {}) { if (!values || typeof values !== "object" || Array.isArray(values) || values instanceof Location) throw new TypeError("TipPoint.chain expects an options object"); return new TipPoint("chain", values); }
			static drop(values = {}) { if (!values || typeof values !== "object" || Array.isArray(values) || values instanceof Location) throw new TypeError("TipPoint.drop expects an options object"); return new TipPoint("drop", values); }
			get absolute() { return Boolean(this._location); }
			get relative() { return !this.absolute; }
			get timeInSeconds() { return this._timeSeconds != null; }
			get timeInBeats() { return !this.timeInSeconds; }
			get distance() { return this._distance; } set distance(value) { const number = value == null ? null : Number(value); if (number != null && !Number.isFinite(number)) throw new TypeError("distance must be a finite number"); this._distance = number; if (value != null) this._location = null; }
			get angle() { return this._angle; } set angle(value) { this._angle = value == null ? null : angleValue(value); if (value != null) this._location = null; }
			get location() { return this._location; } set location(value) { if (value != null && !(value instanceof Location)) throw new TypeError("location must be a Location"); this._location = value; if (value != null) { this._distance = null; this._angle = null; } }
			get timeSeconds() { return this._timeSeconds; } set timeSeconds(value) { const number = value == null ? null : Number(value); if (number != null && !Number.isFinite(number)) throw new TypeError("timeSeconds must be a finite number"); this._timeSeconds = number; if (value != null) this._timeBeats = null; }
			get timeBeats() { return this._timeBeats; } set timeBeats(value) { this._timeBeats = value == null ? null : beatTuple(value); if (value != null) this._timeSeconds = null; }
		}
		const locationFields = location => location.attached
			? { attached: true, snappee: location.snappee.id, snapPoint: clone(location._snapPoint) }
			: { attached: false, x: location.x, y: location.y };
		const tipPointFields = tipPoint => {
			if (!(tipPoint instanceof TipPoint)) throw new TypeError("tipPoint must be a TipPoint");
			const value = { tipPointSpawnType: tipPoint._type, tipPointSpawnAbsolutePosition: tipPoint.absolute };
			if (tipPoint.absolute) {
				const fields = locationFields(tipPoint.location);
				value.tipPointSpawnAttached = fields.attached;
				if (fields.attached) { value.tipPointSpawnSnappee = fields.snappee; value.tipPointSpawnSnapPoint = fields.snapPoint; }
				else { value.tipPointSpawnX = fields.x; value.tipPointSpawnY = fields.y; }
			} else { value.tipPointSpawnDistance = tipPoint.distance ?? 100; value.tipPointSpawnAngle = tipPoint.angle ?? Math.PI / 2; }
			value.tipPointSpawnTimeBeats = tipPoint.timeInBeats;
			value.tipPointSpawnTime = tipPoint.timeInBeats ? clone(tipPoint.timeBeats ?? [1, 0, 1]) : Number(tipPoint.timeSeconds ?? 1);
			return value;
		};
		const tipTime = value => typeof value === "number" && !Number.isInteger(value)
			? { timeSeconds: value } : { timeBeats: value };
		const tipValues = args => {
			if (args[0] instanceof Location && args.length === 2) return { location: args[0], ...tipTime(args[1]) };
			if (!(args[0] instanceof Location) && args.length === 3) return { distance: args[0], angle: args[1], ...tipTime(args[2]) };
			throw new TypeError("tip-point helper expects (location, time) or (distance, angle, time)");
		};
		class BpmChange {
			constructor(time, bpm, token = null) { const raw = token === INTERNAL ? time : { time: beatTuple(time), bpm: Number(bpm) }; wrapperRecords.set(this, raw); if (token !== INTERNAL) (state.timing.bpmChanges ||= []).push(raw); }
			get time() { return beatTuple(ensureAlive(rawOf(this), "BpmChange").time); } get bpm() { return ensureAlive(rawOf(this), "BpmChange").bpm; } set bpm(value) { ensureAlive(rawOf(this), "BpmChange").bpm = Number(value); }
			delete() { const raw = ensureAlive(rawOf(this), "BpmChange"); const index = (state.timing.bpmChanges || []).indexOf(raw); if (index >= 0) state.timing.bpmChanges.splice(index, 1); raw.__deleted = true; return this; }
			static get list() { return (state.timing.bpmChanges ||= []).map(item => new BpmChange(item, null, INTERNAL)); }
		}
		class BarLine {
			constructor(time, token = null) { const raw = token === INTERNAL ? time : { time: beatTuple(time) }; wrapperRecords.set(this, raw); if (token !== INTERNAL) (state.timing.barLines ||= []).push(raw); }
			get time() { return beatTuple(ensureAlive(rawOf(this), "BarLine").time); }
			delete() { const raw = ensureAlive(rawOf(this), "BarLine"); const lines = state.timing.barLines || []; const index = lines.indexOf(raw); if (index >= 0) lines.splice(index, 1); raw.__deleted = true; return this; }
			static get list() { return (state.timing.barLines ||= []).map(item => new BarLine(item, INTERNAL)); }
		}
		class Channel {
			constructor(options = {}, token = null) {
				if (token === INTERNAL) { wrapperRecords.set(this, options); return; }
				if (typeof options !== "object" || Array.isArray(options)) throw new TypeError("Channel options must be an object");
				const ordinal = state.channels.length + 1;
				wrapperRecords.set(this, channel(options.name ?? `Channel ${ordinal}`, {
					color: normalizeColor(options.color ?? "#7f7f7f"), active: true,
				}));
			}
			get id() { return ensureAlive(rawOf(this), "Channel").id; } get name() { return ensureAlive(rawOf(this), "Channel").name; } set name(value) { ensureAlive(rawOf(this), "Channel").name = String(value); }
			get color() { return ensureAlive(rawOf(this), "Channel").color ?? "#7f7f7f"; } set color(value) { ensureAlive(rawOf(this), "Channel").color = normalizeColor(value); }
			get active() { return ensureAlive(rawOf(this), "Channel").active !== false; } activate() { ensureAlive(rawOf(this), "Channel").active = true; return this; } deactivate() { ensureAlive(rawOf(this), "Channel").active = false; return this; }
			get current() { return state.editor.currentChannel === this.id; } select() { setCurrentChannel(this.id); return this; }
			moveUp() { const raw = ensureAlive(rawOf(this), "Channel"); const index = state.channels.indexOf(raw); if (index > 0) [state.channels[index - 1], state.channels[index]] = [state.channels[index], state.channels[index - 1]]; return this; }
			moveDown() { const raw = ensureAlive(rawOf(this), "Channel"); const index = state.channels.indexOf(raw); if (index >= 0 && index < state.channels.length - 1) [state.channels[index], state.channels[index + 1]] = [state.channels[index + 1], state.channels[index]]; return this; }
			get events() { ensureAlive(rawOf(this), "Channel"); return state.events.filter(item => item.type !== "group" && item.channel === this.id).map(wrapEventClass); }
			delete() { const raw = ensureAlive(rawOf(this), "Channel"); remove("channels", raw); raw.__deleted = true; return this; } toJSON() { return clone(ensureAlive(rawOf(this), "Channel")); }
			static get list() { return collection("channels").map(wrapChannel); } static get current() { return wrapChannel(find("channels", state.editor.currentChannel) || null); }
			static get(n) { if (typeof n === "string") return wrapChannel(collection("channels").find(item => item.name === n)); if (!Number.isInteger(n)) throw new TypeError("channel number must be an integer or name"); return wrapChannel(collection("channels")[n - 1]); }
			static getById(id) { return wrapChannel(find("channels", id)); }
		}
		const wrapChannel = raw => raw ? new Channel(raw, INTERNAL) : null;
		class Snappee {
			constructor(type = "rectangularMesh", options = {}, token = null) {
				if (token === INTERNAL) { wrapperRecords.set(this, type); return; }
				if (typeof options !== "object" || Array.isArray(options)) throw new TypeError("Snappee options must be an object");
				const count = state.snappees.filter(item => item.type === type).length + 1;
				wrapperRecords.set(this, snappee(type, { ...options, name: options.name ?? `${type} ${count}`, color: normalizeColor(options.color ?? "#7f7f7f") }));
			}
			get id() { return ensureAlive(rawOf(this), "Snappee").id; } get name() { return ensureAlive(rawOf(this), "Snappee").name; } set name(value) { ensureAlive(rawOf(this), "Snappee").name = String(value); } get color() { return ensureAlive(rawOf(this), "Snappee").color; } set color(value) { ensureAlive(rawOf(this), "Snappee").color = normalizeColor(value); }
			get active() { return ensureAlive(rawOf(this), "Snappee").active !== false; } activate() { ensureAlive(rawOf(this), "Snappee").active = true; return this; } deactivate() { const raw = ensureAlive(rawOf(this), "Snappee"); raw.active = false; raw.selected = false; return this; }
			get selected() { return Boolean(ensureAlive(rawOf(this), "Snappee").selected); } select() { const raw = ensureAlive(rawOf(this), "Snappee"); for (const item of state.snappees) item.selected = false; raw.selected = true; return this; } static deselect() { for (const item of state.snappees) item.selected = false; }
			pos(...args) { const raw = ensureAlive(rawOf(this), "Snappee"); const point = snapPointPosition(raw, checkedSnapPoint(raw, args)); return new Vector2D(point.x, point.y); }
			moveUp() { const raw = ensureAlive(rawOf(this), "Snappee"); const index = state.snappees.indexOf(raw); if (index > 0) [state.snappees[index - 1], state.snappees[index]] = [state.snappees[index], state.snappees[index - 1]]; return this; }
			moveDown() { const raw = ensureAlive(rawOf(this), "Snappee"); const index = state.snappees.indexOf(raw); if (index >= 0 && index < state.snappees.length - 1) [state.snappees[index], state.snappees[index + 1]] = [state.snappees[index + 1], state.snappees[index]]; return this; }
			duplicate(name = this.name, color = this.color) { const copy = clone(ensureAlive(rawOf(this), "Snappee")); copy.id = nextId("snappees"); copy.name = String(name); copy.color = normalizeColor(color); state.snappees.push(copy); return wrapSnappee(copy); }
			delete() { const raw = ensureAlive(rawOf(this), "Snappee"); remove("snappees", raw); raw.__deleted = true; return this; } toJSON() { return clone(ensureAlive(rawOf(this), "Snappee")); }
			static get list() { return collection("snappees").map(wrapSnappee); } static get selected() { return wrapSnappee(collection("snappees").find(value => value.selected)); }
			static get(n) { if (typeof n === "string") return wrapSnappee(collection("snappees").find(value => value.name === n)); if (!Number.isInteger(n)) throw new TypeError("snappee number must be an integer or name"); return wrapSnappee(collection("snappees")[n]); } static getById(id) { return wrapSnappee(find("snappees", id)); }
		}
		let snappeeClasses = null;
		const wrapSnappee = raw => {
			if (!raw) return null;
			const Wrapper = snappeeClasses?.[raw.type];
			return Wrapper ? new Wrapper(raw, INTERNAL) : new Snappee(raw, {}, INTERNAL);
		};
		const attachedLocation = (target, snapPoint) => Array.isArray(snapPoint)
			? new Location(target, ...snapPoint) : new Location(target, snapPoint);
		const rawLocation = raw => {
			if (!raw.attached) return new Location(raw.x ?? 0, raw.y ?? 0);
			const target = Snappee.getById(raw.snappee);
			if (!target) throw new Error("attached snappee does not exist");
			return attachedLocation(target, raw.snapPoint);
		};
		const assignRawLocation = (raw, location) => {
			const fields = locationFields(location);
			for (const key of POSITION_FIELDS) delete raw[key];
			Object.assign(raw, fields);
		};
		class Event {
			constructor(options = {}, token = null) {
				if (token === INTERNAL) { wrapperRecords.set(this, options); return; }
				if (typeof options !== "object" || Array.isArray(options)) throw new TypeError("Event options must be an object");
				const values = { ...options };
				if (!Object.hasOwn(values, "type")) throw new TypeError("Event type is required");
				if (values.channel != null && !(values.channel instanceof Channel)) throw new TypeError("channel must be a Channel");
				const type = values.type;
				delete values.type;
				wrapperRecords.set(this, event(type, values));
			}
			get type() { return ensureAlive(rawOf(this), "Event").type; }
			set type(value) { const raw = ensureAlive(rawOf(this), "Event"); const oldId = raw.id; const rebuilt = event(value, clone(raw)); state.events.pop(); rebuilt.id = oldId; for (const key of Object.keys(raw)) delete raw[key]; Object.assign(raw, rebuilt); const Wrapper = eventClasses?.[rebuilt.type]; if (Wrapper) Object.setPrototypeOf(this, Wrapper.prototype); }
			get movable() { return MOVABLE_TYPES.has(this.type); }
			get haveTime() { const raw = ensureAlive(rawOf(this), "Event"); return raw.time != null || raw.type === "group"; }
			get haveChannel() { return this.type !== "group" && rawOf(this).channel != null; }
			get haveDuration() { return DURATION_TYPES.has(this.type); }
			get haveText() { return TEXT_TYPES.has(this.type); }
			get tipPointable() { return TIP_POINTABLE_TYPES.has(this.type); }
			get group() { return this.type === "group"; }
			assertMovable() { if (!this.movable) throw new Error(`${this.type} events do not have a location`); }
			get location() { this.assertMovable(); return rawLocation(rawOf(this)); }
			set location(value) { this.assertMovable(); if (!(value instanceof Location)) throw new TypeError("location must be a Location"); const raw = rawOf(this); const before = this.location.pos; const after = value.pos; if (this.group) for (const child of rawEventsFrom(raw)) { if (!MOVABLE_TYPES.has(child.type)) continue; const childPoint = rawLocation(child).pos; assignRawLocation(child, new Location(childPoint.x + after.x - before.x, childPoint.y + after.y - before.y)); } assignRawLocation(raw, value); }
			get anchor() { if (!this.group) throw new Error("anchor is only valid for groups"); return rawLocation(rawOf(this)); }
			set anchor(value) { if (!this.group) throw new Error("anchor is only valid for groups"); if (!(value instanceof Location)) throw new TypeError("anchor must be a Location"); assignRawLocation(rawOf(this), value); }
			get text() { if (!this.haveText) throw new Error(`${this.type} events do not have text`); return rawOf(this).text; } set text(value) { if (!this.haveText) throw new Error(`${this.type} events do not have text`); rawOf(this).text = String(value); }
			get angle() { if (this.type !== "flick") throw new Error("angle is only valid for flick events"); return rawOf(this).angle; } set angle(value) { if (this.type !== "flick") throw new Error("angle is only valid for flick events"); rawOf(this).angle = angleValue(value); }
			get time() { const raw = ensureAlive(rawOf(this), "Event"); return beatTuple(this.group ? rawEventTime(raw) : raw.time); }
			set time(value) { const raw = ensureAlive(rawOf(this), "Event"); const target = beatNumber(value); if (!this.group) raw.time = beatTuple(value); else { const delta = target - rawEventTime(raw); for (const child of rawEventsFrom(raw)) if (child.time != null) child.time = addBeat(child.time, delta); } }
			get channel() { if (!this.haveChannel) throw new Error("groups do not have channels"); return wrapChannel(find("channels", rawOf(this).channel)); } set channel(value) { if (!this.haveChannel) throw new Error("groups do not have channels"); const channel = ensureAlive(rawOf(value), "Channel"); rawOf(this).channel = channel.id; }
			get events() { if (!this.group) throw new Error("only groups have events"); return (rawOf(this).events || []).map(wrapEventClass); }
			get color() { if (!this.group) throw new Error("only groups have colors"); return rawOf(this).color; } set color(value) { if (!this.group) throw new Error("only groups have colors"); rawOf(this).color = normalizeColor(value); }
			get tipPoint() { if (!this.tipPointable) throw new Error(`${this.type} events do not have tip points`); const raw = rawOf(this); const absolute = Boolean(raw.tipPointSpawnAbsolutePosition); const location = absolute ? (raw.tipPointSpawnAttached ? attachedLocation(Snappee.getById(raw.tipPointSpawnSnappee), raw.tipPointSpawnSnapPoint) : new Location(raw.tipPointSpawnX, raw.tipPointSpawnY)) : null; return new TipPoint(raw.tipPointSpawnType || "inherit", { location, distance: raw.tipPointSpawnDistance, angle: raw.tipPointSpawnAngle, timeSeconds: raw.tipPointSpawnTimeBeats ? null : raw.tipPointSpawnTime, timeBeats: raw.tipPointSpawnTimeBeats ? raw.tipPointSpawnTime : null }); }
			set tipPoint(value) { if (!this.tipPointable) throw new Error(`${this.type} events do not have tip points`); const raw = rawOf(this); for (const key of Object.keys(raw)) if (key.startsWith("tipPointSpawn")) delete raw[key]; Object.assign(raw, tipPointFields(value)); }
			delete() { const raw = ensureAlive(rawOf(this), "Event"); remove("events", raw); raw.__deleted = true; return this; }
			static get list() { return state.events.map(wrapEventClass); } static get selection() { return rawEvents().filter(item => item.selected).map(wrapEventClass); }
		}
		let eventClasses = null;
		const wrapEventClass = raw => raw ? new (eventClasses?.[raw.type] || Event)(raw, INTERNAL) : null;
		const makeEventClass = type => class extends Event {
			constructor(options = {}, token = null) { super(token === INTERNAL ? options : { ...options, type }, token); }
		};
		const Tap = makeEventClass("tap");
		const Hold = makeEventClass("hold");
		const Drag = makeEventClass("drag");
		const Flick = makeEventClass("flick");
		const BgNote = makeEventClass("bgNote");
		const BigText = makeEventClass("bigText");
		const Grid = makeEventClass("grid");
		const DiamondGrid = makeEventClass("diamondGrid");
		const Hexagon = makeEventClass("hexagon");
		const Checkerboard = makeEventClass("checkerboard");
		const Pentagon = makeEventClass("pentagon");
		const Turntable = makeEventClass("turntable");
		const Hexagram = makeEventClass("hexagram");
		const Comment = makeEventClass("comment");
		const Group = makeEventClass("group");
		eventClasses = { tap: Tap, hold: Hold, drag: Drag, flick: Flick, bgNote: BgNote, bigText: BigText,
			grid: Grid, diamondGrid: DiamondGrid, hexagon: Hexagon, checkerboard: Checkerboard,
			pentagon: Pentagon, turntable: Turntable, hexagram: Hexagram, comment: Comment, group: Group };
		const clipDataFor = values => {
			const source = values.map(value => ensureAlive(rawOf(value), "Event"));
			if (!source.length) return { version: 1, events: [], channels: [], snappees: [] };
			const leaves = source.flatMap(item => item.type === "group" ? rawEventsFrom(item) : [item]).filter(item => item.type !== "group");
			const channelIndices = leaves.map(item => state.channels.findIndex(channel => channel.id === item.channel));
			if (channelIndices.some(index => index < 0)) throw new Error("event refers to a channel that does not exist");
			const minimumChannel = channelIndices.length ? Math.min(...channelIndices) : 0;
			const maximumChannel = channelIndices.length ? Math.max(...channelIndices) : minimumChannel;
			const origin = Math.min(...source.map(rawEventTime));
			const normalize = item => {
				const copy = clone(item); copy.id = null;
				if (copy.type === "group") copy.events = (copy.events || []).map(normalize);
				else {
					copy.time = addBeat(copy.time, -origin);
					copy.channel = state.channels.findIndex(channel => channel.id === copy.channel) - minimumChannel;
				}
				return copy;
			};
			const snappeeIds = new Set(leaves.flatMap(item => [item.snappee, item.tipPointSpawnSnappee]).filter(value => value != null));
			return {
				version: 1,
				events: source.map(normalize),
				channels: state.channels.slice(minimumChannel, maximumChannel + 1).map((item, index) => ({ ...clone(item), channelOffset: index })),
				snappees: state.snappees.filter(item => snappeeIds.has(item.id)).map(clone),
			};
		};
		const pasteClipData = (data, time, channelValue) => {
			const source = Array.isArray(data?.events) ? data.events : [];
			if (!source.length) return [];
			const targetChannel = state.channels.findIndex(channel => channel.id === resolveId(channelValue));
			if (targetChannel < 0) throw new Error("paste channel does not exist");
			const leaves = source.flatMap(item => item.type === "group" ? rawEventsFrom(item) : [item]).filter(item => item.type !== "group");
			const offsets = leaves.map(item => Number(item.channel));
			if (offsets.some(value => !Number.isInteger(value) || value < 0)) throw new TypeError("clip channel offsets must be nonnegative integers");
			const maximumOffset = offsets.length ? Math.max(...offsets) : 0;
			while (targetChannel + maximumOffset >= state.channels.length) new Channel();
			const shift = item => {
				const copy = clone(item); copy.id = null;
				if (copy.type === "group") copy.events = (copy.events || []).map(shift);
				else {
					copy.time = addBeat(time, copy.time);
					copy.channel = state.channels[targetChannel + Number(copy.channel)].id;
				}
				return copy;
			};
			return source.map(item => { const copy = shift(item); return wrapEventClass(event(copy.type, copy)); });
		};
		class Clip {
			constructor(events, name = null, token = null) {
				if (token === INTERNAL) { wrapperRecords.set(this, events); return; }
				if (!Array.isArray(events)) throw new TypeError("Clip events must be an array");
				const raw = { name: String(name ?? `Clip ${state.clips.length + 1}`), data: clipDataFor(events) };
				wrapperRecords.set(this, raw); state.clips.push(raw);
			}
			get name() { return ensureAlive(rawOf(this), "Clip").name; } set name(value) { ensureAlive(rawOf(this), "Clip").name = String(value); }
			moveUp() { const raw = ensureAlive(rawOf(this), "Clip"); const i = state.clips.indexOf(raw); if (i > 0) [state.clips[i - 1], state.clips[i]] = [state.clips[i], state.clips[i - 1]]; return this; } moveDown() { const raw = ensureAlive(rawOf(this), "Clip"); const i = state.clips.indexOf(raw); if (i >= 0 && i < state.clips.length - 1) [state.clips[i], state.clips[i + 1]] = [state.clips[i + 1], state.clips[i]]; return this; }
			paste(time, channel) { const raw = ensureAlive(rawOf(this), "Clip"); return pasteClipData(raw.data, beatTuple(time), channel); }
			delete() { const raw = ensureAlive(rawOf(this), "Clip"); const i = state.clips.indexOf(raw); if (i >= 0) state.clips.splice(i, 1); raw.__deleted = true; return this; } toJSON() { return clone(ensureAlive(rawOf(this), "Clip")); }
			static get(n) { if (!Number.isInteger(n)) throw new TypeError("clip number must be an integer"); return wrapClip(state.clips[n]); }
		}
		const wrapClip = raw => raw ? new Clip(raw, null, INTERNAL) : null;
		const subclassArgs = (type, args) => {
			if (type === "rectangularMesh") return { topLeftX: args[0], topLeftY: args[1], bottomRightX: args[2], bottomRightY: args[3], horizontalTiles: args[4], verticalTiles: args[5] };
			if (type === "radialMesh") return { centerX: args[0], centerY: args[1], radius: args[2], azimuthalTiles: args[3], radialTiles: args[4], startingAngle: args[5] == null ? args[5] : angleValue(args[5]) };
			if (type === "regularPolygonCurve") return { centerX: args[0], centerY: args[1], radius: args[2], angle: args[3] == null ? args[3] : angleValue(args[3]), sides: args[4], segmentsPerSide: args[5] };
			if (type === "bezierCurve") return { degree: args[0], controlPoints: args[1], segments: args[2] };
			if (type === "parametricMesh") return { iRange: args[0], jRange: args[1], xExpression: args[2], yExpression: args[3] };
			if (type === "parametricCurve") return { iRange: args[0], xExpression: args[1], yExpression: args[2] };
			return { commands: args[0], segments: args[1], closed: args[2] };
		};
		const makeSnappeeClass = type => class extends Snappee {
			constructor(...args) {
				if (args.at(-1) === INTERNAL) { args.pop(); super(args[0], {}, INTERNAL); return; }
				const last = args.at(-1);
				const options = last && typeof last === "object" && !Array.isArray(last) ? args.pop() : {};
				super(type, { ...options, ...(args.length ? subclassArgs(type, args) : {}) });
			}
		};
		const RectangularMesh = makeSnappeeClass("rectangularMesh");
		const RadialMesh = makeSnappeeClass("radialMesh");
		const ParametricMesh = makeSnappeeClass("parametricMesh");
		const RegularPolygonCurve = makeSnappeeClass("regularPolygonCurve");
		const BezierCurve = makeSnappeeClass("bezierCurve");
		const PenCurve = makeSnappeeClass("penCurve");
		const ParametricCurve = makeSnappeeClass("parametricCurve");
		snappeeClasses = { rectangularMesh: RectangularMesh, radialMesh: RadialMesh, parametricMesh: ParametricMesh,
			regularPolygonCurve: RegularPolygonCurve, bezierCurve: BezierCurve, penCurve: PenCurve,
			parametricCurve: ParametricCurve };

		const globals = {
			Chart: chartFacade, Vector2D, AffineMatrix2D, Location, TipPoint, BpmChange, BarLine, Channel, Snappee,
			RectangularMesh, RadialMesh, ParametricMesh, RegularPolygonCurve, BezierCurve, PenCurve, ParametricCurve,
			Event, Tap, Hold, Drag, Flick, BgNote, BigText, Grid, DiamondGrid, Hexagon, Checkerboard, Pentagon, Turntable, Hexagram, Comment, Group, Clip,
			b: (value = OMITTED) => value === OMITTED ? beatTuple(state.editor.currentTime) : setTime(addBeat(state.editor.currentTime, value)),
			bBang: (value = OMITTED) => value === OMITTED ? beatTuple(state.editor.currentTime) : setTime(value),
			bpm: value => { const time = clone(state.editor.currentTime); const changes = state.timing.bpmChanges || (state.timing.bpmChanges = []); const existing = changes.find(change => JSON.stringify(change.time) === JSON.stringify(time)); if (existing) existing.bpm = Number(value); else changes.push({ time, bpm: Number(value) }); return value; },
			g: groupShortcut, copy: copyEvents,
			transform: transformThings,
			c: channelShortcut, s: snappeeShortcut, l: location,
			tpc: (...args) => new TipPoint("chain", tipValues(args)),
			tpd: (...args) => new TipPoint("drop", tipValues(args)),
			t: (location, text = "") => new Tap({ location, time: chartFacade.currentTime, channel: Channel.current, text }),
			h: (location, duration, text = "") => new Hold({ location, time: chartFacade.currentTime, channel: Channel.current, duration, text }),
			d: location => new Drag({ location, time: chartFacade.currentTime, channel: Channel.current }),
			f: (location, angle, text = "") => new Flick({ location, time: chartFacade.currentTime, channel: Channel.current, angle, text }),
			bgNote: (location, duration = 0, text = "") => {
				if (typeof duration === "string" && text === "") { text = duration; duration = 0; }
				return new BgNote({ location, time: chartFacade.currentTime, channel: Channel.current, duration, text });
			},
			bigText: (duration, text = "") => new BigText({ time: chartFacade.currentTime, channel: Channel.current, duration, text }),
			grid: duration => new Grid({ time: chartFacade.currentTime, channel: Channel.current, duration }),
			diamondGrid: duration => new DiamondGrid({ time: chartFacade.currentTime, channel: Channel.current, duration }),
			hexagon: duration => new Hexagon({ time: chartFacade.currentTime, channel: Channel.current, duration }),
			checkerboard: duration => new Checkerboard({ time: chartFacade.currentTime, channel: Channel.current, duration }),
			pentagon: duration => new Pentagon({ time: chartFacade.currentTime, channel: Channel.current, duration }),
			turntable: duration => new Turntable({ time: chartFacade.currentTime, channel: Channel.current, duration }),
			hexagram: duration => new Hexagram({ time: chartFacade.currentTime, channel: Channel.current, duration }),
		};
		return { state, globals };
	}

	global.createSviberMacroApi = createSviberMacroApi;
})(globalThis);
