// Attaching and detaching the selection from snappees, and activating or deactivating the
// snappees the selection is attached to. Attaching snaps each event to the nearest snap
// point of an active snappee; detaching freezes its resolved position.
// Split out of app-event-editing.js.

import { i18n } from "../ui/i18n.js";
import { CHART_BOUNDS, findNearestSnapPoint, resolveAttachedPosition } from "../core/geometry.js";
import { MOVABLE_TYPES, deepClone, allowsOutOfBounds } from "./app-helpers.js";

export const withSnappeeAttach = Base =>
	class extends Base {
		setAttachedSnappeesActive(active) {
			const ids = this.attachedSnappeeIds();
			if (!ids.size) {
				return;
			}
			const commandKey = active ? "command.snappee.activate" : "command.snappee.deactivate";
			this.commit(
				i18n.t(commandKey),
				model => {
					for (const snappee of model.snappees) {
						if (!ids.has(snappee.id)) {
							continue;
						}
						snappee.active = Boolean(active);
						if (!active) {
							snappee.selected = false;
						}
					}
				},
				{
					lightweight: true,
					viewOnly: true,
					snappeeOnly: true,
					rebuildIndex: false,
					skipInspector: true,
					scheduleDirty: false,
					skipCommands: true,
				},
			);
		}

		attachSelected() {
			if (!this.model.snappees.some(snappee => snappee.active !== false)) {
				return;
			}
			this.commit(i18n.t("command.snappee.attach"), model => {
				for (const event of model.allEvents()) {
					if (!event.selected || event.locked || !MOVABLE_TYPES.has(event.type)) {
						continue;
					}
					const position = resolveAttachedPosition(event, model.snappees);
					if (!position) {
						continue;
					}
					const nearest = findNearestSnapPoint(position, model.snappees, {
						activeOnly: true,
						bounds: allowsOutOfBounds(model) ? undefined : CHART_BOUNDS,
					});
					if (!nearest) {
						continue;
					}
					event.attached = true;
					event.snappee = nearest.snappeeId;
					event.snapPoint = deepClone(nearest.snapPoint);
					delete event.x;
					delete event.y;
				}
			});
		}

		detachSelected() {
			this.commit(i18n.t("command.snappee.detach"), model => {
				for (const event of model.allEvents()) {
					if (!event.selected || event.locked || !event.attached || !MOVABLE_TYPES.has(event.type)) {
						continue;
					}
					const position = resolveAttachedPosition(event, model.snappees);
					if (!position) {
						continue;
					}
					event.attached = false;
					event.x = position.x;
					event.y = position.y;
					delete event.snappee;
					delete event.snapPoint;
				}
			});
		}
	};
