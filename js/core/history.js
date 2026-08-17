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

	_makeEntry(state, label, metadata) {
		return {
			id: this._nextId++,
			label: String(label ?? "Edit"),
			timestamp: Date.now(),
			metadata: metadata == null ? null : this.clone(metadata),
			state: this.clone(state),
		};
	}

	record(state, label = "Edit", metadata = null, options = {}) {
		const snapshot = this.clone(state);
		if (!options.force && this.equals(this._entries[this._cursor].state, snapshot)) return false;
		if (this._cursor < this._entries.length - 1) this._entries.length = this._cursor + 1;
		this._entries.push(this._makeEntry(snapshot, label, metadata));
		this._cursor = this._entries.length - 1;
		if (this._entries.length > this.limit) {
			const overflow = this._entries.length - this.limit;
			this._entries.splice(0, overflow);
			this._cursor -= overflow;
		}
		return true;
	}

	push(state, label = "Edit", metadata = null) {
		return this.record(state, label, metadata);
	}

	replaceCurrent(state, label = this._entries[this._cursor].label, metadata = null) {
		const previous = this._entries[this._cursor];
		this._entries[this._cursor] = {
			...previous,
			label: String(label),
			timestamp: Date.now(),
			metadata: metadata == null ? previous.metadata : this.clone(metadata),
			state: this.clone(state),
		};
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
		return this.clone(this._entries[index].state);
	}

	get current() {
		return this.clone(this._entries[this._cursor].state);
	}

	get currentEntry() {
		const { state, ...entry } = this._entries[this._cursor];
		return { ...this.clone(entry), state: this.clone(state) };
	}

	get entries() {
		return this._entries.map(({ state, ...entry }, index) => ({
			...this.clone(entry),
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
