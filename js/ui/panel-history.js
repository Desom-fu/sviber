// The history panel.
//
// Undo history changes on nearly every edit, so this panel is written to patch rather than
// rebuild: `sync` keeps the longest prefix of buttons whose entry ids still match, removes and
// re-creates only the tail, and then repaints the flags (current, undone, save markers) on the
// ones it kept. Labels are re-localized only when the interface language actually changed.
//
// Split out of js/panels.js.

const MARKER_KINDS = ["save", "autosave"];

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
	constructor(options = {}) {
		this.element = options.element || document.getElementById("history-list");
		this.i18n = options.i18n;
		this.tooltip = options.tooltip;
		this.onGoTo = options.onGoTo || (() => {});
		this.cleanup = [];
		this.language = null;
	}

	#entries(history) {
		return typeof history.panelEntries === "function" ? history.panelEntries() : history.entries;
	}

	#makeItem(entry, context = {}) {
		const readOnly = Boolean(context.readOnly);
		const button = document.createElement("button");
		button.type = "button";
		button.dataset.historyId = String(entry.id);
		button.disabled = readOnly;
		button.setAttribute("aria-disabled", String(readOnly));
		button.className = `history-item${entry.active ? " is-current" : ""}${entry.undone ? " is-future" : ""}`;
		const index = document.createElement("span");
		index.className = "history-index";
		index.textContent = entry.active ? "›" : "";
		const label = document.createElement("span");
		label.className = "history-label";
		label.textContent = this.i18n.localize(entry.label);
		const markers = document.createElement("span");
		markers.className = "history-markers";
		appendMarkerIcons(markers, entry, this.i18n);
		const time = document.createElement("time");
		time.className = "history-time";
		time.dateTime = new Date(entry.timestamp).toISOString();
		time.textContent = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		button.append(index, label, markers, time);
		button.addEventListener("click", () => this.onGoTo(entry.index));
		const dispose = this.tooltip?.register(button, "panel.history.seek");
		button._disposeTooltip = dispose;
		this.cleanup.push(dispose);
		return button;
	}

	#repaintItem(button, entry, readOnly, relocalize) {
		button.disabled = readOnly;
		button.setAttribute("aria-disabled", String(readOnly));
		button.classList.toggle("is-current", Boolean(entry.active));
		button.classList.toggle("is-future", Boolean(entry.undone));
		const marker = button.querySelector(".history-index");
		if (marker) {
			marker.textContent = entry.active ? "›" : "";
		}
		if (relocalize) {
			const label = button.querySelector(".history-label");
			if (label) {
				label.textContent = this.i18n.localize(entry.label);
			}
		}
		const markers = button.querySelector(".history-markers");
		if (markers) {
			markers.replaceChildren();
			appendMarkerIcons(markers, entry, this.i18n);
		}
	}

	#paint(entries, context = {}, relocalize = false) {
		const readOnly = Boolean(context.readOnly);
		let current = null;
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const button = this.element.children[index];
			if (!button) {
				continue;
			}
			this.#repaintItem(button, entry, readOnly, relocalize);
			if (entry.active) {
				current = button;
			}
		}
		current?.scrollIntoView({ block: "nearest" });
	}

	// How many leading buttons still describe the same entries, and so can be kept as they are.
	#matchingPrefix(entries) {
		let prefix = 0;
		const limit = Math.min(this.element.children.length, entries.length);
		while (prefix < limit && this.element.children[prefix].dataset.historyId === String(entries[prefix].id)) {
			prefix += 1;
		}
		return prefix;
	}

	render(history, context = {}) {
		this.sync(history, context);
	}

	sync(history, context = {}) {
		const entries = this.#entries(history);
		const relocalize = this.language !== this.i18n.language;
		this.language = this.i18n.language;
		const prefix = this.#matchingPrefix(entries);
		for (let index = this.element.children.length - 1; index >= prefix; index -= 1) {
			const button = this.element.children[index];
			button._disposeTooltip?.();
			button.remove();
		}
		this.cleanup = this.cleanup.slice(0, prefix);
		for (let index = prefix; index < entries.length; index += 1) {
			this.element.append(this.#makeItem(entries[index], context));
		}
		this.#paint(entries, context, relocalize);
	}
}
