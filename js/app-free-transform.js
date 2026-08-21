import { resolveAttachedPosition, sampleSnappee } from "./core/geometry.js";

export const withFreeTransform = Base => class extends Base {
	startFreeTransform() {
		if (this.freeTransform) { this.finishFreeTransform(); return true; }
		this.exitModes();
		const bounds = this.transformSelectionBounds();
		if (!bounds) return false;
		const rawPoints = this._freeTransformAnchorPoints();
		const xs = rawPoints.map(point => point.x);
		const ys = rawPoints.map(point => point.y);
		if (!rawPoints.length || Math.max(...xs) - Math.min(...xs) <= 1e-9 || Math.max(...ys) - Math.min(...ys) <= 1e-9) return false;
		const anchorLocal = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
		this.freeTransform = {
			base: this.model.snapshot(), bounds, anchor: { ...anchorLocal }, anchorLocal,
			anchorFollows: true, anchorPoints: rawPoints, matrix: [1, 0, 0, 1, 0, 0],
		};
		this.refresh();
		return true;
	}
	_freeTransformAnchorPoints(model = this.model) {
		const { attachedIds, directEvents } = this.transformationTargets(model);
		const points = directEvents.map(event => resolveAttachedPosition(event, model.snappees)).filter(Boolean);
		for (const snappee of model.snappees) {
			if (!attachedIds.has(snappee.id)) continue;
			try { points.push(...sampleSnappee(snappee)); } catch { /* Ignore an invalid draft snappee. */ }
		}
		return points.map(point => ({ x: Number(point.x), y: Number(point.y) }))
			.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
	}
	previewFreeTransformAnchor(anchor) {
		if (!this.freeTransform || !anchor?.point) return false;
		const point = { x: Number(anchor.point.x), y: Number(anchor.point.y) };
		if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
		this.freeTransform.anchor = point;
		this.freeTransform.anchorFollows = Boolean(anchor.follows);
		if (this.freeTransform.anchorFollows && anchor.local) {
			this.freeTransform.anchorLocal = { x: Number(anchor.local.x), y: Number(anchor.local.y) };
		}
		this.refresh();
		return true;
	}
};
