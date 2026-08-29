// The status panel and the "checked" state of toggle commands. Split out of app-core.js:
// this module owns everything that reads editor state and writes it back into the status
// bar DOM (time/beat/speed readouts, toggle checkboxes, active comments, selection count,
// the current operation summary) plus the curve-draft description shown while drawing.

import { i18n } from "../ui/i18n.js";
import { Rational } from "../core/rational.js";
import { circularArcSvgPath, penCommandsFromNodes, penCommandsToSvgPath } from "../core/geometry.js";
import { formatTime, formatBeat, eventTypeLabel } from "./app-helpers.js";

const STATUS_CHECKBOXES = Object.freeze([
	["lock-visible-range", "lockVisibleRange"],
	["play-se", "playSe"],
	["play-bg-note-se", "playBgNoteSe"],
	["seek-back-after-playing", "seekBackAfterPlaying"],
	["metronome", "metronome"],
	["show-grouping-in-timeline", "showGroupingInTimeline"],
	["show-grouping-in-main-field", "showGroupingInMainField"],
	["show-tip-points", "showTipPoints"],
	["show-bg-events-in-timeline", "showBgEventsInTimeline"],
	["show-bg-events-in-main-field", "showBgEventsInMainField"],
	["show-hud", "showHud"],
	["show-chart-boundary", "showChartBoundary"],
	["show-rulers", "showRulers"],
	["allow-out-of-bound", "allowOutOfBound"],
	["read-only", "readOnly"],
]);

// The beat readout tracks unsnapped time through the timing map so a waveform drag keeps
// showing a live beat instead of the stale snapped value.
function statusBeat(app, seconds) {
	const editor = app.model.editor;
	if (editor.timeSnapped === false) {
		return app.timing().secondsToBeat(seconds);
	}
	return Rational.from(editor.currentTime);
}

function renderTimeReadouts(app, seconds) {
	const subdivision = app.model.editor.subdivision;
	document.getElementById("status-time").textContent = formatTime(seconds);
	document.getElementById("status-beat").textContent = formatBeat(statusBeat(app, seconds), subdivision);
	document.getElementById("status-speed").textContent = Number(app.model.editor.speed)
		.toFixed(2)
		.replace(/0+$/, "")
		.replace(/\.$/, "");
}

function renderStatusToggles(app) {
	for (const [id, property] of STATUS_CHECKBOXES) {
		const control = document.getElementById(id);
		if (control) {
			control.checked = Boolean(app.model.editor[property]);
		}
	}
}

// The reset button only appears once the main field has actually been panned or zoomed.
function renderResetViewButton(app) {
	const resetView = document.getElementById("reset-main-field-view");
	if (!resetView) {
		return;
	}
	const editor = app.model.editor;
	resetView.hidden =
		Math.abs(Number(editor.mainFieldPanX) || 0) < 1e-9 &&
		Math.abs(Number(editor.mainFieldPanY) || 0) < 1e-9 &&
		Math.abs((Number(editor.mainFieldZoom) || 1) - 1) < 1e-9;
}

function renderSelectionCount(app) {
	const selectedCount =
		app.renderIndex?.selectedEvents?.length ?? app.model.allEvents().filter(event => event.selected).length;
	const selectionElement = document.getElementById("status-selection");
	if (!selectionElement) {
		return;
	}
	selectionElement.hidden = selectedCount === 0;
	selectionElement.textContent = selectedCount ? i18n.t("status.selectedCount", { count: selectedCount }) : "";
}

// Comments whose span covers the playhead. The render index answers this directly when it
// is available; otherwise the events are scanned through the timing map.
function activeComments(app, seconds) {
	const indexed = app.renderIndex?.activeComments(seconds);
	if (indexed) {
		return indexed;
	}
	return app.model.allEvents().filter(event => {
		if (event.type !== "comment") {
			return false;
		}
		const start = app.timing().beatToSeconds(event.time);
		const end = app.timing().beatToSeconds(Rational.from(event.time).add(event.duration || 0));
		return start <= seconds && end > seconds;
	});
}

function renderComments(app, seconds) {
	const comments = activeComments(app, seconds);
	const commentsElement = document.getElementById("status-comments");
	const commentsSignature = JSON.stringify(comments.map(event => [event.id, event.text, Boolean(event.selected)]));
	if (!commentsElement || commentsElement.dataset.signature === commentsSignature) {
		return;
	}
	commentsElement.dataset.signature = commentsSignature;
	commentsElement.replaceChildren(
		...comments.map(event => {
			const item = document.createElement("div");
			item.className = `status-comment${event.selected ? " is-selected" : ""}`;
			item.textContent = String(event.text || "");
			return item;
		}),
	);
}

function creationPreviewText(mode, preview) {
	const coordinates = `x ${preview.x.toFixed(2)}  y ${preview.y.toFixed(2)}`;
	const snappee = preview.snappee ? `\n${preview.snappee.name}` : "";
	return `${eventTypeLabel(mode)}\n${coordinates}${snappee}`;
}

function renderOperationStatus(app) {
	const operation = document.getElementById("operation-status");
	if (app.creationMode && app.stage.creationPreview) {
		operation.textContent = creationPreviewText(app.creationMode, app.stage.creationPreview);
	} else if (app.curveDraft) {
		operation.textContent = app.curveDraftStatusText();
	} else if (app.freeTransform) {
		operation.textContent = app.freeTransform.matrix.map(value => Number(value).toFixed(3)).join("  ");
	} else {
		operation.textContent = "";
	}
}

function penDraftSvgPath(draft) {
	const nodes = draft.penNodes || [];
	if (nodes.length < 1) {
		return "";
	}
	try {
		return penCommandsToSvgPath(penCommandsFromNodes(nodes, Boolean(draft.closed)), Boolean(draft.closed));
	} catch {
		return "";
	}
}

function arcDraftSvgPath(draft) {
	const [center, beginning, ending] = draft.points;
	const radius = Math.hypot(beginning.x - center.x, beginning.y - center.y);
	const beginningAngle = Math.atan2(beginning.y - center.y, beginning.x - center.x);
	return circularArcSvgPath({
		centerX: center.x,
		centerY: center.y,
		radius,
		beginningAngle,
		endAngle: ending ? Math.atan2(ending.y - center.y, ending.x - center.x) : beginningAngle,
		closed: !ending,
	});
}

export const withStatusView = Base =>
	class extends Base {
		_updateStatus() {
			const seconds = this.currentSeconds();
			renderTimeReadouts(this, seconds);
			renderStatusToggles(this);
			this._syncFullscreenState();
			renderResetViewButton(this);
			renderSelectionCount(this);
			renderComments(this, seconds);
			renderOperationStatus(this);
		}

		_updatePlaybackStatus() {
			const seconds = this.currentSeconds();
			renderTimeReadouts(this, seconds);
			renderComments(this, seconds);
		}

		requestStatusUpdate() {
			if (this.statusUpdateFrame) {
				return;
			}
			this.statusUpdateFrame = requestAnimationFrame(() => {
				this.statusUpdateFrame = 0;
				this._updateStatus();
			});
		}

		// v17: while drawing a curve the status panel shows the coordinates of the next
		// control point and, for arc and pen curves, the SVG path data of the draft.
		curveDraftStatusText() {
			const draft = this.curveDraft;
			if (!draft) {
				return "";
			}
			const lines = [`${i18n.t(`snappee.${draft.type}`)}  ${draft.points.length}`];
			const path = this.curveDraftSvgPath();
			if (path) {
				lines.push(path);
			}
			const preview = this.stage?.curvePreview;
			if (preview) {
				lines.push(`x ${Number(preview.x).toFixed(2)}  y ${Number(preview.y).toFixed(2)}`);
			}
			return lines.join("\n");
		}

		curveDraftSvgPath() {
			const draft = this.curveDraft;
			if (!draft) {
				return "";
			}
			if (draft.type === "penCurve") {
				return penDraftSvgPath(draft);
			}
			if (draft.type !== "circularArcCurve" || draft.points.length < 2) {
				return "";
			}
			return arcDraftSvgPath(draft);
		}

		_syncCheckedCommands() {
			for (const type of ["tap", "hold", "drag", "flick", "bgNote"]) {
				this.registry.setChecked(`events.${type}`, this.creationMode === type);
			}
			for (const [id, mode] of [
				["snappee.bezierCurve", "bezierCurve"],
				["snappee.circularArc", "circularArcCurve"],
				["snappee.pen", "penCurve"],
			]) {
				this.registry.setChecked(id, this.curveDraft?.type === mode);
			}
			this.registry.setChecked("transform.free", Boolean(this.freeTransform));
			this.registry.setChecked("music.playPause", this.audio.playing && this.audio.direction > 0);
			this.registry.setChecked("music.playReverse", this.audio.playing && this.audio.direction < 0);
			for (const value of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
				this.registry.setChecked(`music.subdivision${value}`, this.model.editor.subdivision === value);
			}
			for (const [id, value] of [
				["music.speed01", 0.1],
			["music.speed025", 0.25],
				["music.speed05", 0.5],
				["music.speed1", 1],
			]) {
				this.registry.setChecked(id, Math.abs(this.model.editor.speed - value) < 1e-8);
			}
			for (const value of [3, 5, 6, 7, 8, 9]) {
				const rounded = Math.round((1 / value) * 10000) / 10000;
				const matches = Math.abs(this.model.editor.speed - rounded) < 1e-8;
				this.registry.setChecked(`music.speedInverse${value}`, matches);
			}
			this.registry.setChecked("timing.adjustOffset", Boolean(this.offsetAdjustment));
		}
	};
