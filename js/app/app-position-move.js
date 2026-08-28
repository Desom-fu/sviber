import { i18n } from "../ui/i18n.js";
import {
	CHART_BOUNDS,
	applyTransform,
	invertTransform,
	isPointWithinChartBounds,
	resolveAttachedPosition,
	sampleSnappee,
} from "../core/geometry.js";
import {
	MOVABLE_TYPES,
	deepClone,
	selected,
	allowsOutOfBounds,
	pointAllowed,
	attachedMoveAllowed,
	shiftedGridSnapPoints,
} from "./app-helpers.js";
import { findEvent } from "../core/grouping.js";
import { snapshotsEqual } from "../core/history.js";

function assignSnapPoints(model, snappee, movable, snapPoints) {
	if (!attachedMoveAllowed(model, snappee, movable, snapPoints)) {
		return false;
	}
	movable.forEach((event, index) => {
		event.snapPoint = snapPoints[index];
	});
	return true;
}

function applyRadialAttachedMove(model, snappee, movable, primary, point) {
	const azimuthal = Math.max(1, Number(snappee.azimuthalTiles) || 1);
	const radialTiles = Math.max(1, Number(snappee.radialTiles) || 1);
	let localPoint;
	try {
		localPoint = applyTransform(point, invertTransform(snappee.transformation));
	} catch {
		return;
	}
	const offsetX = localPoint.x - snappee.centerX;
	const offsetY = localPoint.y - snappee.centerY;
	const angle = Math.atan2(offsetY, offsetX);
	const targetIndex = Math.round(((angle - Number(snappee.startingAngle || 0)) * azimuthal) / (Math.PI * 2));
	const delta = targetIndex - Number(primary.snapPoint[0] || 0);
	const radius = Math.max(1e-9, Math.abs(Number(snappee.radius) || 0));
	const targetRing = Math.round((Math.hypot(offsetX, offsetY) / radius) * radialTiles);
	const requestedRing = targetRing - Number(primary.snapPoint[1] || 0);
	const rings = movable.map(event => Number(event.snapPoint[1] || 0));
	const deltaRing = Math.max(-Math.min(...rings), Math.min(radialTiles - Math.max(...rings), requestedRing));
	const snapPoints = movable.map(event => [
		(((event.snapPoint[0] + delta) % azimuthal) + azimuthal) % azimuthal,
		Number(event.snapPoint[1] || 0) + deltaRing,
	]);
	assignSnapPoints(model, snappee, movable, snapPoints);
}

function applyCurveAttachedMove(model, snappee, movable, primary, points, nearest) {
	const key = value => JSON.stringify(value);
	const indices = new Map(points.map((candidate, index) => [key(candidate.snapPoint), index]));
	const fromIndex = indices.get(key(primary.snapPoint));
	const toIndex = indices.get(key(nearest.snapPoint));
	if (fromIndex == null || toIndex == null) {
		return;
	}
	const delta = toIndex - fromIndex;
	const closed = Boolean(snappee.closed);
	const selectedIndices = movable.map(event => indices.get(key(event.snapPoint))).filter(Number.isInteger);
	let constrainedDelta = delta;
	if (!closed) {
		const minimum = Math.min(...selectedIndices);
		const maximum = Math.max(...selectedIndices);
		constrainedDelta = Math.max(-minimum, Math.min(points.length - 1 - maximum, delta));
	}
	const snapPoints = movable.map(event => {
		const index = indices.get(key(event.snapPoint));
		if (index == null) {
			return event.snapPoint;
		}
		let moved = index + constrainedDelta;
		if (closed) {
			moved = (((index + constrainedDelta) % points.length) + points.length) % points.length;
		}
		return deepClone(points[moved].snapPoint);
	});
	assignSnapPoints(model, snappee, movable, snapPoints);
}

function applyDetachedPositionMove(model, movable, primary, point) {
	const original = resolveAttachedPosition(primary, model.snappees) || primary;
	const target = { x: Number(point.x), y: Number(point.y) };
	const positions = movable.map(event => resolveAttachedPosition(event, model.snappees) || event);
	const requestedX = target.x - original.x;
	const requestedY = target.y - original.y;
	let deltaX = requestedX;
	let deltaY = requestedY;
	if (!allowsOutOfBounds(model)) {
		const xs = positions.map(position => Number(position.x));
		const ys = positions.map(position => Number(position.y));
		deltaX = Math.max(
			CHART_BOUNDS.minX - Math.min(...xs),
			Math.min(CHART_BOUNDS.maxX - Math.max(...xs), requestedX),
		);
		deltaY = Math.max(
			CHART_BOUNDS.minY - Math.min(...ys),
			Math.min(CHART_BOUNDS.maxY - Math.max(...ys), requestedY),
		);
	}
	for (const event of movable) {
		const position = resolveAttachedPosition(event, model.snappees) || event;
		event.attached = false;
		event.x = position.x + deltaX;
		event.y = position.y + deltaY;
		delete event.snappee;
		delete event.snapPoint;
	}
	if (point.snappeeId != null && pointAllowed(model, point)) {
		primary.attached = true;
		primary.snappee = point.snappeeId;
		primary.snapPoint = deepClone(point.snapPoint);
		delete primary.x;
		delete primary.y;
	}
}

// Dragging events around the main field. Two very different moves hide behind one gesture:
// a selection that is entirely attached to one snappee slides along that snappee's snap
// points (grid, radial or curve indices), while anything else moves freely in chart
// coordinates and may re-attach on drop. Split out of app-event-editing.js.

export class PositionMoveTrait {

	previewPosition(primaryId, point) {
		this.preview(i18n.t("history.moveEvents"), model => this._applyPositionMove(model, primaryId, point), {
			lightweight: true,
			incremental: true,
			positionOnly: true,
		});
	}

	movePosition(primaryId, point) {
		const base = this.previewBase || this.model.snapshot();
		const primaryWasAttached = Boolean(findEvent(base.events, primaryId)?.attached);
		this.commit(i18n.t("history.moveEvents"), model => this._applyPositionMove(model, primaryId, point));
		if (!snapshotsEqual(this.model.snapshot(), base)) {
			const primaryIsAttached = Boolean(this.model.findEvent(primaryId)?.attached);
			if (!primaryWasAttached && primaryIsAttached) {
				this._captureStageMoveAttachmentException(primaryId);
			} else if (!this._canUseStageMoveAttachmentException(this.model)) {
				this.stageMoveAttachmentException = null;
			}
		}
	}

	_applyPositionMove(model, primaryId, point) {
		const primary = model.findEvent(primaryId);
		if (!primary) {
			return;
		}
		const roots = model.allEvents().filter(event => event.selected && MOVABLE_TYPES.has(event.type));
		const movable = [
			...new Set(
				roots.flatMap(event =>
					event.type === "group" ? [event, ...model.groupDescendants(event.id)] : [event],
				),
			),
		];
		const attached = movable.filter(event => event.attached);
		const snappeeIds = new Set(attached.map(event => event.snappee));
		let sharedSnappeeId = null;
		if (attached.length === movable.length && snappeeIds.size === 1) {
			sharedSnappeeId = attached[0]?.snappee;
		}
		const sharedSnappee = model.snappees.find(snappee => snappee.id === sharedSnappeeId);
		if (movable.length > 1 && sharedSnappee && primary.attached && primary.snappee === sharedSnappee.id) {
			let points;
			try {
				points = sampleSnappee(sharedSnappee);
			} catch {
				return;
			}
			if (!allowsOutOfBounds(model)) {
				points = points.filter(isPointWithinChartBounds);
			}
			if (!points.length) {
				return;
			}
			const nearest = points.reduce((best, candidate) => {
				const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
				return !best || distance < best.distance ? { candidate, distance } : best;
			}, null)?.candidate;
			if (!nearest) {
				return;
			}
			// v17: rectangular and parametric meshes both move by a common (di, dj).
			if (sharedSnappee.type === "rectangularMesh" || sharedSnappee.type === "parametricMesh") {
				const snapPoints = shiftedGridSnapPoints(sharedSnappee, points, primary, nearest, movable);
				if (!snapPoints || !attachedMoveAllowed(model, sharedSnappee, movable, snapPoints)) {
					return;
				}
				movable.forEach((event, index) => {
					event.snapPoint = snapPoints[index];
				});
				return;
			}
			if (sharedSnappee.type === "radialMesh") {
				applyRadialAttachedMove(model, sharedSnappee, movable, primary, point);
				return;
			}
			if (sharedSnappee.type.endsWith("Curve")) {
				applyCurveAttachedMove(model, sharedSnappee, movable, primary, points, nearest);
				return;
			}
			return;
		}
		if (movable.length > 1 && attached.length === movable.length) {
			return;
		}
		const selectedGroupRoot = roots.length === 1 && roots[0].type === "group" && roots[0].id === primary.id;
		if (
			movable.length > 1 &&
			attached.length &&
			!selectedGroupRoot &&
			!this._canUseStageMoveAttachmentException(model)
		) {
			return;
		}
		applyDetachedPositionMove(model, movable, primary, point);
	}

}
