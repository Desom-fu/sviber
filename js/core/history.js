function cloneFallback(value, seen = new Map()) {
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value)) return seen.get(value);
	if (Array.isArray(value)) {
		const result = [];
		seen.set(value, result);
		for (const item of value) result.push(cloneFallback(item, seen));
		return result;
	}
	if (value instanceof Date) return new Date(value.getTime());
	if (value instanceof Map) {
		const result = new Map();
		seen.set(value, result);
		for (const [key, item] of value) result.set(cloneFallback(key, seen), cloneFallback(item, seen));
		return result;
	}
	if (value instanceof Set) {
		const result = new Set();
		seen.set(value, result);
		for (const item of value) result.add(cloneFallback(item, seen));
		return result;
	}
	const result = {};
	seen.set(value, result);
	for (const key of Reflect.ownKeys(value)) result[key] = cloneFallback(value[key], seen);
	return result;
}

export function cloneSnapshot(value) {
	return typeof globalThis.structuredClone === "function"
		? globalThis.structuredClone(value)
		: cloneFallback(value);
}

export function snapshotsEqual(left, right, seen = new Map()) {
	if (Object.is(left, right)) return true;
	if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
	let rightSeen = seen.get(left);
	if (rightSeen?.has(right)) return true;
	if (!rightSeen) {
		rightSeen = new Set();
		seen.set(left, rightSeen);
	}
	rightSeen.add(right);

	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right)
			&& left.length === right.length
			&& left.every((value, index) => snapshotsEqual(value, right[index], seen));
	}
	if (left instanceof Date || right instanceof Date) {
		return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
	}
	if (left instanceof Map || right instanceof Map) {
		if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
		for (const [key, value] of left) {
			if (!right.has(key) || !snapshotsEqual(value, right.get(key), seen)) return false;
		}
		return true;
	}
	if (left instanceof Set || right instanceof Set) {
		if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) return false;
		return [...left].every((value) => right.has(value));
	}

	const leftKeys = Reflect.ownKeys(left);
	const rightKeys = Reflect.ownKeys(right);
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((key) => Object.hasOwn(right, key)
			&& snapshotsEqual(left[key], right[key], seen));
}


function visitChartEvents(events, visit) {
	for (const event of events || []) {
		visit(event);
		if (event?.type === "group") visitChartEvents(event.events, visit);
	}
}

function applyIdOrder(items, ids) {
	if (!Array.isArray(items) || !Array.isArray(ids)) return items;
	const remaining = new Map(items.map(item => [item.id, item]));
	const ordered = [];
	for (const id of ids) {
		const item = remaining.get(id);
		if (!item) continue;
		ordered.push(item);
		remaining.delete(id);
	}
	for (const item of remaining.values()) ordered.push(item);
	return ordered;
}

export function captureHistoryView(model, options = {}) {
	const selectedEventIds = Array.isArray(options.selectedEventIds) ? [...options.selectedEventIds] : [];
	if (!Array.isArray(options.selectedEventIds)) {
		visitChartEvents(model?.events, event => { if (event?.selected) selectedEventIds.push(event.id); });
	}
	return {
		selectedEventIds,
		snappees: (model?.snappees || []).map(snappee => ({
			id: snappee.id,
			selected: Boolean(snappee.selected),
			active: snappee.active !== false,
		})),
		channelIds: (model?.channels || []).map(channel => channel.id),
		currentTime: cloneSnapshot(model?.editor?.currentTime ?? null),
		currentChannel: model?.editor?.currentChannel ?? null,
		allowOutOfBound: Boolean(model?.editor?.allowOutOfBound),
	};
}

export function applyHistoryView(state, view) {
	if (!state || !view) return state;
	const selected = new Set(view.selectedEventIds || []);
	visitChartEvents(state.events, event => { event.selected = selected.has(event.id); });
	const overlays = new Map((view.snappees || []).map(item => [item.id, item]));
	for (const snappee of state.snappees || []) {
		const overlay = overlays.get(snappee.id);
		if (!overlay) continue;
		snappee.selected = Boolean(overlay.selected);
		snappee.active = overlay.active !== false;
	}
	if (Array.isArray(view.snappees)) state.snappees = applyIdOrder(state.snappees, view.snappees.map(item => item.id));
	if (Array.isArray(view.channelIds)) state.channels = applyIdOrder(state.channels, view.channelIds);
	if (state.editor) {
		if (Object.hasOwn(view, "currentTime")) state.editor.currentTime = cloneSnapshot(view.currentTime);
		if (Object.hasOwn(view, "currentChannel")) state.editor.currentChannel = view.currentChannel;
		if (Object.hasOwn(view, "allowOutOfBound")) state.editor.allowOutOfBound = Boolean(view.allowOutOfBound);
	}
	return state;
}

export function applyHistoryPatch(state, patch) {
	if (!state || !patch?.kind) return state;
	if (patch.kind === "appendRootEvent") {
		if (!Array.isArray(state.events)) state.events = [];
		state.events.push(cloneSnapshot(patch.event));
		if (!state.nextIds || typeof state.nextIds !== "object") state.nextIds = {};
		state.nextIds.event = Math.max(Number(state.nextIds.event) || 0, Number(patch.nextEventId) || 0);
	} else if (patch.kind === "setEventChannels") {
		const channels = new Map((patch.changes || []).map(change => [change.id, change.channel]));
		visitChartEvents(state.events, event => {
			if (channels.has(event.id)) event.channel = channels.get(event.id);
		});
	} else if (patch.kind === "replaceEvents") {
		const replacements = new Map((patch.changes || []).map(change => [change.id, cloneSnapshot(change.event)]));
		const replace = events => {
			if (!Array.isArray(events)) return;
			for (let index = 0; index < events.length; index += 1) {
				const event = events[index];
				const replacement = replacements.get(event?.id);
				if (replacement) events[index] = replacement;
				if (events[index]?.type === "group") replace(events[index].events);
			}
		};
		replace(state.events);
	} else if (patch.kind === "removeEvents") {
		const removed = new Set((patch.eventIds || []).map(Number));
		const remove = events => {
			if (!Array.isArray(events)) return;
			for (let index = events.length - 1; index >= 0; index -= 1) {
				const event = events[index];
				if (removed.has(event?.id)) { events.splice(index, 1); continue; }
				if (event?.type === "group") remove(event.events);
			}
		};
		remove(state.events);
	} else return state;
	return applyHistoryView(state, patch.view);
}

export function historyViewsEqual(left, right) {
	if (left === right) return true;
	if (!left || !right) return false;
	if (left.currentChannel !== right.currentChannel) return false;
	if (Boolean(left.allowOutOfBound) !== Boolean(right.allowOutOfBound)) return false;
	if (!snapshotsEqual(left.currentTime, right.currentTime)) return false;
	const leftIds = left.selectedEventIds || [];
	const rightIds = right.selectedEventIds || [];
	if (leftIds.length !== rightIds.length) return false;
	for (let index = 0; index < leftIds.length; index += 1) {
		if (leftIds[index] !== rightIds[index]) return false;
	}
	const leftSnappees = left.snappees || [];
	const rightSnappees = right.snappees || [];
	if (leftSnappees.length !== rightSnappees.length) return false;
	for (let index = 0; index < leftSnappees.length; index += 1) {
		const first = leftSnappees[index];
		const second = rightSnappees[index];
		if (first.id !== second.id || Boolean(first.selected) !== Boolean(second.selected)
			|| (first.active !== false) !== (second.active !== false)) return false;
	}
	const leftChannels = left.channelIds;
	const rightChannels = right.channelIds;
	if (leftChannels && rightChannels) {
		if (leftChannels.length !== rightChannels.length) return false;
		for (let index = 0; index < leftChannels.length; index += 1) {
			if (leftChannels[index] !== rightChannels[index]) return false;
		}
	}
	return true;
}

/** A bounded snapshot history with Photoshop-style arbitrary cursor jumps. */
export class History {
	constructor(initialState, options = {}) {
		this.limit = options.limit ?? 1000;
		if (!Number.isSafeInteger(this.limit) || this.limit < 1) {
			throw new RangeError("history limit must be a positive integer");
		}
		this.clone = options.clone ?? cloneSnapshot;
		this.equals = options.equals ?? snapshotsEqual;
		this._nextId = 0;
		this.reset(initialState, options.initialLabel ?? "Initial state");
	}

	reset(state, label = "Initial state", metadata = null) {
		this._entries = [this._makeEntry(state, label, metadata)];
		this._cursor = 0;
		return this.current;
	}

	_makeEntry(state, label, metadata, cloneState = true) {
		return {
			id: this._nextId++,
			label: String(label ?? "Edit"),
			timestamp: Date.now(),
			metadata: metadata == null ? null : this.clone(metadata),
			state: cloneState ? this.clone(state) : state,
		};
	}

	_entryView(index) {
		const entry = this._entries[index];
		if (!entry) return null;
		if (entry.view) return entry.view;
		if (entry.patch?.view) return entry.patch.view;
		if (entry.state) return captureHistoryView(entry.state);
		return null;
	}

	_resolvedState(index) {
		const entry = this._entries[index];
		if (entry.state != null) return this.clone(entry.state);
		let baseIndex = index - 1;
		while (baseIndex >= 0 && this._entries[baseIndex].state == null) baseIndex -= 1;
		if (baseIndex < 0 || this._entries[baseIndex].state == null) {
			throw new Error("history is missing a base snapshot");
		}
		let state = this.clone(this._entries[baseIndex].state);
		for (let cursor = baseIndex + 1; cursor <= index; cursor += 1) {
			const next = this._entries[cursor];
			state = next.patch ? applyHistoryPatch(state, next.patch) : applyHistoryView(state, next.view);
		}
		return state;
	}

	_materializeInPlace(index) {
		const entry = this._entries[index];
		if (!entry || entry.state != null) return;
		const next = { ...entry, state: this._resolvedState(index) };
		delete next.kind;
		delete next.view;
		delete next.patch;
		this._entries[index] = next;
	}

	_trim() {
		if (this._entries.length <= this.limit) return;
		const overflow = this._entries.length - this.limit;
		this._materializeInPlace(overflow);
		this._entries.splice(0, overflow);
		this._cursor -= overflow;
	}

	record(state, label = "Edit", metadata = null, options = {}) {
		const snapshot = options.owned ? state : this.clone(state);
		if (!options.force) {
			const baseline = this._entries[this._cursor].state ?? this._resolvedState(this._cursor);
			if (this.equals(baseline, snapshot)) return false;
		}
		if (this._cursor < this._entries.length - 1) this._entries.length = this._cursor + 1;
		this._entries.push(this._makeEntry(snapshot, label, metadata, !options.owned));
		this._cursor = this._entries.length - 1;
		this._trim();
		return true;
	}

	recordView(view, label = "Edit", metadata = null, options = {}) {
		if (!options.force && historyViewsEqual(this._entryView(this._cursor), view)) return false;
		if (this._cursor < this._entries.length - 1) this._entries.length = this._cursor + 1;
		this._entries.push({
			id: this._nextId++,
			label: String(label ?? "Edit"),
			timestamp: Date.now(),
			metadata: metadata == null ? null : this.clone(metadata),
			kind: "view",
			view: this.clone(view),
			state: null,
		});
		this._cursor = this._entries.length - 1;
		this._trim();
		return true;
	}

	recordPatch(patch, label = "Edit", metadata = null) {
		if (!patch || typeof patch !== "object") throw new TypeError("history patch must be an object");
		if (this._cursor < this._entries.length - 1) this._entries.length = this._cursor + 1;
		this._entries.push({
			id: this._nextId++,
			label: String(label ?? "Edit"),
			timestamp: Date.now(),
			metadata: metadata == null ? null : this.clone(metadata),
			kind: "patch",
			patch: this.clone(patch),
			state: null,
		});
		this._cursor = this._entries.length - 1;
		this._trim();
		return true;
	}

	push(state, label = "Edit", metadata = null) {
		return this.record(state, label, metadata);
	}

	replaceCurrent(state, label = this._entries[this._cursor].label, metadata = null) {
		const previous = this._entries[this._cursor];
		const next = {
			...previous,
			label: String(label),
			timestamp: Date.now(),
			metadata: metadata == null ? previous.metadata : this.clone(metadata),
			state: this.clone(state),
		};
		delete next.kind;
		delete next.view;
		delete next.patch;
		this._entries[this._cursor] = next;
		return this.current;
	}

	markCurrent(kind, timestamp = Date.now()) {
		if (!kind) throw new TypeError("history marker kind is required");
		const entry = this._entries[this._cursor];
		const metadata = entry.metadata == null ? {} : this.clone(entry.metadata);
		metadata.historyMarkers = { ...(metadata.historyMarkers || {}), [String(kind)]: Number(timestamp) || Date.now() };
		entry.metadata = metadata;
		return this.currentEntry;
	}

	transformStates(transform) {
		if (typeof transform !== "function") throw new TypeError("history state transform must be a function");
		this._entries = this._entries.map((entry, index) => {
			if (entry.state == null) return entry;
			const state = this.clone(entry.state);
			const transformed = transform(state, index);
			return { ...entry, state: this.clone(transformed === undefined ? state : transformed) };
		});
		return this.current;
	}

	undo() {
		if (!this.canUndo) return null;
		this._cursor -= 1;
		return this.current;
	}

	redo() {
		if (!this.canRedo) return null;
		this._cursor += 1;
		return this.current;
	}

	goTo(index) {
		if (!Number.isSafeInteger(index) || index < 0 || index >= this._entries.length) {
			throw new RangeError("history cursor is out of range");
		}
		this._cursor = index;
		return this.current;
	}

	goToId(id) {
		const index = this._entries.findIndex((entry) => entry.id === id);
		if (index < 0) throw new RangeError(`unknown history entry: ${id}`);
		return this.goTo(index);
	}

	jump(index) {
		return this.goTo(index);
	}

	getSnapshot(index = this._cursor) {
		if (!Number.isSafeInteger(index) || index < 0 || index >= this._entries.length) {
			throw new RangeError("history snapshot is out of range");
		}
		return this._resolvedState(index);
	}

	get current() {
		return this._resolvedState(this._cursor);
	}

	get currentEntry() {
		const { state, view, patch, ...entry } = this._entries[this._cursor];
		return {
			...this.clone(entry),
			...(view == null ? {} : { view: this.clone(view) }),
			state: this._resolvedState(this._cursor),
		};
	}

	get currentMetadata() {
		return this.clone(this._entries[this._cursor]?.metadata ?? null);
	}

	get entries() {
		return this._entries.map(({ state, patch, ...entry }, index) => ({
			...this.clone(entry),
			index,
			active: index === this._cursor,
			undone: index > this._cursor,
		}));
	}

	panelEntries() {
		return this._entries.map((entry, index) => ({
			id: entry.id,
			label: entry.label,
			timestamp: entry.timestamp,
			metadata: entry.metadata,
			index,
			active: index === this._cursor,
			undone: index > this._cursor,
		}));
	}

	get cursor() {
		return this._cursor;
	}

	get length() {
		return this._entries.length;
	}

	get canUndo() {
		return this._cursor > 0;
	}

	get canRedo() {
		return this._cursor < this._entries.length - 1;
	}
}

export const SnapshotHistory = History;

export default History;
