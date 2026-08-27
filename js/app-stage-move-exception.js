import { MOVABLE_TYPES, selected } from "./app-helpers.js";
import { findEvent } from "./core/grouping.js";

// The stage-move attachment exception. Normally a multi-event selection that mixes attached
// and unattached events cannot be dragged on the stage. The exception records the one case
// where it is allowed: the user just attached a single event, so the same drag may continue.
// Split out of app-event-editing.js.

export class StageMoveExceptionTrait {

	_reconcileStageMoveAttachmentException(selectionBefore) {
		const exception = this.stageMoveAttachmentException;
		if (!exception) {
			return;
		}
		const sameSet = (left, right) => left.size === right.size && [...left].every(id => right.has(id));
		if (!sameSet(selectionBefore, exception.selectionIds)) {
			this.stageMoveAttachmentException = null;
			return;
		}
		const selectionAfter = new Set(
			this.model
				.allEvents()
				.filter(event => event.selected)
				.map(event => event.id),
		);
		if (sameSet(selectionBefore, selectionAfter)) {
			return;
		}
		const onlyAdded = [...selectionBefore].every(id => selectionAfter.has(id));
		const addedAreUnattached = [...selectionAfter]
			.filter(id => !selectionBefore.has(id))
			.every(id => !this.model.findEvent(id)?.attached);
		if (onlyAdded && addedAreUnattached) {
			exception.selectionIds = selectionAfter;
		} else {
			this.stageMoveAttachmentException = null;
		}
	}

	_canUseStageMoveAttachmentException(model) {
		const exception = this.stageMoveAttachmentException;
		if (!exception) {
			return false;
		}
		const selectedIds = new Set(
			model
				.allEvents()
				.filter(event => event.selected)
				.map(event => event.id),
		);
		if (
			selectedIds.size !== exception.selectionIds.size ||
			[...selectedIds].some(id => !exception.selectionIds.has(id))
		) {
			return false;
		}
		const movable = model.allEvents().filter(event => event.selected && MOVABLE_TYPES.has(event.type));
		const attached = movable.filter(event => event.attached);
		return attached.length === 1 && attached[0].id === exception.attachedEventId;
	}

	_captureStageMoveAttachmentException(primaryId) {
		const movable = this.model.allEvents().filter(event => event.selected && MOVABLE_TYPES.has(event.type));
		const attached = movable.filter(event => event.attached);
		this.stageMoveAttachmentException =
			attached.length === 1 && attached[0].id === primaryId? {
						attachedEventId: primaryId,
						selectionIds: new Set(
							this.model
								.allEvents()
								.filter(event => event.selected)
								.map(event => event.id),
						),
					}: null;
	}

}
