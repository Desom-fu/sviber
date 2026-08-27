import { i18n } from "./i18n.js";
import {
	CHART_BOUNDS,
	applyTransform,
	findNearestSnapPoint,
	multiplyTransforms,
	resolveAttachedPosition,
	sampleSnappee,
	transformAngle,
} from "./core/geometry.js";
import { MOVABLE_TYPES, deepClone, selected, allowsOutOfBounds, pointAllowed } from "./app-helpers.js";
import { snapshotsEqual } from "./core/history.js";
import { TIP_POINTABLE_TYPES } from "./app-tip-point-modes.js";

// Applying an affine matrix to the selection. The mutation is all-or-nothing: it first
// checks that every resulting snappee sample and event position is still allowed, and only
// then rewrites the snappee transformations, the free event coordinates, the flick angles
// and the tip-point spawns. Split out of app-event-editing.js.

export class SelectionTransformTrait {

	_transformTipPointSpawn(event, model, matrix, transformedSnappeeIds) {
		if (!TIP_POINTABLE_TYPES.has(event.type) || !["chain", "drop"].includes(event.tipPointSpawnType)) {
			return;
		}
		if (!event.tipPointSpawnAbsolutePosition) {
			const distance = Math.max(0, Number(event.tipPointSpawnDistance) || 0);
			let angle = Math.PI / 2;
			if (Number.isFinite(Number(event.tipPointSpawnAngle))) {
				angle = Number(event.tipPointSpawnAngle);
			}
			const origin = applyTransform({ x: 0, y: 0 }, matrix);
			const endpoint = applyTransform(
				{ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance },
				matrix,
			);
			const dx = endpoint.x - origin.x;
			const dy = endpoint.y - origin.y;
			event.tipPointSpawnDistance = Math.hypot(dx, dy);
			if (event.tipPointSpawnDistance > 1e-12) {
				event.tipPointSpawnAngle = Math.atan2(dy, dx);
			}
			return;
		}
		if (event.tipPointSpawnAttached && transformedSnappeeIds.has(event.tipPointSpawnSnappee)) {
			return;
		}
		let position = { x: Number(event.tipPointSpawnX) || 0, y: Number(event.tipPointSpawnY) || 0 };
		if (event.tipPointSpawnAttached) {
			position = resolveAttachedPosition(event, model.snappees, { prefix: "tipPointSpawn" });
		}
		const transformed = applyTransform(position || { x: 0, y: 100 }, matrix);
		event.tipPointSpawnAttached = false;
		event.tipPointSpawnX = transformed.x;
		event.tipPointSpawnY = transformed.y;
		delete event.tipPointSpawnSnappee;
		delete event.tipPointSpawnSnapPoint;
	}

	_applyTransformMutation(model, matrix, options = {}) {
		const { attachedIds, directEvents, affectedEvents } = this.transformationTargets(model, options);
		if (!directEvents.length && !attachedIds.size) {
			return false;
		}
		for (const snappee of model.snappees) {
			if (!attachedIds.has(snappee.id) || allowsOutOfBounds(model)) {
				continue;
			}
			let points;
			try {
				points = sampleSnappee(snappee);
			} catch {
				return false;
			}
			for (const point of points) {
				if (!pointAllowed(model, applyTransform(point, matrix))) {
					return false;
				}
			}
		}
		for (const event of affectedEvents) {
			const position = resolveAttachedPosition(event, model.snappees);
			if (!position) {
				return false;
			}
			const transformed = applyTransform(position, matrix);
			if (!pointAllowed(model, transformed)) {
				return false;
			}
		}
		for (const event of affectedEvents) {
			this._transformTipPointSpawn(event, model, matrix, attachedIds);
		}
		for (const snappee of model.snappees) {
			if (attachedIds.has(snappee.id)) {
				snappee.transformation = multiplyTransforms(matrix, snappee.transformation);
			}
		}
		for (const event of directEvents) {
			const transformed = applyTransform(event, matrix);
			event.x = transformed.x;
			event.y = transformed.y;
		}
		for (const event of affectedEvents) {
			if (event.type === "flick") {
				event.angle = transformAngle(event.angle, matrix);
			}
		}
		return true;
	}

	finishFreeTransform() {
		if (!this.freeTransform) {
			return false;
		}
		const after = this.model.snapshot();
		const changed = !snapshotsEqual(this.freeTransform.base, after);
		this.freeTransform = null;
		if (changed) {
			this.history.record(after, i18n.t("history.transform"), null, { force: true, owned: true });
			this.syncActiveDifficultyState?.();
			this.dirty = true;
		}
		this.refresh();
		return changed;
	}

	cancelFreeTransform() {
		if (!this.freeTransform) {
			return false;
		}
		this.model.restore(this.freeTransform.base);
		this.freeTransform = null;
		this.refresh();
		return true;
	}

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
				if (!event.selected || !MOVABLE_TYPES.has(event.type)) {
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
				if (!event.selected || !event.attached || !MOVABLE_TYPES.has(event.type)) {
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

	translateSelected(deltaX, deltaY) {
		return this.applyTransformToSelection([1, 0, 0, 1, Number(deltaX), Number(deltaY)]);
	}

	applyTransformToSelection(transform) {
		if (!Array.isArray(transform) || transform.length !== 6) {
			return false;
		}
		const matrix = transform.map(Number);
		if (matrix.some(value => !Number.isFinite(value))) {
			return false;
		}
		if (this.freeTransform) {
			return this.previewFreeTransform(multiplyTransforms(matrix, this.freeTransform.matrix));
		}
		let applied = false;
		this.commit(i18n.t("history.transform"), model => {
			applied = this._applyTransformMutation(model, matrix);
		});
		return applied;
	}

	async showTransformDialog() {
		this.exitModes();
		const values = await this.dialogs.form({
			titleKey: "dialog.transformMatrix",
			values: { matrix: [1, 0, 0, 1, 0, 0] },
			fields: [{ id: "matrix", type: "matrix", labelKey: "field.transform", numeric: true, required: true }],
		});
		if (!values) {
			return;
		}
		this.applyTransformToSelection(values.matrix);
	}

}
