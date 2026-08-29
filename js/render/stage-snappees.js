import { applyTransform, sampleSnappee, sampleSnappeePath } from "../core/geometry.js";
import { isSnappeeVisible } from "./stage-helpers.js";

// Drawing of the snappees: the guide curves and meshes that notes can be attached to.
// Their outlines are painted first so that notes sit on top of them, and their control
// points get draggable handles whenever the snappee is selected.

// Meshes are stroked as a grid: every sample point is joined to its right and lower
// neighbour, which is enough to draw both rectangular and parametric meshes.
function strokeMeshGrid(context, points, mapping) {
	const byIndex = new Map(points.map(value => [String(value.snapPoint), value]));
	const segments = [];
	context.beginPath();
	for (const value of points) {
		const [i, j] = value.snapPoint;
		for (const neighbor of [
			[i + 1, j],
			[i, j + 1],
		]) {
			const next = byIndex.get(String(neighbor));
			if (!next) {
				continue;
			}
			const from = mapping.toScreen(value);
			const to = mapping.toScreen(next);
			context.moveTo(from.x, from.y);
			context.lineTo(to.x, to.y);
			segments.push([from, to]);
		}
	}
	context.stroke();
	return segments;
}

// Strokes a polyline through the given points. `closePath` closes the sub path in the canvas
// as well, which sampled curves do not want because their own sampling already returns to the
// start when they are closed.
function strokePolyline(context, points, mapping, closed, closePath) {
	const segments = [];
	context.beginPath();
	points.forEach((value, index) => {
		const point = mapping.toScreen(value);
		if (!index) {
			context.moveTo(point.x, point.y);
		} else {
			context.lineTo(point.x, point.y);
			segments.push([mapping.toScreen(points[index - 1]), point]);
		}
	});
	if (closed && closePath) {
		context.closePath();
	}
	if (closed && points.length > 1) {
		segments.push([mapping.toScreen(points.at(-1)), mapping.toScreen(points[0])]);
	}
	context.stroke();
	return segments;
}

export class StageSnappeesTrait {

	_drawSnappees(context, project, mapping) {
		for (const snappee of project.snappees) {
			if (isSnappeeVisible(snappee)) {
				this._drawSnappee(context, snappee, mapping);
			}
		}
	}

	// Sample points are cached on the render index while a snappee is not being edited; a
	// selected one is resampled every frame so that dragging its handles is live.
	_snappeeSamplePoints(snappee) {
		try {
			return (!snappee.selected && this.renderIndex?.snappeeSamples.get(snappee)) || sampleSnappee(snappee);
		} catch {
			return null;
		}
	}

	_snappeePathPoints(snappee, fallback) {
		try {
			return (!snappee.selected && this.renderIndex?.snappeePaths?.get(snappee)) || sampleSnappeePath(snappee);
		} catch {
			return fallback;
		}
	}

	_drawSnappee(context, snappee, mapping) {
		const points = this._snappeeSamplePoints(snappee);
		if (!points?.length) {
			return;
		}
		context.save();
		context.strokeStyle = snappee.color || "#58b6ef";
		context.fillStyle = snappee.color || "#58b6ef";
		context.globalAlpha = 0.82;
		context.lineWidth = snappee.selected ? 1.8 : 1;
		const bodySegments = this._strokeSnappeeBody(context, snappee, points, mapping);
		// The stroked outline doubles as the grab area of the whole snappee.
		if (snappee.selected && bodySegments.length) {
			this.hitRegions.push({ type: "snappee-body", snappee, segments: bodySegments, tolerance: 9 });
		}
		for (const value of points) {
			const point = mapping.toScreen(value);
			context.beginPath();
			context.arc(point.x, point.y, snappee.selected ? 2.6 : 1.7, 0, Math.PI * 2);
			context.fill();
		}
		if (snappee.selected) {
			this._drawSnappeeHandles(context, snappee, points, mapping);
		}
		context.restore();
	}

	// Strokes the outline of a snappee and returns the screen space segments it consists of.
	_strokeSnappeeBody(context, snappee, points, mapping) {
		if (snappee.type === "rectangularMesh" || snappee.type === "parametricMesh") {
			return strokeMeshGrid(context, points, mapping);
		}
		if (snappee.type === "radialMesh") {
			this._drawRadialMeshPath(context, snappee, mapping);
			return [];
		}
		if (snappee.type === "bezierCurve" || snappee.type === "penCurve") {
			const path = this._snappeePathPoints(snappee, points);
			return strokePolyline(context, path, mapping, snappee.closed, false);
		}
		return strokePolyline(context, points, mapping, snappee.closed, true);
	}

	_drawRadialMeshPath(context, snappee, mapping) {
		const [a, b, c, d, e, f] = snappee.transformation || [1, 0, 0, 1, 0, 0];
		const radialTiles = Math.max(1, Number(snappee.radialTiles) || 1);
		const azimuthalTiles = Math.max(1, Number(snappee.azimuthalTiles) || 1);
		const radius = Math.abs(Number(snappee.radius) || 0);
		const centerX = Number(snappee.centerX) || 0;
		const centerY = Number(snappee.centerY) || 0;
		const angle = Number(snappee.startingAngle) || 0;
		context.save();
		context.transform(
			mapping.scale * a,
			-mapping.scale * b,
			mapping.scale * c,
			-mapping.scale * d,
			mapping.originX + mapping.scale * e,
			mapping.originY - mapping.scale * f,
		);
		context.lineWidth = Math.max(0.2, context.lineWidth / Math.max(mapping.scale, 0.001));
		context.beginPath();
		for (let index = 1; index <= radialTiles; index += 1) {
			context.moveTo(centerX + (radius * index) / radialTiles, centerY);
			context.arc(centerX, centerY, (radius * index) / radialTiles, 0, Math.PI * 2);
		}
		for (let index = 0; index < azimuthalTiles; index += 1) {
			const direction = angle + (index * Math.PI * 2) / azimuthalTiles;
			context.moveTo(centerX, centerY);
			context.lineTo(centerX + Math.cos(direction) * radius, centerY + Math.sin(direction) * radius);
		}
		context.stroke();
		context.restore();
	}

	_drawSnappeeHandles(context, snappee, points, mapping) {
		let handles = [];
		if (snappee.type === "rectangularMesh") {
			handles = [points[0], points.at(-1)];
		} else if (snappee.type === "radialMesh") {
			handles = [points[0], points.find(point => point.snapPoint[1] === (snappee.radialTiles || 1))];
		} else if (snappee.type === "regularPolygonCurve") {
			handles = [applyTransform({ x: snappee.centerX, y: snappee.centerY }, snappee.transformation), points[0]];
		} else if (snappee.type === "bezierCurve") {
			handles = (snappee.controlPoints || []).map((point, index) => ({
				...applyTransform(point, snappee.transformation),
				handleIndex: index,
				shape: "square",
			}));
		} else if (snappee.type === "circularArcCurve") {
			handles = [
				{
					...applyTransform({ x: snappee.centerX, y: snappee.centerY }, snappee.transformation),
					handleIndex: "center",
				},
				points[0],
				points.at(-1),
			];
		} else if (snappee.type === "penCurve") {
			handles = this._penCurveHandles(snappee);
		}
		// v17: control points of Bezier and pen curves are joined by a broken line, and
		// higher-order pen control points use round handles instead of square ones.
		this._drawControlPointGuides(context, snappee, handles, mapping);
		for (let index = 0; index < handles.length; index += 1) {
			const handle = handles[index];
			if (!handle) {
				continue;
			}
			const point = mapping.toScreen(handle);
			context.fillStyle = "#f7f8f9";
			context.strokeStyle = "#101215";
			context.lineWidth = 1;
			// v21: Ctrl+Alt enlarges the handles and their hit boxes.
			const radius = this.ctrlAltHeld ? 9 : 5;
			if (handle.shape === "circle") {
				context.beginPath();
				context.arc(point.x, point.y, radius, 0, Math.PI * 2);
				context.fill();
				context.stroke();
			} else {
				context.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
				context.strokeRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
			}
			const half = this.ctrlAltHeld ? 14 : 8;
			this.hitRegions.push({
				type: "snappee-handle",
				snappee,
				index: handle.handleIndex ?? index,
				x: point.x - half,
				y: point.y - half,
				width: half * 2,
				height: half * 2,
			});
		}
	}

	// First-order control points are the ones the pen curve passes through ("x"/"y");
	// "x1"/"y1" and "x2"/"y2" are the higher-order handles of the same command.
	_penCurveHandles(snappee) {
		const handles = [];
		for (let commandIndex = 0; commandIndex < (snappee.commands || []).length; commandIndex += 1) {
			const command = snappee.commands[commandIndex];
			for (const [x, y] of [
				["x1", "y1"],
				["x2", "y2"],
				["x", "y"],
			]) {
				if (!Number.isFinite(Number(command?.[x])) || !Number.isFinite(Number(command?.[y]))) {
					continue;
				}
				handles.push({
					...applyTransform({ x: Number(command[x]), y: Number(command[y]) }, snappee.transformation),
					handleIndex: { command: commandIndex, x, y },
					shape: x === "x" ? "square" : "circle",
					anchorCommand: x === "x1" ? commandIndex - 1 : commandIndex,
					command: commandIndex,
				});
			}
		}
		return handles;
	}

	_drawControlPointGuides(context, snappee, handles, mapping) {
		if (snappee.type !== "bezierCurve" && snappee.type !== "penCurve") {
			return;
		}
		const usable = handles.filter(Boolean);
		if (usable.length < 2) {
			return;
		}
		context.save();
		context.strokeStyle = "rgba(247,248,249,0.55)";
		context.lineWidth = 1;
		context.setLineDash([4, 3]);
		context.beginPath();
		if (snappee.type === "bezierCurve") {
			usable.forEach((handle, index) => {
				const point = mapping.toScreen(handle);
				if (!index) {
					context.moveTo(point.x, point.y);
				} else {
					context.lineTo(point.x, point.y);
				}
			});
		} else {
			const anchors = new Map();
			for (const handle of usable) {
				if (handle.shape === "square") {
					anchors.set(handle.command, handle);
				}
			}
			for (const handle of usable) {
				const anchor = handle.shape === "circle" ? anchors.get(handle.anchorCommand) : null;
				if (!anchor) {
					continue;
				}
				const from = mapping.toScreen(anchor);
				const to = mapping.toScreen(handle);
				context.moveTo(from.x, from.y);
				context.lineTo(to.x, to.y);
			}
		}
		context.stroke();
		context.restore();
	}

}
