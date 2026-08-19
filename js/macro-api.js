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

		const collection = key => Array.isArray(state[key]) ? state[key] : (state[key] = []);
		const nextId = key => {
			const ids = collection(key).map(item => Number(item?.id)).filter(Number.isSafeInteger);
			return ids.length ? Math.max(...ids) + 1 : 0;
		};
		const resolveId = value => Number(value && typeof value === "object" ? value.id : value);
		const find = (key, value) => collection(key).find(item => Number(item.id) === resolveId(value)) || null;
		const remove = (key, value) => {
			const id = resolveId(value);
			const index = collection(key).findIndex(item => Number(item.id) === id);
			return index < 0 ? null : collection(key).splice(index, 1)[0];
		};
		const update = (key, value, changes = {}) => {
			const item = find(key, value);
			if (item) Object.assign(item, clone(changes));
			return item;
		};

		const event = (type, overrides = {}) => {
			const item = {
				id: nextId("events"),
				type: String(type),
				channel: state.editor.currentChannel ?? state.channels[0]?.id ?? 0,
				time: clone(state.editor.currentTime ?? [0, 0, 1]),
				selected: true,
				...clone(overrides),
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

		return {
			state, chart: state, metadata: state.metadata, editor: state.editor, timing: state.timing,
			events: state.events, channels: state.channels, snappees: state.snappees,
			event, addEvent: event,
			tap: overrides => event("tap", overrides), t: overrides => event("tap", overrides),
			hold: overrides => event("hold", overrides), h: overrides => event("hold", overrides),
			drag: overrides => event("drag", overrides), d: overrides => event("drag", overrides),
			flick: overrides => event("flick", overrides), f: overrides => event("flick", overrides),
			bgNote: overrides => event("bgNote", overrides), bg: overrides => event("bgNote", overrides),
			channel, addChannel: channel, snappee, addSnappee: snappee,
			findEvent: value => find("events", value), findChannel: value => find("channels", value),
			findSnappee: value => find("snappees", value),
			updateEvent: (value, changes) => update("events", value, changes),
			updateChannel: (value, changes) => update("channels", value, changes),
			updateSnappee: (value, changes) => update("snappees", value, changes),
			removeEvent: value => remove("events", value), removeChannel: value => remove("channels", value),
			removeSnappee: value => remove("snappees", value),
			select, addSelection, removeSelection, clearSelection, setTime, setCurrentChannel, clone, log,
		};
	}

	global.createSviberMacroApi = createSviberMacroApi;
})(globalThis);
