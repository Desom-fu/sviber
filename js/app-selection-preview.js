import { i18n } from "./i18n.js";
import { selected } from "./app-helpers.js";
import { captureHistoryView } from "./core/history.js";

// The live rubber-band selection preview. While a box drag is in flight the selection flags
// are flipped directly on the events (and on the render index) without touching history;
// releasing the button records one history entry, cancelling restores the original flags.
// Split out of app-event-editing.js.

export class SelectionPreviewTrait {

	_setPreviewSelection(event, selected) {
		if (!event) {
			return;
		}
		const value = Boolean(selected);
		if (event.selected === value) {
			return;
		}
		event.selected = value;
		this.renderIndex?.setEventSelected(event, value);
	}

	_startSelectionPreview(mode) {
		if (this.selectionPreview?.mode === mode) {
			return this.selectionPreview;
		}
		this.cancelSelectionPreview();
		const indexIsCurrent =
			this.renderIndex?.eventSource === this.model.events &&
			this.renderIndex.eventById.size === this.model.allEvents().length;
		let eventById = this.renderIndex?.eventById;
		if (!indexIsCurrent) {
			eventById = new Map(this.model.allEvents().map(event => [event.id, event]));
		}
		const baseSelected =
			indexIsCurrent && this.renderIndex.selectedEventIds? new Set(this.renderIndex.selectedEventIds): new Set(
						this.model
							.allEvents()
							.filter(event => event.selected)
							.map(event => event.id),
					);
		this.selectionPreview = { mode, eventById, baseSelected, targets: new Set() };
		if (mode === "replace") {
			for (const id of baseSelected) {
				this._setPreviewSelection(eventById.get(id), false);
			}
		}
		return this.selectionPreview;
	}

	previewSelection(ids, mode = "replace") {
		const preview = this._startSelectionPreview(mode);
		const targets = new Set(ids);
		for (const id of preview.targets) {
			if (targets.has(id)) {
				continue;
			}
			const event = preview.eventById.get(id);
			if (event) {
				this._setPreviewSelection(event, mode === "replace" ? false : preview.baseSelected.has(id));
			}
		}
		for (const id of targets) {
			if (preview.targets.has(id)) {
				continue;
			}
			const event = preview.eventById.get(id);
			if (event) {
				this._setPreviewSelection(event, mode !== "remove");
			}
		}
		preview.targets = targets;
		this.timeline.requestRender();
		this.stage.requestRender();
		this.scrollView?.requestRender();
	}

	finishSelectionPreview(ids, mode = "replace") {
		this.previewSelection(ids, mode);
		const preview = this.selectionPreview;
		if (!preview) {
			return;
		}
		let changed = [...preview.targets].some(id => preview.baseSelected.has(id));
		if (mode === "replace") {
			changed =
				preview.targets.size !== preview.baseSelected.size ||
				[...preview.targets].some(id => !preview.baseSelected.has(id));
		} else if (mode === "add") {
			changed = [...preview.targets].some(id => !preview.baseSelected.has(id));
		}
		this.selectionPreview = null;
		this._normalizeGroupSelectionScope();
		if (!changed) {
			return;
		}
		this.history.recordView(captureHistoryView(this.model), i18n.t("history.selection"));
		this._refreshLightweight({ selectionOnly: true, rebuildIndex: false, skipCommands: true });
	}

	cancelSelectionPreview() {
		const preview = this.selectionPreview;
		if (!preview) {
			return false;
		}
		const affected = new Set([...preview.baseSelected, ...preview.targets]);
		for (const id of affected) {
			const event = preview.eventById.get(id);
			if (event) {
				this._setPreviewSelection(event, preview.baseSelected.has(id));
			}
		}
		this.selectionPreview = null;
		this.timeline.requestRender();
		this.stage.requestRender();
		this.scrollView?.requestRender();
		return true;
	}

	endInteractionPreview() {
		this.cancelSelectionPreview();
		this.cancelPreview();
	}

}
