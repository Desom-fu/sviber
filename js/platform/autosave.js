// Periodic recovery snapshots in local storage.
//
// Autosaves are kept as one storage entry per snapshot plus a timestamp index, so a browser
// that limits storage can be handled by dropping the oldest snapshots and retrying rather
// than losing the newest one. A separate "last manual save" timestamp lets the editor offer
// only the snapshots that are newer than the last deliberate save.
//
// Split out of js/platform.js.

import { ChartModel } from "../core/chart-model.js";

const AUTOSAVE_INDEX_KEY = "sviber.autosaves";
const MANUAL_SAVE_KEY = "sviber.manualSaveTime";
const AUTOSAVE_PREFIX = "sviber.autosave.";

export class AutosaveManager {
	constructor(options = {}) {
		this.storage = options.storage || globalThis.localStorage;
		this.interval = options.interval ?? 120_000;
		this.maxEntries = options.maxEntries ?? Infinity;
		this.timer = 0;
	}

	get index() {
		try {
			const parsed = JSON.parse(this.storage.getItem(AUTOSAVE_INDEX_KEY) || "[]");
			return Array.isArray(parsed) ? parsed.filter(value => Number.isFinite(value)) : [];
		} catch {
			return [];
		}
	}

	set index(value) {
		this.storage.setItem(AUTOSAVE_INDEX_KEY, JSON.stringify(value));
	}

	start(callback) {
		this.stop();
		if (!(this.interval > 0)) {
			return;
		}
		this.timer = setInterval(callback, this.interval);
	}

	setInterval(milliseconds) {
		this.interval = Math.max(0, Number(milliseconds) || 0);
	}

	stop() {
		clearInterval(this.timer);
		this.timer = 0;
	}

	save(model, source = {}) {
		let entries = this.index;
		let timestamp = Date.now();
		while (entries.includes(timestamp)) {
			timestamp += 1;
		}
		const key = `${AUTOSAVE_PREFIX}${timestamp}`;
		const document =
			model instanceof ChartModel ? JSON.parse(model.serialize(0, { includeGeneratedEvents: false })) : model;
		const value = JSON.stringify({ version: 1, document, source: { ...source } });
		const removeOldest = () => {
			const oldest = entries.shift();
			if (oldest != null) {
				this.storage.removeItem(`${AUTOSAVE_PREFIX}${oldest}`);
			}
			return oldest;
		};
		while (true) {
			try {
				this.storage.setItem(key, value);
				break;
			} catch (error) {
				if (!entries.length) {
					throw error;
				}
				removeOldest();
			}
		}
		entries.push(timestamp);
		while (Number.isFinite(this.maxEntries) && entries.length > this.maxEntries) {
			removeOldest();
		}
		while (true) {
			try {
				this.index = entries;
				break;
			} catch (error) {
				const oldestIndex = entries.findIndex(entry => entry !== timestamp);
				if (oldestIndex < 0) {
					if (entries.includes(timestamp)) {
						this.storage.removeItem(key);
					}
					throw error;
				}
				const [oldest] = entries.splice(oldestIndex, 1);
				this.storage.removeItem(`${AUTOSAVE_PREFIX}${oldest}`);
			}
		}
		return timestamp;
	}

	markManualSave() {
		this.storage.setItem(MANUAL_SAVE_KEY, String(Date.now()));
	}

	latestRecoverable() {
		return this.recoverable().at(0) || null;
	}

	listed() {
		return this.#readEntries(this.index.toSorted((left, right) => right - left));
	}

	recoverable() {
		const manualSave = Number(this.storage.getItem(MANUAL_SAVE_KEY) || 0);
		return this.#readEntries(
			this.index.filter(value => value > manualSave).toSorted((left, right) => right - left),
		);
	}

	#readEntries(timestamps) {
		const result = [];
		for (const timestamp of timestamps) {
			try {
				const value = this.storage.getItem(`${AUTOSAVE_PREFIX}${timestamp}`);
				const recovery = value && JSON.parse(value);
				if (recovery?.version === 1 && recovery.document) {
					result.push({
						timestamp,
						model: ChartModel.import(recovery.document),
						source: recovery.source && typeof recovery.source === "object" ? recovery.source : {},
					});
				}
			} catch {
				// Keep other valid recovery entries available.
			}
		}
		return result;
	}
}
