// The history panel.
//
// History ids increase within each chart. A bounded history can drop rows from the
// front and append at the end in one edit; keep the surviving buttons in place.

const MARKER_KINDS = ["save", "autosave"];
const HISTORY_TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

// The save/auto-save badges an entry carries, rebuilt from scratch because an entry can gain
// one at any time (saving does not create a history entry of its own).
function appendMarkerIcons(markers, entry, i18n) {
	for (const kind of MARKER_KINDS) {
		if (!entry.metadata?.historyMarkers?.[kind]) {
			continue;
		}
		const image = document.createElement("img");
		image.src = `svg/icons/${kind === "save" ? "save" : "auto-save"}.svg`;
		image.className = `history-marker is-${kind}`;
		image.alt = i18n.t(`history.marker.${kind}`);
		markers.append(image);
	}
}

export class HistoryPanel {
	#rows = new WeakMap();

	constructor(options = {}) {
		this.element = options.element || document.getElementById("history-list");
		this.i18n = options.i18n;
		this.tooltip = options.tooltip;
		this.onGoTo = options.onGoTo || (() => {});
		this.language = null;
		this._scrollIntoViewFrame = 0;
	}

	#entries(history) {
		return typeof history.panelEntries === "function" ? history.panelEntries() : history.entries;
	}

	#makeItem(id) {
		const button = document.createElement("button");
		button.type = "button";
		button.dataset.historyId = String(id);
		button.className = "history-item";
		const index = document.createElement("span");
		index.className = "history-index";
		const label = document.createElement("span");
		label.className = "history-label";
		const markers = document.createElement("span");
		markers.className = "history-markers";
		const time = document.createElement("time");
		time.className = "history-time";
		button.append(index, label, markers, time);
		const row = { id, index, label, markers, time, entry: null };
		button.addEventListener("click", () => this.onGoTo(row.entry.index));
		row.dispose = this.tooltip?.register(button, "panel.history.seek");
		this.#rows.set(button, row);
		return button;
	}

	#removeItem(button) {
		const next = button.nextElementSibling;
		this.#rows.get(button)?.dispose?.();
		button.remove();
		return next;
	}

	#repaintItem(button, entry, readOnly, relocalize) {
		const row = this.#rows.get(button);
		const previous = row.entry;
		row.entry = entry;
		if (!previous || button.disabled !== readOnly) {
			button.disabled = readOnly;
			button.setAttribute("aria-disabled", String(readOnly));
		}
		if (!previous || previous.active !== entry.active) {
			button.classList.toggle("is-current", Boolean(entry.active));
			row.index.textContent = entry.active ? "›" : "";
		}
		if (!previous || previous.undone !== entry.undone) {
			button.classList.toggle("is-future", Boolean(entry.undone));
		}
		if (relocalize || previous?.label !== entry.label) {
			row.label.textContent = this.i18n.localize(entry.label);
		}
		if (previous?.timestamp !== entry.timestamp) {
			const time = new Date(entry.timestamp);
			row.time.dateTime = time.toISOString();
			row.time.textContent = HISTORY_TIME_FORMAT.format(time);
		}
		const previousMarkers = previous?.metadata?.historyMarkers;
		const nextMarkers = entry.metadata?.historyMarkers;
		if (
			relocalize ||
			MARKER_KINDS.some(kind => Boolean(previousMarkers?.[kind]) !== Boolean(nextMarkers?.[kind]))
		) {
			row.markers.replaceChildren();
			appendMarkerIcons(row.markers, entry, this.i18n);
		}
	}

	#scrollToCurrent(current) {
		if (this._scrollIntoViewFrame) {
			cancelAnimationFrame(this._scrollIntoViewFrame);
			this._scrollIntoViewFrame = 0;
		}
		if (!current) {
			return;
		}
		// Defer so a press-time selection commit cannot force layout during pointerdown.
		this._scrollIntoViewFrame = requestAnimationFrame(() => {
			this._scrollIntoViewFrame = 0;
			if (current.isConnected) {
				current.scrollIntoView({ block: "nearest" });
			}
		});
	}

	render(history, context = {}) {
		this.sync(history, context);
	}

	sync(history, context = {}) {
		const entries = this.#entries(history);
		const readOnly = Boolean(context.readOnly);
		const relocalize = this.language !== this.i18n.language;
		this.language = this.i18n.language;
		let button = this.element.firstElementChild;
		if (this.history !== history) {
			// Each chart owns its own id sequence.
			while (button) {
				button = this.#removeItem(button);
			}
			this.history = history;
		}
		let current = null;
		for (const entry of entries) {
			while (button && this.#rows.get(button).id < entry.id) {
				button = this.#removeItem(button);
			}
			let rowButton;
			if (button && this.#rows.get(button).id === entry.id) {
				rowButton = button;
				button = button.nextElementSibling;
			} else {
				rowButton = this.#makeItem(entry.id);
				this.element.insertBefore(rowButton, button);
			}
			this.#repaintItem(rowButton, entry, readOnly, relocalize);
			if (entry.active) {
				current = rowButton;
			}
		}
		while (button) {
			button = this.#removeItem(button);
		}
		this.#scrollToCurrent(current);
	}
}
