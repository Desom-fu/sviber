import { resolveAttachedPosition, sampleSnappee } from "./core/geometry.js";
import { MOVABLE_TYPES, selected } from "./app-helpers.js";

// Deciding what a transform acts on. A transform reaches the snappees the selection is
// attached to, the selected events that are not attached, and — indirectly — every event
// attached to one of those snappees. It also computes the bounding box the free-transform
// handles are drawn around. Split out of app-event-editing.js.

export class TransformTargetsTrait {

	attachedSnappeeIds(model = this.model) {
		const available = new Set(model.snappees.map(snappee => snappee.id));
		const selectedEvents = new Set(
			model
				.allEvents()
				.filter(event => event.selected)
				.flatMap(event =>
					event.type === "group" ? [event, ...model.groupDescendants(event.id)] : [event],
				),
		);
		return new Set(
			model
				.allEvents()
				.filter(event => selectedEvents.has(event) && event.attached && available.has(event.snappee))
				.map(event => event.snappee),
		);
	}

	transformationTargets(model = this.model, options = {}) {
		const explicitSnappeeId = options.snappeeId;
		const attachedIds =
			explicitSnappeeId == null ? this.attachedSnappeeIds(model) : new Set([explicitSnappeeId]);
		if (explicitSnappeeId == null && !model.allEvents().some(event => event.selected)) {
			const selectedSnappee = model.snappees.find(snappee => snappee.selected && snappee.active !== false);
			if (selectedSnappee) {
				attachedIds.add(selectedSnappee.id);
			}
		}
		const allEvents = model.allEvents();
		const selectedGroups = allEvents.filter(event => event.selected && event.type === "group");
		const groupedDescendants = new Set(selectedGroups.flatMap(group => model.groupDescendants(group.id)));
		const directEvents = options.onlySnappee? []: allEvents.filter(event => {
					if (!MOVABLE_TYPES.has(event.type)) {
						return false;
					}
					if (event.selected && !event.attached) {
						return true;
					}
					return groupedDescendants.has(event) && !event.attached;
				});
		const affectedEvents = allEvents.filter(
			event =>
				directEvents.includes(event) ||
				(event.attached && attachedIds.has(event.snappee) && MOVABLE_TYPES.has(event.type)),
		);
		return { attachedIds, directEvents, affectedEvents };
	}

	transformationAvailable(model = this.model) {
		const { attachedIds, directEvents } = this.transformationTargets(model);
		return attachedIds.size > 0 || directEvents.length > 0;
	}

	transformSelectionBounds(model = this.model) {
		const { attachedIds, directEvents } = this.transformationTargets(model);
		const points = directEvents.map(event => resolveAttachedPosition(event, model.snappees)).filter(Boolean);
		for (const snappee of model.snappees) {
			if (!attachedIds.has(snappee.id)) {
				continue;
			}
			try {
				points.push(...sampleSnappee(snappee));
			} catch {}
		}
		if (!points.length) {
			return null;
		}
		const xs = points.map(point => point.x);
		const ys = points.map(point => point.y);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;
		const halfWidth = Math.max((maxX - minX) / 2, 0.5);
		const halfHeight = Math.max((maxY - minY) / 2, 0.5);
		const bounds = {
			minX: centerX - halfWidth,
			maxX: centerX + halfWidth,
			minY: centerY - halfHeight,
			maxY: centerY + halfHeight,
		};
		return bounds;
	}

}
