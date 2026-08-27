import { applyTransform, invertTransform, multiplyTransforms } from "../core/geometry.js";

// Turns a free transform drag into an affine matrix. Every branch works in the local space
// of the transform (the space the selection had when the gizmo was opened) and returns the
// matrix that maps that space onto the chart, so the caller only has to store one matrix.
//
// Modifier keys: Ctrl constrains rotation to multiples of 45 degrees and scaling to a
// uniform factor, Shift scales around the (movable) anchor instead of the opposite corner.

const SCALE_EPSILON = 1e-8;
const MINIMUM_SCALE = 0.01;

function boundsCenter(bounds) {
	return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

// The point the selection rotates around: the anchor if the user placed one, otherwise the
// centre of the bounding box. A pinned anchor is stored in chart space, a following anchor
// in local space and therefore has to be mapped through the current matrix.
function rotationCenter(descriptor, drag) {
	if (descriptor?.anchorFollows) {
		return applyTransform(descriptor.anchorLocal, drag.matrix);
	}
	return descriptor?.anchor || applyTransform(boundsCenter(drag.bounds), drag.matrix);
}

// The anchor expressed in local space, or null when there is none or when it cannot be
// mapped back because the matrix is degenerate.
function fixedLocalAnchor(descriptor, drag) {
	if (descriptor?.anchorFollows) {
		return descriptor.anchorLocal ?? null;
	}
	if (!descriptor?.anchor) {
		return null;
	}
	try {
		return applyTransform(descriptor.anchor, invertTransform(drag.matrix));
	} catch {
		return null;
	}
}

function localPoint(chart, drag) {
	try {
		return applyTransform(chart, invertTransform(drag.matrix));
	} catch {
		return null;
	}
}

function freeMoveMatrix(drag, chart) {
	const translation = [1, 0, 0, 1, chart.x - drag.startChart.x, chart.y - drag.startChart.y];
	return multiplyTransforms(translation, drag.matrix);
}

function freeRotateMatrix(drag, chart, event, descriptor) {
	const center = rotationCenter(descriptor, drag);
	const beginning = Math.atan2(drag.startChart.y - center.y, drag.startChart.x - center.x);
	let angle = Math.atan2(chart.y - center.y, chart.x - center.x) - beginning;
	if (event.ctrlKey) {
		angle = (Math.round(angle / (Math.PI / 4)) * Math.PI) / 4;
	}
	const cosine = Math.cos(angle);
	const sine = Math.sin(angle);
	const rotation = [
		cosine,
		sine,
		-sine,
		cosine,
		center.x - cosine * center.x + sine * center.y,
		center.y - sine * center.x - cosine * center.y,
	];
	return multiplyTransforms(rotation, drag.matrix);
}

function scaleAroundAnchor(drag, anchor, scaleX, scaleY) {
	if (Math.abs(scaleX) < MINIMUM_SCALE || Math.abs(scaleY) < MINIMUM_SCALE) {
		return drag.matrix;
	}
	const scaling = [scaleX, 0, 0, scaleY, anchor.x * (1 - scaleX), anchor.y * (1 - scaleY)];
	return multiplyTransforms(drag.matrix, scaling);
}

function axisScale(start, current, anchor) {
	const span = start - anchor;
	return Math.abs(span) < SCALE_EPSILON ? 1 : (current - anchor) / span;
}

// Corner handles: the opposite corner stays put unless Shift pins the anchor instead.
function freeScaleMatrix(drag, chart, event, descriptor) {
	const local = localPoint(chart, drag);
	if (!local) {
		return drag.matrix;
	}
	const { minX, maxX, minY, maxY } = drag.bounds;
	const corners = [
		{ x: minX, y: maxY },
		{ x: maxX, y: maxY },
		{ x: maxX, y: minY },
		{ x: minX, y: minY },
	];
	const fixed = fixedLocalAnchor(descriptor, drag);
	const anchor = event.shiftKey && fixed ? fixed : corners[(drag.hit.index + 2) % 4];
	let scaleX = axisScale(drag.startLocal.x, local.x, anchor.x);
	let scaleY = axisScale(drag.startLocal.y, local.y, anchor.y);
	if (event.ctrlKey) {
		const magnitude = Math.max(Math.abs(scaleX), Math.abs(scaleY));
		scaleX = Math.sign(scaleX || 1) * magnitude;
		scaleY = Math.sign(scaleY || 1) * magnitude;
	}
	return scaleAroundAnchor(drag, anchor, scaleX, scaleY);
}

// Edge handles scale along one axis only; the opposite edge stays put by default.
function edgeAnchor(edge, bounds) {
	const anchors = [
		{ x: 0, y: bounds.minY },
		{ x: bounds.minX, y: 0 },
		{ x: 0, y: bounds.maxY },
		{ x: bounds.maxX, y: 0 },
	];
	return anchors[edge] ?? anchors[3];
}

function freeScaleEdgeMatrix(drag, chart, event, descriptor) {
	const local = localPoint(chart, drag);
	if (!local) {
		return drag.matrix;
	}
	const edge = drag.hit.index;
	const fixed = fixedLocalAnchor(descriptor, drag);
	const anchor = event.shiftKey && fixed ? fixed : edgeAnchor(edge, drag.bounds);
	const vertical = edge === 0 || edge === 2;
	const scaleX = vertical ? 1 : axisScale(drag.startLocal.x, local.x, anchor.x);
	const scaleY = vertical ? axisScale(drag.startLocal.y, local.y, anchor.y) : 1;
	return scaleAroundAnchor(drag, anchor, scaleX, scaleY);
}

const FREE_TRANSFORM_MATRICES = {
	"free-move": freeMoveMatrix,
	"free-rotate": freeRotateMatrix,
	"free-scale": freeScaleMatrix,
	"free-scale-edge": freeScaleEdgeMatrix,
};

export class StageTransformDragTrait {
	_freeTransformMatrix(drag, chart, event) {
		const compute = FREE_TRANSFORM_MATRICES[drag.type];
		if (!compute) {
			return drag.matrix;
		}
		return compute(drag, chart, event, this.callbacks.getFreeTransform?.());
	}
}
