import { i18n } from "../ui/i18n.js";
import { findNearestSnapPoint, resolveAttachedPosition } from "../core/geometry.js";
import { deepClone } from "./app-helpers.js";
import { findEvent } from "../core/grouping.js";

// Dragging the tip-point spawn marker of an event. An absolutely positioned spawn follows
// the pointer and snaps onto nearby snappees; a relative spawn instead quantises the polar
// offset from its event. Split out of app-event-editing.js.

export class TipSpawnMoveTrait {

	previewTipSpawn(id, point) {
		this.preview(i18n.t("history.editEvent", { type: "" }), model => this._applyTipSpawn(model, id, point), {
			lightweight: true,
			incremental: true,
			positionOnly: true,
		});
	}

	setTipSpawn(id, point) {
		this.commit(i18n.t("history.editEvent", { type: "" }), model => this._applyTipSpawn(model, id, point));
	}

	_applyTipSpawn(model, id, point) {
		const event = model.findEvent(id);
		if (!event) {
			return;
		}
		const position = resolveAttachedPosition(event, model.snappees) || event;
		if (event.tipPointSpawnAbsolutePosition) {
			const snap = findNearestSnapPoint(point, model.snappees, { activeOnly: true, maxDistance: 8 });
			if (snap) {
				event.tipPointSpawnAttached = true;
				event.tipPointSpawnSnappee = snap.snappeeId;
				event.tipPointSpawnSnapPoint = deepClone(snap.snapPoint);
				delete event.tipPointSpawnX;
				delete event.tipPointSpawnY;
			} else {
				event.tipPointSpawnAttached = false;
				event.tipPointSpawnX = point.x;
				event.tipPointSpawnY = point.y;
				delete event.tipPointSpawnSnappee;
				delete event.tipPointSpawnSnapPoint;
			}
		} else {
			const dx = point.x - position.x;
			const dy = point.y - position.y;
			event.tipPointSpawnDistance = Math.round(Math.hypot(dx, dy) / 12.5) * 12.5;
			event.tipPointSpawnAngle = (Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI) / 12;
		}
	}

}
