import { i18n } from "../ui/i18n.js";
import { applyTransform, invertTransform } from "../core/geometry.js";
import { mutateSnappeeWithinBounds, constrainSnappeeTranslation } from "./app-helpers.js";

// Dragging snappees on the main field: their control handles (which reshape the snappee)
// and the snappee body (which translates it). Handle drags work in the snappee's own local
// space, so the pointer is first mapped through the inverse of its transformation.
// Split out of app-event-editing.js.

export class SnappeeDragTrait {

	previewSnappeeHandle(id, index, point) {
		this.preview(i18n.t("history.editSnappee"), model => this._applySnappeeHandle(model, id, index, point), {
			lightweight: true,
			incremental: true,
			positionOnly: true,
		});
	}

	setSnappeeHandle(id, index, point) {
		this.commit(i18n.t("history.editSnappee"), model => this._applySnappeeHandle(model, id, index, point));
	}

	previewSnappeeMove(id, delta) {
		this.preview(
			i18n.t("history.editSnappee"),
			model => {
				const movement = constrainSnappeeTranslation(model, id, delta);
				return this._applyTransformMutation(model, [1, 0, 0, 1, movement.x, movement.y], {
					snappeeId: id,
					onlySnappee: true,
				});
			},
			{ lightweight: true, snappees: true, snappeeId: id, stageOnly: true },
		);
	}

	moveSnappee(id, delta) {
		this.commit(i18n.t("history.editSnappee"), model => {
			const movement = constrainSnappeeTranslation(model, id, delta);
			return this._applyTransformMutation(model, [1, 0, 0, 1, movement.x, movement.y], {
				snappeeId: id,
				onlySnappee: true,
			});
		});
	}

	_applySnappeeHandle(model, id, index, point) {
		return mutateSnappeeWithinBounds(model, id, snappee => {
			let localPoint;
			try {
				localPoint = applyTransform(point, invertTransform(snappee.transformation));
			} catch {
				return false;
			}
			if (snappee.type === "rectangularMesh") {
				if (index === 0) {
					snappee.topLeftX = localPoint.x;
					snappee.topLeftY = localPoint.y;
				} else {
					snappee.bottomRightX = localPoint.x;
					snappee.bottomRightY = localPoint.y;
				}
			} else if (snappee.type === "radialMesh") {
				if (index === 0) {
					snappee.centerX = localPoint.x;
					snappee.centerY = localPoint.y;
				} else {
					snappee.radius = Math.hypot(localPoint.x - snappee.centerX, localPoint.y - snappee.centerY);
					snappee.startingAngle = Math.atan2(
						localPoint.y - snappee.centerY,
						localPoint.x - snappee.centerX,
					);
				}
			} else if (snappee.type === "bezierCurve" && Number.isInteger(index)) {
				snappee.controlPoints[index] = { x: localPoint.x, y: localPoint.y };
			} else if (snappee.type === "circularArcCurve") {
				if (index === "center" || index === 0) {
					snappee.centerX = localPoint.x;
					snappee.centerY = localPoint.y;
				} else {
					const angle = Math.atan2(localPoint.y - snappee.centerY, localPoint.x - snappee.centerX);
					if (index === 1) {
						snappee.beginningAngle = angle;
					} else {
						snappee.endAngle = angle;
					}
				}
			} else if (snappee.type === "regularPolygonCurve") {
				if (index === 0) {
					snappee.centerX = localPoint.x;
					snappee.centerY = localPoint.y;
				} else {
					snappee.radius = Math.hypot(localPoint.x - snappee.centerX, localPoint.y - snappee.centerY);
					snappee.angle = Math.atan2(localPoint.y - snappee.centerY, localPoint.x - snappee.centerX);
				}
			} else if (snappee.type === "penCurve" && index && typeof index === "object") {
				const command = snappee.commands?.[index.command];
				if (!command) {
					return false;
				}
				command[index.x] = localPoint.x;
				command[index.y] = localPoint.y;
			}
			return true;
		});
	}

}
