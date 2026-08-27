import { MOVABLE_TYPES, circularArcDraftSpan } from "./stage-helpers.js";

// Previews of things that do not exist in the chart yet: the note about to be created,
// the points of a snappee being drawn and the in-progress curve of the pen tool.

// The path of a curve draft, one branch per snappee kind. `previewPoints` already contains
// the point under the cursor, so the outline follows the mouse while the curve is drawn.

function appendPenDraftSegment(context, mapping, previous, current, fallback) {
	const end = mapping.toScreen(fallback ?? current);
	if (!previous.outgoing && !current.incoming) {
		context.lineTo(end.x, end.y);
		return;
	}
	const control1 = mapping.toScreen(previous.outgoing || previous);
	const control2 = mapping.toScreen(current.incoming || current);
	context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
}

function appendPenDraftPath(context, mapping, draft, curvePreview) {
	const nodes = draft.penNodes;
	const first = mapping.toScreen(nodes[0]);
	context.moveTo(first.x, first.y);
	for (let index = 1; index < nodes.length; index += 1) {
		appendPenDraftSegment(context, mapping, nodes[index - 1], nodes[index]);
	}
	if (draft.closed && nodes.length > 1) {
		appendPenDraftSegment(context, mapping, nodes.at(-1), nodes[0], nodes[0]);
		return;
	}
	if (!curvePreview) {
		return;
	}
	const previous = nodes.at(-1);
	const end = mapping.toScreen(curvePreview);
	if (!previous.outgoing) {
		context.lineTo(end.x, end.y);
		return;
	}
	const control = mapping.toScreen(previous.outgoing);
	context.bezierCurveTo(control.x, control.y, end.x, end.y, end.x, end.y);
}

const DRAFT_CURVE_STEPS = 96;

function appendSampledPath(context, mapping, sample) {
	for (let step = 0; step <= DRAFT_CURVE_STEPS; step += 1) {
		const screen = mapping.toScreen(sample(step / DRAFT_CURVE_STEPS));
		if (!step) {
			context.moveTo(screen.x, screen.y);
		} else {
			context.lineTo(screen.x, screen.y);
		}
	}
}

// De Casteljau evaluation of the control polygon, matching the exported bezier snappee.
function bezierDraftSample(points) {
	return progress => {
		const working = points.map(point => ({ ...point }));
		for (let level = working.length - 1; level > 0; level -= 1) {
			for (let index = 0; index < level; index += 1) {
				working[index].x += (working[index + 1].x - working[index].x) * progress;
				working[index].y += (working[index + 1].y - working[index].y) * progress;
			}
		}
		return working[0];
	};
}

function circularArcDraftSample(previewPoints) {
	const [center, beginning, ending] = previewPoints;
	const radius = Math.hypot(beginning.x - center.x, beginning.y - center.y);
	const start = Math.atan2(beginning.y - center.y, beginning.x - center.x);
	const end = ending ? Math.atan2(ending.y - center.y, ending.x - center.x) : start + Math.PI * 2;
	const span = circularArcDraftSpan(start, end);
	return progress => ({
		x: center.x + radius * Math.cos(start + span * progress),
		y: center.y + radius * Math.sin(start + span * progress),
	});
}

function appendPolylinePath(context, mapping, previewPoints) {
	previewPoints.forEach((point, index) => {
		const screen = mapping.toScreen(point);
		if (!index) {
			context.moveTo(screen.x, screen.y);
		} else {
			context.lineTo(screen.x, screen.y);
		}
	});
}

function appendDraftPath(context, mapping, draft, previewPoints, curvePreview) {
	if (draft.type === "penCurve" && draft.penNodes?.length) {
		appendPenDraftPath(context, mapping, draft, curvePreview);
	} else if (draft.type === "bezierCurve" && previewPoints.length > 1) {
		appendSampledPath(context, mapping, bezierDraftSample(previewPoints));
	} else if (draft.type === "circularArcCurve" && previewPoints.length >= 2) {
		appendSampledPath(context, mapping, circularArcDraftSample(previewPoints));
	} else {
		appendPolylinePath(context, mapping, previewPoints);
	}
}

export class StageDraftsTrait {

	_drawCreationPreview(context, project, mapping) {
		const type = this.callbacks.getCreationMode?.();
		if (!type || !this.creationPreview || !MOVABLE_TYPES.has(type)) {
			return;
		}
		const event = { type, text: "", angle: this.callbacks.getDefaultFlickAngle?.() ?? Math.PI / 2 };
		const screen = mapping.toScreen(this.creationPreview);
		this._drawNoteBody(
			context,
			event,
			screen,
			mapping.scale,
			{
				phase: "active",
				progress: 1,
				alpha: 1,
				relativeTime: 0,
				start: 0,
				end: 0,
			},
			false,
			true,
		);
		if (this.creationPreview.snappee) {
			context.strokeStyle = this.creationPreview.snappee.color || "#56db79";
			context.lineWidth = 2;
			context.beginPath();
			context.arc(screen.x, screen.y, 17 * mapping.scale, 0, Math.PI * 2);
			context.stroke();
		}
	}

	// v17: before the first control point exists (and before the second one for a
	// circular arc), a translucent handle previews where the click would land.
	_drawDraftPointPreview(context, mapping, draft) {
		if (!this.curvePreview) {
			return;
		}
		const placed = draft.points?.length || 0;
		const previewCount = draft.type === "circularArcCurve" ? 2 : 1;
		if (placed >= previewCount) {
			return;
		}
		const screen = mapping.toScreen(this.curvePreview);
		context.save();
		context.globalAlpha = 0.45;
		context.fillStyle = "#f6f8f9";
		context.strokeStyle = "#101215";
		context.lineWidth = 1;
		context.fillRect(screen.x - 5, screen.y - 5, 10, 10);
		context.strokeRect(screen.x - 5, screen.y - 5, 10, 10);
		context.restore();
	}

	_drawBezierDraftGuide(context, mapping, points) {
		if (points.length < 2) {
			return;
		}
		context.save();
		context.strokeStyle = "rgba(246,248,249,0.55)";
		context.lineWidth = 1;
		context.setLineDash([4, 3]);
		context.beginPath();
		points.forEach((point, index) => {
			const screen = mapping.toScreen(point);
			if (!index) {
				context.moveTo(screen.x, screen.y);
			} else {
				context.lineTo(screen.x, screen.y);
			}
		});
		context.stroke();
		context.restore();
	}

	_drawCurveDraft(context, mapping) {
		const draft = this.callbacks.getCurveDraft?.();
		if (!draft) {
			return;
		}
		this._drawDraftPointPreview(context, mapping, draft);
		if (!draft.points?.length) {
			return;
		}
		const previewPoints = this.curvePreview ? [...draft.points, this.curvePreview] : draft.points;
		context.save();
		context.strokeStyle = draft.color || "#53baf0";
		context.fillStyle = "#f6f8f9";
		context.lineWidth = 1.5;
		// A circular arc with only its centre placed is still undefined, so the ghost of the
		// full circle is drawn faintly until the first point on the arc exists.
		if (draft.type === "circularArcCurve" && draft.points.length === 1 && this.curvePreview) {
			context.globalAlpha = 0.4;
		}
		context.beginPath();
		appendDraftPath(context, mapping, draft, previewPoints, this.curvePreview);
		context.stroke();
		if (draft.type === "penCurve") {
			this._drawPenDraftHandles(context, mapping, draft);
		}
		if (draft.type === "bezierCurve") {
			this._drawBezierDraftGuide(context, mapping, previewPoints);
		}
		this._drawDraftPointHandles(context, mapping, draft);
		context.restore();
	}

	// Bezier handles of the pen tool: a thin leg from the anchor to a round grip. The grips
	// are registered as hit regions so that they can be dragged.
	_drawPenDraftHandles(context, mapping, draft) {
		(draft.penNodes || []).forEach((node, index) => {
			const anchor = mapping.toScreen(node);
			for (const kind of ["incoming", "outgoing"]) {
				if (!node[kind]) {
					continue;
				}
				const handle = mapping.toScreen(node[kind]);
				context.beginPath();
				context.moveTo(anchor.x, anchor.y);
				context.lineTo(handle.x, handle.y);
				context.strokeStyle = "rgba(246,248,249,0.72)";
				context.lineWidth = 1;
				context.stroke();
				context.beginPath();
				context.arc(handle.x, handle.y, 4, 0, Math.PI * 2);
				context.fill();
				const region = { x: handle.x - 7, y: handle.y - 7, width: 14, height: 14 };
				this.hitRegions.push({ type: "draft-pen-handle", index, kind, ...region });
			}
		});
	}

	// Square grips for the points placed so far, draggable like the pen handles.
	_drawDraftPointHandles(context, mapping, draft) {
		draft.points.forEach((point, index) => {
			const screen = mapping.toScreen(point);
			context.fillRect(screen.x - 4, screen.y - 4, 8, 8);
			const region = { x: screen.x - 8, y: screen.y - 8, width: 16, height: 16 };
			this.hitRegions.push({ type: "draft-point", index, ...region });
		});
	}

}
