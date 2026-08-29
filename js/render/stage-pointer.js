import { eventClickSelectionMode } from "./selection.js";
import { flickAngleChanges } from "./flick-angle.js";
import {
	CHART_BOUNDS,
	applyTransform,
	clampPointToChartBounds,
	findNearestSnapPoint,
	invertTransform,
	resolveAttachedPosition,
	sampleSnappee,
	snapSnappeeTranslation,
} from "../core/geometry.js";
import {
	MOVABLE_TYPES,
	isSnappeeVisible,
	projectState,
	currentSeconds,
	selectedEvents,
	pointInPolygon,
} from "./stage-helpers.js";
import { eventChannels } from "../core/grouping.js";

// Pointer handling of the main field: hit testing, hover feedback and the press, drag and
// release cycle that moves notes, snappees, tip point spawns and the free transform gizmo.

function pointToSegmentDistance(point, beginning, ending) {
	const dx = ending.x - beginning.x;
	const dy = ending.y - beginning.y;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared <= 1e-12) {
		return Math.hypot(point.x - beginning.x, point.y - beginning.y);
	}
	const progress = Math.max(
		0,
		Math.min(1, ((point.x - beginning.x) * dx + (point.y - beginning.y) * dy) / lengthSquared),
	);
	return Math.hypot(point.x - (beginning.x + progress * dx), point.y - (beginning.y + progress * dy));
}

function pointToSegmentsDistance(point, segments) {
	return Math.min(...segments.map(([beginning, ending]) => pointToSegmentDistance(point, beginning, ending)));
}

// Alt removes from the selection, Ctrl adds to it, a plain drag replaces it.
function boxSelectionMode(event) {
	if (event.altKey) {
		return "remove";
	}
	return event.ctrlKey ? "add" : "replace";
}

// Ctrl with Space held pans the main field instead of interacting with the chart.
function viewportPanDrag(context) {
	const editor = context.project.editor || {};
	return {
		type: "viewport-pan",
		start: context.point,
		scale: context.mapping.scale,
		panX: Number(editor.mainFieldPanX) || 0,
		panY: Number(editor.mainFieldPanY) || 0,
	};
}

// The nine handles of a bounding box: the four corners, the four edge midpoints and the
// centre. They double as candidate positions for the free transform anchor.
function boundingBoxHandles(bounds) {
	const { minX, maxX, minY, maxY } = bounds;
	const midX = (minX + maxX) / 2;
	const midY = (minY + maxY) / 2;
	return [
		{ x: minX, y: maxY },
		{ x: midX, y: maxY },
		{ x: maxX, y: maxY },
		{ x: maxX, y: midY },
		{ x: maxX, y: minY },
		{ x: midX, y: minY },
		{ x: minX, y: minY },
		{ x: minX, y: midY },
		{ x: midX, y: midY },
	];
}

function freeTransformAnchorCandidates(descriptor) {
	const locals = [...(descriptor?.anchorPoints || []), ...boundingBoxHandles(descriptor.bounds)];
	return locals.map(local => ({ point: applyTransform(local, descriptor.matrix), follows: true, local }));
}

function nearestCandidate(candidates, chart) {
	let best = null;
	let bestDistance = Infinity;
	for (const candidate of candidates) {
		const distance = Math.hypot(candidate.point.x - chart.x, candidate.point.y - chart.y);
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

// One handler per drag kind. Anything named `free-…` that is not listed here is a matrix
// drag of the free transform gizmo and is handled by `_moveFreeTransform`.
const POINTER_MOVE_HANDLERS = {
	"viewport-pan": "_movePan",
	progress: "_moveProgress",
	"free-anchor": "_moveFreeAnchor",
	event: "_moveEvent",
	"group-anchor": "_moveGroupAnchor",
	flick: "_moveFlick",
	tip: "_moveTipSpawn",
	snappee: "_moveSnappeeHandle",
	"snappee-move": "_moveSnappee",
	"draft-point": "_moveDraftPoint",
	"pen-new": "_movePenNode",
	"draft-pen-handle": "_movePenHandle",
	box: "_moveSelectionBox",
};

// The release counterparts of the move handlers: they commit the gesture instead of only
// previewing it. Free transform matrix drags reuse the preview handler, because the last
// previewed matrix is what the editor commits when the gizmo is closed.
const POINTER_UP_HANDLERS = {
	progress: "_commitProgress",
	"viewport-pan": "_commitPan",
	"free-anchor": "_moveFreeAnchor",
	event: "_commitEvent",
	"group-anchor": "_commitGroupAnchor",
	flick: "_commitFlick",
	tip: "_commitTipSpawn",
	snappee: "_commitSnappeeHandle",
	"snappee-move": "_commitSnappeeMove",
	"draft-point": "_commitDraftPoint",
	"pen-new": "_commitPenNode",
	"draft-pen-handle": "_commitPenHandle",
	box: "_commitSelectionBox",
};

export class StagePointerTrait {

	_hitTest(point) {
		const priorities = [
			"free-scale",
			"free-scale-edge",
			"free-anchor",
			"free-rotate",
			"free-move",
			"draft-pen-handle",
			"draft-point",
			"flick-handle",
			"tip-handle",
			"group-anchor",
			"snappee-handle",
			"event",
			"snappee-body",
			"hud-pause",
		];
		for (const type of priorities) {
			for (let index = this.hitRegions.length - 1; index >= 0; index -= 1) {
				const region = this.hitRegions[index];
				if (region.type !== type) {
					continue;
				}
				if (type === "snappee-body") {
					if (pointToSegmentsDistance(point, region.segments) > region.tolerance) {
						continue;
					}
					return region;
				}
				if (region.polygon) {
					if (!pointInPolygon(point, region.polygon)) {
						continue;
					}
				} else if (
					point.x < region.x ||
					point.x > region.x + region.width ||
					point.y < region.y ||
					point.y > region.y + region.height
				) {
					continue;
				}
				if (
					type === "event" &&
					!region.polygon &&
					Math.hypot(point.x - region.centerX, point.y - region.centerY) > region.radius
				) {
					continue;
				}
				return region;
			}
		}
		return null;
	}

	_snapChartPoint(chart, project, mapping) {
		const snap = findNearestSnapPoint(chart, project.snappees, {
			activeOnly: true,
			maxDistance: 9 / mapping.scale,
		});
		return snap ? { x: snap.x, y: snap.y } : chart;
	}

	_previewAt(screenPoint) {
		const project = projectState(this.state);
		const mapping = this._mapping(this.surface.width, this.surface.height);
		const raw = mapping.toChart(screenPoint);
		const allowOutOfBounds = Boolean(project.editor?.allowOutOfBound);
		const target = allowOutOfBounds ? raw : clampPointToChartBounds(raw);
		const snap = findNearestSnapPoint(target, project.snappees, {
			activeOnly: true,
			maxDistance: 6.25,
			bounds: allowOutOfBounds ? undefined : CHART_BOUNDS,
		});
		this.creationPreview = snap ? { ...snap, snappee: snap.snappee } : target;
		this.callbacks.onCreationPreview?.(this.creationPreview);
	}

	_hoverMove(event) {
		this.pointerScreen = this.surface.toLocal(event);
		if (this.drag) {
			return;
		}
		if (projectState(this.state)?.editor?.showRulers) {
			this.requestRender();
		}
		const draft = this.callbacks.getCurveDraft?.();
		if (draft) {
			const mapping = this._mapping(this.surface.width, this.surface.height);
			const chart = mapping.toChart(this.surface.toLocal(event));
			const project = projectState(this.state);
			const snap = findNearestSnapPoint(chart, project.snappees, {
				activeOnly: true,
				maxDistance: 9 / mapping.scale,
			});
			this.curvePreview = snap ? { x: snap.x, y: snap.y } : chart;
			this.requestRender();
		} else if (this.callbacks.getCreationMode?.()) {
			this._previewAt(this.surface.toLocal(event));
			this.requestRender();
		}
	}

	_pointerLeave() {
		this.pointerScreen = null;
		if (this.drag) {
			return;
		}
		this.creationPreview = null;
		// Keep the last curve ghost while drafting. Spurious leave events (HUD/chrome
		// crossings) used to blank the arc preview; a click in that blank frame then
		// grabbed the centre handle and jumped it.
		if (!this.callbacks.getCurveDraft?.()) {
			this.curvePreview = null;
		}
		this.callbacks.onCreationPreview?.(null);
		this.requestRender();
	}

	_capturePointer(event) {
		try {
			this.surface.canvas.setPointerCapture?.(event.pointerId);
		} catch {
			/* Pointer capture is optional. */
		}
	}

	// Every drag listens on the document rather than the canvas so that it keeps tracking
	// once the pointer leaves the main field.
	_listenForDrag() {
		document.addEventListener("pointermove", this.boundMove);
		document.addEventListener("pointerup", this.boundUp, { once: true });
		document.addEventListener("pointercancel", this.boundUp, { once: true });
	}

	// Everything a press needs to know about the state of the editor, resolved once so that
	// the individual gesture handlers do not query the callbacks again.
	_pointerContext(event) {
		return {
			point: this.surface.toLocal(event),
			project: projectState(this.state),
			mapping: this._mapping(this.surface.width, this.surface.height),
			playing: Boolean(this.callbacks.isPlaying?.()),
			curveDraft: this.callbacks.getCurveDraft?.(),
		};
	}

	_activeChannelIds(project) {
		if (this.renderIndex?.activeChannelIds) {
			return this.renderIndex.activeChannelIds;
		}
		return new Set(project.channels.filter(channel => channel.active !== false).map(channel => channel.id));
	}

	_pointerDown(event) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		this._capturePointer(event);
		this.pointerMoved = false;
		const context = this._pointerContext(event);
		if (event.ctrlKey && this.spaceHeld) {
			this.drag = viewportPanDrag(context);
			this._listenForDrag();
			return;
		}
		if (this._handleCreationPress(context)) {
			return;
		}
		const hit = this._hitTest(context.point);
		if (hit?.type === "hud-pause") {
			this.callbacks.onHudPause?.();
			return;
		}
		if (context.curveDraft) {
			this._handleCurveDraftPress(context, hit);
			return;
		}
		if (this._handleProgressPress(context, hit)) {
			return;
		}
		this.drag = this._selectionDrag(event, context, hit);
		if (this.drag) {
			this._listenForDrag();
		}
	}

	// While a creation tool is armed a press places the previewed event instead of selecting.
	_handleCreationPress(context) {
		const creationMode = this.callbacks.getCreationMode?.();
		if (!creationMode || !MOVABLE_TYPES.has(creationMode)) {
			return false;
		}
		if (context.playing) {
			return true;
		}
		this._previewAt(context.point);
		if (this.creationPreview) {
			this.callbacks.onCreateEvent?.(creationMode, this.creationPreview);
		}
		return true;
	}

	// Presses while a snappee is being drawn either grab an existing draft handle, start a
	// new pen node (which can be dragged straight away to shape its handles) or append a
	// plain point.
	_handleCurveDraftPress(context, hit) {
		if (context.playing) {
			return;
		}
		const chart = context.mapping.toChart(context.point);
		const snap = findNearestSnapPoint(chart, context.project.snappees, {
			activeOnly: true,
			maxDistance: 9 / context.mapping.scale,
		});
		this.curvePreview = snap ? { x: snap.x, y: snap.y } : { x: chart.x, y: chart.y };
		// While an arc is still collecting centre/start/end, never steal the press as a
		// handle drag — a click near the centre must place the next point, not move it.
		const arcPlacing =
			context.curveDraft.type === "circularArcCurve" && (context.curveDraft.points?.length || 0) < 3;
		if (!arcPlacing && (hit?.type === "draft-pen-handle" || hit?.type === "draft-point")) {
			this.drag = { type: hit.type, hit, start: context.point };
			this._listenForDrag();
			return;
		}
		if (context.curveDraft.type !== "penCurve") {
			this.callbacks.onCurvePoint?.(this.curvePreview, false);
			return;
		}
		const index = this.callbacks.onPenNodeStart?.(this.curvePreview);
		if (Number.isInteger(index)) {
			this.drag = { type: "pen-new", index, start: context.point };
			this._listenForDrag();
		}
	}

	// The bottom strip of the head-up display is its progress bar; pressing it scrubs.
	_handleProgressPress(context, hit) {
		const { point, project } = context;
		if (hit || point.y < this.surface.height - 18 || project.editor?.showHud === false) {
			return false;
		}
		const current = currentSeconds(this.state, this.timing);
		const beginning = Number(project.editor.visibleRangeBeginning);
		const end = Number(project.editor.visibleRangeEnd);
		this.drag = {
			type: "progress",
			start: point,
			bounds: this.callbacks.getTimeBounds?.() || [0, 10],
			current,
			beginning,
			end,
			followRange: project.editor.lockVisibleRange !== true && current >= beginning && current <= end,
		};
		this.callbacks.onProgressSeek?.(this._progressPayload(this.drag, point.x, false));
		this._listenForDrag();
		return true;
	}

	// v17: with Shift held the mouse does nothing else in the main field, and the event that
	// governs the movement is the selected event that was closest to the pointer when the
	// button went down. When no selected event is in reach a selected snappee moves instead.
	_shiftDragTargets(event, context) {
		if (!event.shiftKey) {
			return { primary: null, snappee: null };
		}
		const channels = this._activeChannelIds(context.project);
		const primary = this._closestSelectedMovable(context.project, context.mapping, context.point, channels);
		if (primary) {
			return { primary, snappee: null };
		}
		const snappee = context.project.snappees.find(item => item.selected && isSnappeeVisible(item));
		return { primary: null, snappee: snappee || null };
	}

	// Decides what a press on the playfield starts to drag. Returns null when the press only
	// changed the selection or is not allowed during playback.
	_selectionDrag(event, context, hit) {
		const freeTransform = this.callbacks.getFreeTransform?.();
		const shift = this._shiftDragTargets(event, context);
		const target = event.shiftKey && !freeTransform ? null : hit;
		if (freeTransform) {
			return this._freeTransformDrag(context, target, freeTransform);
		}
		if (target?.type === "group-anchor") {
			if (context.playing) {
				return null;
			}
			return { type: "group-anchor", hit: target, start: context.point, startChart: target.position };
		}
		if (target?.type === "event") {
			return this._eventPressDrag(event, context, target);
		}
		if (target?.type === "flick-handle") {
			return this._flickPressDrag(context, target);
		}
		if (target?.type === "tip-handle") {
			return { type: "tip", hit: target, start: context.point };
		}
		if (target?.type === "snappee-handle") {
			return { type: "snappee", hit: target, start: context.point };
		}
		if (target?.type === "snappee-body") {
			if (context.playing) {
				return null;
			}
			return this._snappeeMoveDrag(context, target);
		}
		return this._emptyAreaDrag(event, context, shift);
	}

	_snappeeMoveDrag(context, hit) {
		return {
			type: "snappee-move",
			hit,
			start: context.point,
			startChart: context.mapping.toChart(context.point),
		};
	}

	_freeTransformDrag(context, hit, freeTransform) {
		if (context.playing || !hit?.type?.startsWith("free-")) {
			return null;
		}
		const chart = context.mapping.toChart(context.point);
		const drag = {
			type: hit.type,
			hit,
			start: context.point,
			startChart: chart,
			matrix: [...freeTransform.matrix],
			bounds: { ...freeTransform.bounds },
		};
		if (hit.type !== "free-scale" && hit.type !== "free-scale-edge") {
			return drag;
		}
		try {
			drag.startLocal = applyTransform(chart, invertTransform(drag.matrix));
		} catch {
			return null;
		}
		return drag;
	}

	// Pressing an event selects it unless it is already selected, and Alt clicking a selected
	// event only deselects it. Clicking a grouped child may retarget to the group.
	_eventPressDrag(event, context, hit) {
		const selectionEvent = this.renderIndex?.selectionTarget(hit.event) || hit.event;
		let target = hit;
		if (selectionEvent !== hit.event) {
			const position = this.renderIndex?.positionFor(selectionEvent) || selectionEvent;
			target = { ...hit, event: selectionEvent, position };
		}
		const selected = this.renderIndex?.isEventSelected(target.event) ?? Boolean(target.event.selected);
		const selectionMode = eventClickSelectionMode({
			selected,
			ctrlKey: event.ctrlKey,
			altKey: event.altKey,
		});
		if (selectionMode === "remove" && event.altKey) {
			this.callbacks.onSelectEvents?.([target.event.id], "remove");
			return null;
		}
		if (!selected) {
			this.callbacks.onSelectEvents?.([target.event.id], selectionMode);
		}
		// v19: a locked event behaves as if it were not selected, so a press may select it
		// but never starts a move drag.
		if (target.event.locked) {
			return null;
		}
		return {
			type: "event",
			hit: target,
			start: context.point,
			startChart: target.position,
			collapseSelectionOnClick: selectionMode === "remove",
		};
	}

	// Dragging one flick handle turns every selected flick, keeping their relative angles.
	_flickPressDrag(context, hit) {
		const stageSelected = this.renderIndex?.stageSelectedEvents || selectedEvents(context.project);
		const selectedFlicks = [...stageSelected].filter(
			candidate => candidate?.selected && !candidate.locked && candidate.type === "flick",
		);
		const flicks = selectedFlicks.length ? selectedFlicks : [hit.event];
		const primary = flicks.find(candidate => candidate.id === hit.event.id) || hit.event;
		return {
			type: "flick",
			hit,
			start: context.point,
			primaryId: primary.id,
			flicks: flicks.map(candidate => ({ id: candidate.id, angle: Number(candidate.angle) || 0 })),
			position: this._eventPosition(primary, context.project),
		};
	}

	_eventPosition(event, project) {
		return this.renderIndex?.positionFor(event) || resolveAttachedPosition(event, project.snappees) || event;
	}

	// Nothing was hit: either a Shift drag moves the nearest selected object or a selection
	// box is rubber-banded open.
	_emptyAreaDrag(event, context, shift) {
		if (shift.primary) {
			const position = this._eventPosition(shift.primary, context.project);
			if (shift.primary.type === "group") {
				return {
					type: "group-anchor",
					hit: { type: "group-anchor", event: shift.primary, position },
					start: context.point,
					startChart: position,
				};
			}
			return {
				type: "event",
				hit: { type: "event", event: shift.primary, position },
				start: context.point,
				startChart: position,
				collapseSelectionOnClick: false,
			};
		}
		if (shift.snappee) {
			return this._snappeeMoveDrag(context, { type: "snappee-body", snappee: shift.snappee });
		}
		return { type: "box", start: context.point, mode: boxSelectionMode(event) };
	}

	// Closest selected movable event in chart space; used by the Shift drag gesture.
	_closestSelectedMovable(project, mapping, point, activeChannels) {
		const candidates = (this.renderIndex?.selectedEvents || selectedEvents(project)).filter(candidate => {
			if (!candidate?.selected || candidate.locked || !MOVABLE_TYPES.has(candidate.type)) {
				return false;
			}
			if (candidate.type === "group") {
				const channels = eventChannels(candidate);
				return !channels.length || channels.some(channel => activeChannels.has(channel));
			}
			return activeChannels.has(candidate.channel);
		});
		let best = null;
		let bestDistance = Infinity;
		for (const candidate of candidates) {
			const position =
				this.renderIndex?.positionFor(candidate) ||
				resolveAttachedPosition(candidate, project.snappees) ||
				candidate;
			const screen = mapping.toScreen(position);
			const distance = (screen.x - point.x) ** 2 + (screen.y - point.y) ** 2;
			if (distance < bestDistance) {
				bestDistance = distance;
				best = candidate;
			}
		}
		return best;
	}

	// Both the drag preview and the commit on release work on the same snapshot of the
	// pointer position, so they share one context object.
	_pointerContextFor(event) {
		const point = this.surface.toLocal(event);
		const project = projectState(this.state);
		const mapping = this._mapping(this.surface.width, this.surface.height);
		return { event, point, project, mapping, chart: mapping.toChart(point), drag: this.drag };
	}

	_pointerMove(event) {
		const point = this.surface.toLocal(event);
		this.pointerScreen = point;
		if (projectState(this.state)?.editor?.showRulers && !this.drag) {
			this.requestRender();
		}
		if (!this.drag) {
			return;
		}
		if (Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 3) {
			this.pointerMoved = true;
		}
		const context = this._pointerContextFor(event);
		const handler = POINTER_MOVE_HANDLERS[this.drag.type];
		const handled = handler ? this[handler](context) : this._moveFreeTransform(context);
		if (handled !== false) {
			this.requestRender();
		}
	}

	_movePan({ point }) {
		this.callbacks.onMainFieldPan?.(
			this.drag.panX + (point.x - this.drag.start.x) / this.drag.scale,
			this.drag.panY + (point.y - this.drag.start.y) / this.drag.scale,
		);
	}

	_moveProgress({ point }) {
		this.callbacks.onProgressSeek?.(this._progressPayload(this.drag, point.x, false));
	}

	_moveFreeTransform(context) {
		if (!context.drag.type.startsWith("free-")) {
			return false;
		}
		const matrix = this._freeTransformMatrix(context.drag, context.chart, context.event);
		this.callbacks.onPreviewFreeTransform?.(matrix);
		return true;
	}

	// The free transform anchor snaps to the anchor points of the selection and to the nine
	// handles of its bounding box before falling back to the snappee snap points. Releasing
	// the handle keeps the previewed anchor, so press and release run the same code.
	_moveFreeAnchor({ chart, mapping, project }) {
		const descriptor = this.callbacks.getFreeTransform?.();
		const internal = nearestCandidate(freeTransformAnchorCandidates(descriptor), chart);
		const limit = 9 / mapping.scale;
		if (internal && Math.hypot(internal.point.x - chart.x, internal.point.y - chart.y) <= limit) {
			this.callbacks.onPreviewFreeTransformAnchor?.(internal);
			return true;
		}
		const snap = findNearestSnapPoint(chart, project.snappees, {
			activeOnly: true,
			maxDistance: limit,
			bounds: project.editor?.allowOutOfBound ? undefined : CHART_BOUNDS,
		});
		this.callbacks.onPreviewFreeTransformAnchor?.({ point: snap || chart, follows: false });
		return true;
	}

	// Where a dragged event ends up: clamped into the playfield unless out of bound editing
	// is enabled, then snapped to a nearby snappee point.
	_positionSnapTarget({ chart, mapping, project }) {
		const allowOutOfBounds = Boolean(project.editor?.allowOutOfBound);
		const target = allowOutOfBounds ? chart : clampPointToChartBounds(chart);
		const snap = findNearestSnapPoint(target, project.snappees, {
			activeOnly: true,
			maxDistance: 9 / mapping.scale,
			bounds: allowOutOfBounds ? undefined : CHART_BOUNDS,
		});
		return snap || target;
	}

	// The anchor of a group snaps to its own direct children first, then to snappee points.
	_groupAnchorSnapTarget(context) {
		const { chart, mapping, project, drag } = context;
		const allowOutOfBounds = Boolean(project.editor?.allowOutOfBound);
		const target = allowOutOfBounds ? chart : clampPointToChartBounds(chart);
		const child = this._nearestGroupChild(drag.hit.event, target);
		const limit = 9 / mapping.scale;
		if (child && Math.hypot(child.position.x - target.x, child.position.y - target.y) <= limit) {
			return { x: child.position.x, y: child.position.y, groupEventId: child.event.id };
		}
		const snap = findNearestSnapPoint(target, project.snappees, {
			activeOnly: true,
			maxDistance: limit,
			bounds: allowOutOfBounds ? undefined : CHART_BOUNDS,
		});
		return snap || target;
	}

	_moveEvent(context) {
		this.callbacks.onPreviewPosition?.(context.drag.hit.event.id, this._positionSnapTarget(context));
	}

	_moveGroupAnchor(context) {
		this.callbacks.onPreviewGroupAnchor?.(context.drag.hit.event.id, this._groupAnchorSnapTarget(context));
	}

	_nearestGroupChild(group, target) {
		const children = (group.events || [])
			.filter(event => MOVABLE_TYPES.has(event.type))
			.map(event => ({ event, position: this.renderIndex?.positionFor(event) || event }))
			.filter(({ position }) => Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y)));
		let best = null;
		let bestDistance = Infinity;
		for (const candidate of children) {
			const distance = Math.hypot(candidate.position.x - target.x, candidate.position.y - target.y);
			if (distance < bestDistance) {
				best = candidate;
				bestDistance = distance;
			}
		}
		return best;
	}

	// Turning one selected flick turns them all, keeping their relative angles.
	_flickAngleChanges({ chart, drag }) {
		const position = drag.position;
		const pointerAngle = Math.atan2(chart.y - position.y, chart.x - position.x);
		return flickAngleChanges(drag.flicks, drag.primaryId, pointerAngle);
	}

	_moveFlick(context) {
		const changes = this._flickAngleChanges(context);
		const primaryId = context.drag.primaryId;
		this.callbacks.onPreviewFlickAngle?.(primaryId, changes.get(primaryId), changes);
	}

	_moveTipSpawn({ chart, project, drag }) {
		const settingsEvent = drag.hit.settingsEvent || drag.hit.event;
		this.callbacks.onPreviewTipSpawn?.(settingsEvent.id, this._tipHandleEditPoint(drag.hit, chart, project));
	}

	// A snappee control point may snap to the other snappees but never to its own.
	_snappeeHandleTarget({ chart, mapping, project, drag }) {
		const candidates = project.snappees.filter(snappee => snappee.id !== drag.hit.snappee.id);
		const snap = findNearestSnapPoint(chart, candidates, {
			activeOnly: true,
			maxDistance: 9 / mapping.scale,
		});
		return snap || chart;
	}

	_moveSnappeeHandle(context) {
		const { drag } = context;
		const target = this._snappeeHandleTarget(context);
		this.callbacks.onPreviewSnappeeHandle?.(drag.hit.snappee.id, drag.hit.index, target);
	}

	// Moving a whole snappee snaps its translation so that any of its points can land on a
	// snap point of another snappee.
	_snappeeTranslation({ chart, mapping, project, drag }) {
		const requested = { x: chart.x - drag.startChart.x, y: chart.y - drag.startChart.y };
		return snapSnappeeTranslation(drag.hit.snappee, requested, project.snappees, {
			activeOnly: true,
			maxDistance: 9 / mapping.scale,
			bounds: project.editor?.allowOutOfBound ? undefined : CHART_BOUNDS,
		});
	}

	_moveSnappee(context) {
		const movement = this._snappeeTranslation(context);
		this.callbacks.onPreviewSnappeeMove?.(context.drag.hit.snappee.id, movement);
	}

	_draftPointTarget({ chart, mapping, project }) {
		const snap = findNearestSnapPoint(chart, project.snappees, {
			activeOnly: true,
			maxDistance: 9 / mapping.scale,
		});
		return snap || chart;
	}

	_moveDraftPoint(context) {
		if (!this.pointerMoved) {
			return false;
		}
		this.callbacks.onPreviewCurvePoint?.(context.drag.hit.index, this._draftPointTarget(context));
	}

	_movePenNode({ chart, mapping, project, drag }) {
		this.callbacks.onPreviewPenNode?.(drag.index, this._snapChartPoint(chart, project, mapping));
	}

	_movePenHandle({ chart, mapping, project, drag }) {
		const point = this._snapChartPoint(chart, project, mapping);
		this.callbacks.onPreviewPenHandle?.(drag.hit.index, drag.hit.kind, point);
	}

	// Ids of the events whose on screen position falls inside the given screen rectangle.
	_eventIdsInBox(x1, y1, x2, y2) {
		const inside = this.visibleEvents.filter(
			item => item.screen.x >= x1 && item.screen.x <= x2 && item.screen.y >= y1 && item.screen.y <= y2,
		);
		return inside.map(item => this.renderIndex?.selectionTarget(item.event)?.id || item.event.id);
	}

	_moveSelectionBox({ point }) {
		if (!this.pointerMoved) {
			return false;
		}
		this.selectionBox ||= { x1: this.drag.start.x, y1: this.drag.start.y, x2: point.x, y2: point.y };
		this.selectionBox.x2 = point.x;
		this.selectionBox.y2 = point.y;
		const x1 = Math.min(this.selectionBox.x1, point.x);
		const x2 = Math.max(this.selectionBox.x1, point.x);
		const y1 = Math.min(this.selectionBox.y1, point.y);
		const y2 = Math.max(this.selectionBox.y1, point.y);
		this.callbacks.onPreviewBoxSelect?.(this._eventIdsInBox(x1, y1, x2, y2), this.drag.mode);
		return true;
	}

	_progressPayload(drag, x, final) {
		const progress = Math.max(0, Math.min(1, x / Math.max(1, this.surface.width)));
		return {
			seconds: drag.bounds[0] + progress * (drag.bounds[1] - drag.bounds[0]),
			startSeconds: drag.current,
			beginning: drag.beginning,
			end: drag.end,
			followRange: drag.followRange,
			final,
		};
	}

	_pointerUp(event) {
		if (!this.drag) {
			return;
		}
		const context = this._pointerContextFor(event);
		const handler = POINTER_UP_HANDLERS[context.drag.type];
		if (handler) {
			this[handler](context);
		} else {
			this._moveFreeTransform(context);
		}
		this.callbacks.onEndPreview?.();
		this.selectionBox = null;
		this.drag = null;
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		this.requestRender();
	}

	_commitProgress({ point, drag }) {
		this.callbacks.onProgressSeek?.(this._progressPayload(drag, point.x, true));
	}

	// A cancelled pan is discarded instead of being applied at the last known position.
	_commitPan({ event, point, drag }) {
		if (event.type === "pointercancel") {
			return;
		}
		this.callbacks.onMainFieldPan?.(
			drag.panX + (point.x - drag.start.x) / drag.scale,
			drag.panY + (point.y - drag.start.y) / drag.scale,
		);
	}

	// A click that never moved does not move the event; it only collapses the selection down
	// to the clicked event when the press had asked for that.
	_commitEvent(context) {
		const { drag } = context;
		if (this.pointerMoved) {
			this.callbacks.onMovePosition?.(drag.hit.event.id, this._positionSnapTarget(context));
			return;
		}
		if (drag.collapseSelectionOnClick) {
			this.callbacks.onSelectEvents?.([drag.hit.event.id], "remove");
		}
	}

	_commitGroupAnchor(context) {
		const { drag } = context;
		if (this.pointerMoved) {
			this.callbacks.onMoveGroupAnchor?.(drag.hit.event.id, this._groupAnchorSnapTarget(context));
			return;
		}
		if (drag.hit.event.selected) {
			this.callbacks.onSelectEvents?.([drag.hit.event.id], "remove");
		}
	}

	_commitFlick(context) {
		const changes = this._flickAngleChanges(context);
		const primaryId = context.drag.primaryId;
		this.callbacks.onFlickAngle?.(primaryId, changes.get(primaryId), changes);
	}

	_commitTipSpawn({ chart, project, drag }) {
		const settingsEvent = drag.hit.settingsEvent || drag.hit.event;
		this.callbacks.onTipSpawn?.(settingsEvent.id, this._tipHandleEditPoint(drag.hit, chart, project));
	}

	_commitSnappeeHandle(context) {
		const { drag } = context;
		this.callbacks.onSnappeeHandle?.(drag.hit.snappee.id, drag.hit.index, this._snappeeHandleTarget(context));
	}

	_commitSnappeeMove(context) {
		this.callbacks.onSnappeeMove?.(context.drag.hit.snappee.id, this._snappeeTranslation(context));
	}

	// Clicking a draft point without dragging it makes it the active point instead.
	_commitDraftPoint(context) {
		if (!this.pointerMoved) {
			this.callbacks.onCurvePointActivate?.(context.drag.hit.index);
			return;
		}
		this.callbacks.onCurvePointMove?.(context.drag.hit.index, this._draftPointTarget(context));
	}

	_commitPenNode({ chart, mapping, project, drag }) {
		const point = this._snapChartPoint(chart, project, mapping);
		this.callbacks.onPenNode?.(drag.index, point, this.pointerMoved);
	}

	_commitPenHandle({ chart, mapping, project, drag }) {
		const point = this._snapChartPoint(chart, project, mapping);
		this.callbacks.onPenHandle?.(drag.hit.index, drag.hit.kind, point);
	}

	// A rubber band selects what it covers; a bare click clears the selection.
	_commitSelectionBox({ point, drag }) {
		if (!this.pointerMoved) {
			if (drag.mode === "replace") {
				this.callbacks.onSelectEvents?.([], "replace");
			}
			return;
		}
		const x1 = Math.min(drag.start.x, point.x);
		const x2 = Math.max(drag.start.x, point.x);
		const y1 = Math.min(drag.start.y, point.y);
		const y2 = Math.max(drag.start.y, point.y);
		this.callbacks.onBoxSelect?.(this._eventIdsInBox(x1, y1, x2, y2), drag.mode);
	}

	_doubleClick(event) {
		const playing = Boolean(this.callbacks.isPlaying?.());
		if (this.callbacks.getCurveDraft?.()) {
			if (playing) {
				return;
			}
			this.callbacks.onCurveDoubleClick?.();
			return;
		}
		if (playing && (this.callbacks.getCreationMode?.() || this.callbacks.getFreeTransform?.())) {
			return;
		}
		const point = this.surface.toLocal(event);
		const mapping = this._mapping(this.surface.width, this.surface.height);
		const chartPoint = mapping.toChart(point);
		const project = projectState(this.state);
		const eventHit = this._hitTest(point);
		if (eventHit?.type === "event" && eventHit.event.type !== "group") {
			this.callbacks.onEnterGroupSelection?.(eventHit.event.id);
			return;
		}
		let nearest = null;
		for (const snappee of project.snappees) {
			if (!isSnappeeVisible(snappee)) {
				continue;
			}
			let points;
			try {
				points = sampleSnappee(snappee);
			} catch {
				continue;
			}
			const distance = Math.min(
				...points.map(candidate => Math.hypot(candidate.x - chartPoint.x, candidate.y - chartPoint.y)),
			);
			if (!nearest || distance < nearest.distance) {
				nearest = { snappee, distance };
			}
		}
		if (nearest && nearest.distance < 8 / mapping.scale) {
			const ids = this.visibleEvents
				.filter(record => record.event.attached && record.event.snappee === nearest.snappee.id)
				.map(record => record.event.id);
			this.callbacks.onSelectEvents?.(ids, event.altKey ? "remove" : event.ctrlKey ? "add" : "replace");
			return;
		}
	}

}
