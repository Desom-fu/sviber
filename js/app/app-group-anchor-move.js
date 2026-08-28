import { i18n } from "../ui/i18n.js";
import { CHART_BOUNDS, resolveAttachedPosition } from "../core/geometry.js";
import { deepClone, selected, allowsOutOfBounds, pointAllowed } from "./app-helpers.js";
import { findEvent } from "../core/grouping.js";

// Dragging the anchor of a group. The anchor is a position of its own, so moving it shifts
// every selected group by the same delta and detaches them; only the primary group may
// re-attach on drop. Split out of app-event-editing.js.

export class GroupAnchorMoveTrait {

	previewGroupAnchor(primaryId, point) {
		this.preview(i18n.t("history.moveEvents"), model => this._applyGroupAnchorMove(model, primaryId, point), {
			lightweight: true,
			incremental: true,
			positionOnly: true,
		});
	}

	moveGroupAnchor(primaryId, point) {
		this.commit(i18n.t("history.moveEvents"), model => this._applyGroupAnchorMove(model, primaryId, point));
	}

	_applyGroupAnchorMove(model, primaryId, point) {
		const primary = model.findEvent(primaryId);
		if (primary?.type !== "group") {
			return;
		}
		const groups = model.allEvents().filter(event => event.type === "group" && event.selected);
		if (!groups.length || !groups.includes(primary)) {
			return;
		}
		if (groups.length > 1 && groups.some(group => group.attached)) {
			return;
		}
		const original = resolveAttachedPosition(primary, model.snappees) || primary;
		const target = point;
		const requestedX = Number(target.x) - Number(original.x);
		const requestedY = Number(target.y) - Number(original.y);
		const positions = groups.map(group => resolveAttachedPosition(group, model.snappees) || group);
		const deltaX = allowsOutOfBounds(model)? requestedX: Math.max(
					CHART_BOUNDS.minX - Math.min(...positions.map(position => Number(position.x))),
					Math.min(
						CHART_BOUNDS.maxX - Math.max(...positions.map(position => Number(position.x))),
						requestedX,
					),
				);
		const deltaY = allowsOutOfBounds(model)? requestedY: Math.max(
					CHART_BOUNDS.minY - Math.min(...positions.map(position => Number(position.y))),
					Math.min(
						CHART_BOUNDS.maxY - Math.max(...positions.map(position => Number(position.y))),
						requestedY,
					),
				);
		for (const group of groups) {
			const position = resolveAttachedPosition(group, model.snappees) || group;
			group.attached = false;
			group.x = Number(position.x) + deltaX;
			group.y = Number(position.y) + deltaY;
			delete group.snappee;
			delete group.snapPoint;
		}
		if (point.snappeeId != null && pointAllowed(model, point)) {
			primary.attached = true;
			primary.snappee = point.snappeeId;
			primary.snapPoint = deepClone(point.snapPoint);
			delete primary.x;
			delete primary.y;
		}
	}

}
