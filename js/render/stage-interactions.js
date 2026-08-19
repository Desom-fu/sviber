import { Rational } from "../core/rational.js";
import { TimingMap } from "../core/timing.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, multiplyTransforms, resolveAttachedPosition, sampleSnappee } from "../core/geometry.js";
import { PixiCanvasSurface } from "./pixi-surface.js";
import { MOVABLE_TYPES, NOTE_TYPES, PATTERN_TYPES, DURATION_TYPES, TIP_POINT_SPAWN_TYPES, TIP_POINT_TRAIL_DURATION, TIP_POINT_ZOOM_DURATION, TIP_POINT_TRAIL_TAIL_DURATION, SUNNIESNOW_AUTOPLAY_GRADIENT, SUNNIESNOW_SKIN, sunniesnowNoteRadius, sunniesnowNoteTextColor, sunniesnowPlayfieldScale, isSnappeeVisible, sunniesnowTapDoubleLinePairs, circularArcDraftSpan, sunniesnowEventVisualState, sunniesnowPatternVisualState, sunniesnowDisplayedPattern, colorIntegerToCss, randomColor, projectState, timingFor, currentSeconds, tipPointSpawnTime, buildTipPointGuides, tipPointDirection, sampleTipPointPath, tipPointPathBetween, tipPointVisualState, directionBetween, adjacentDirection, tipPointTrailEdges, drawTipPointTrail, appendPolygonPath, polygonPath, selectedEvents, pointInPolygon } from "./stage-helpers.js";

export const withStageInteractions = Base => class extends Base {
	_drawHud(context, width, height, project, now) {
		const metadata = project.metadata || this.state;
		const unit = width / 60;
		const drawBackground = mirrored => {
			context.save();
			if (mirrored) {
				context.translate(width, 0);
				context.scale(-1, 1);
			}
			context.beginPath();
			context.moveTo(0, 0);
			context.lineTo(20 * unit, 0);
			context.lineTo(22 * unit, 2 * unit);
			context.lineTo(20 * unit, 4 * unit);
			context.lineTo(0, 4 * unit);
			context.closePath();
			context.fillStyle = "rgba(0,0,0,0.5)";
			context.fill();
			context.beginPath();
			context.moveTo(20 * unit, 2 * unit);
			context.lineTo(19 * unit, 3 * unit);
			context.lineTo(18 * unit, 2 * unit);
			context.lineTo(20 * unit, 0);
			context.lineTo(22 * unit, 2 * unit);
			context.lineTo(20 * unit, 4 * unit);
			context.lineTo(0, 4 * unit);
			context.lineTo(0, 0);
			context.lineTo(20 * unit, 0);
			context.strokeStyle = "#ffffff";
			context.lineWidth = unit / 6;
			context.stroke();
			context.restore();
		};
		context.save();
		drawBackground(false);
		drawBackground(true);
		const hudFont = width / 45;
		const title = String(metadata.title || "");
		context.font = `${hudFont}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
		const titleWidth = context.measureText(title).width;
		const titleFont = hudFont * Math.min(1, 13 * unit / Math.max(titleWidth, 1));
		context.font = `${titleFont}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
		context.fillStyle = "#ffffff";
		context.textBaseline = "middle";
		context.textAlign = "left";
		context.fillText(title, 4 * unit, 2 * unit);

		const playableCount = this.renderIndex?.hitRecords.length
			?? project.events.filter(event => NOTE_TYPES.has(event.type)).length;
		const hitCount = this.renderIndex?.hudHitCount(now) ?? project.events.filter(event => {
			if (!NOTE_TYPES.has(event.type)) return false;
			const { start, end } = this._eventTimes(event);
			return now >= (event.type === "hold" ? end : start);
		}).length;
		const score = playableCount ? Math.floor(1_000_000 * hitCount / playableCount) : 0;
		context.textAlign = "right";
		context.font = `${hudFont}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
		context.fillStyle = "#ffffff";
		context.fillText(String(score), width - 2 * unit, 2 * unit);
		context.textAlign = "left";
		context.fillStyle = metadata.difficultyColor || "#7f7f7f";
		context.fillText(String(metadata.difficultyName || ""), width - 15 * unit, 2 * unit);

		const playing = Boolean(this.callbacks.isPlaying?.());
		if (hitCount !== this.lastHudCombo) {
			this.lastHudCombo = hitCount;
			this.hudComboAnimationStarted = playing ? performance.now() : null;
		}
		if (!playing) this.hudComboAnimationStarted = null;
		if (hitCount > 0) {
			let scaleX = 1;
			let scaleY = 1;
			if (this.hudComboAnimationStarted != null) {
				const animationFrames = (performance.now() - this.hudComboAnimationStarted) / (1000 / 60);
				scaleX += 0.6 * Math.exp(-0.6 * animationFrames);
				scaleY += 0.5 * Math.exp(-0.5 * animationFrames);
			}
			context.save();
			context.translate(width / 2, width / 18);
			context.scale(scaleX, scaleY);
			context.textAlign = "center";
			context.fillStyle = "#ffffff";
			context.font = `${width / 30}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
			context.textBaseline = "bottom";
			context.fillText(String(hitCount), 0, 0);
			const autoplayFontSize = width / 45;
			const autoplayGradient = context.createLinearGradient(0, 0, 0, autoplayFontSize);
			autoplayGradient.addColorStop(0, SUNNIESNOW_AUTOPLAY_GRADIENT.top);
			autoplayGradient.addColorStop(1, SUNNIESNOW_AUTOPLAY_GRADIENT.bottom);
			context.fillStyle = autoplayGradient;
			context.font = `${autoplayFontSize}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
			context.textBaseline = "top";
			context.fillText("⟐ Autoplay ⟐", 0, 0);
			context.restore();
		}

		const bounds = this.callbacks.getTimeBounds?.() || [0, 10];
		const progress = Math.max(0, Math.min(1, (now - bounds[0]) / Math.max(0.001, bounds[1] - bounds[0])));
		const barHeight = width / 200;
		context.fillStyle = "rgba(255,255,255,0.5)";
		context.fillRect(0, height - barHeight, width, barHeight);
		context.fillStyle = "#c3efec";
		context.fillRect(0, height - barHeight, width * progress, barHeight);
		context.restore();
	}

	_drawSelectionBox(context, rectangle) {
		const x = Math.min(rectangle.x1, rectangle.x2);
		const y = Math.min(rectangle.y1, rectangle.y2);
		const width = Math.abs(rectangle.x2 - rectangle.x1);
		const height = Math.abs(rectangle.y2 - rectangle.y1);
		context.fillStyle = "rgba(48,134,255,0.17)";
		context.strokeStyle = "#72adff";
		context.lineWidth = 1;
		context.fillRect(x, y, width, height);
		context.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width, height);
	}

	_hitTest(point) {
		const priorities = ["free-scale", "free-rotate", "free-move", "draft-pen-handle", "draft-point", "flick-handle", "tip-handle", "snappee-handle", "event"];
		for (const type of priorities) {
			for (let index = this.hitRegions.length - 1; index >= 0; index -= 1) {
				const region = this.hitRegions[index];
				if (region.type !== type) continue;
				if (region.polygon) {
					if (!pointInPolygon(point, region.polygon)) continue;
				} else if (point.x < region.x || point.x > region.x + region.width
					|| point.y < region.y || point.y > region.y + region.height) continue;
				if (type === "event" && !region.polygon
					&& Math.hypot(point.x - region.centerX, point.y - region.centerY) > region.radius) continue;
				return region;
			}
		}
		return null;
	}

	_previewAt(screenPoint) {
		const project = projectState(this.state);
		const mapping = this._mapping(this.surface.width, this.surface.height);
		const raw = mapping.toChart(screenPoint);
		const allowOutOfBounds = Boolean(project.editor?.allowOutOfBounds);
		const target = allowOutOfBounds ? raw : clampPointToChartBounds(raw);
		const snap = findNearestSnapPoint(target, project.snappees, {
			activeOnly: true,
			maxDistance: 9 / mapping.scale,
			bounds: allowOutOfBounds ? undefined : CHART_BOUNDS,
		});
		this.creationPreview = snap ? { ...snap, snappee: snap.snappee } : target;
		this.callbacks.onCreationPreview?.(this.creationPreview);
	}

	_hoverMove(event) {
		if (this.drag) return;
		const draft = this.callbacks.getCurveDraft?.();
		if (draft) {
			const mapping = this._mapping(this.surface.width, this.surface.height);
			const chart = mapping.toChart(this.surface.toLocal(event));
			const project = projectState(this.state);
			const snap = findNearestSnapPoint(chart, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale });
			this.curvePreview = snap ? { x: snap.x, y: snap.y } : chart;
			this.requestRender();
		} else if (this.callbacks.getCreationMode?.()) {
			this._previewAt(this.surface.toLocal(event));
			this.requestRender();
		}
	}

	_pointerLeave() {
		if (this.drag) return;
		this.creationPreview = null;
		this.curvePreview = null;
		this.callbacks.onCreationPreview?.(null);
		this.requestRender();
	}

	_pointerDown(event) {
		if (event.button !== 0) return;
		event.preventDefault();
		const point = this.surface.toLocal(event);
		const project = projectState(this.state);
		const mapping = this._mapping(this.surface.width, this.surface.height);
		this.pointerMoved = false;
		const playing = Boolean(this.callbacks.isPlaying?.());
		const creationMode = this.callbacks.getCreationMode?.();
		if (creationMode && MOVABLE_TYPES.has(creationMode)) {
			if (playing) return;
			this._previewAt(point);
			if (this.creationPreview) this.callbacks.onCreateEvent?.(creationMode, this.creationPreview);
			return;
		}
		const hit = this._hitTest(point);
		const curveDraft = this.callbacks.getCurveDraft?.();
		if (curveDraft) {
			if (playing) return;
			if (hit?.type === "draft-pen-handle") {
				this.drag = { type: "draft-pen-handle", hit, start: point };
				document.addEventListener("pointermove", this.boundMove);
				document.addEventListener("pointerup", this.boundUp, { once: true });
				document.addEventListener("pointercancel", this.boundUp, { once: true });
			} else if (hit?.type === "draft-point") {
				this.drag = { type: "draft-point", hit, start: point };
				document.addEventListener("pointermove", this.boundMove);
				document.addEventListener("pointerup", this.boundUp, { once: true });
				document.addEventListener("pointercancel", this.boundUp, { once: true });
			} else if (curveDraft.type === "penCurve") {
				const chart = mapping.toChart(point);
				const snap = findNearestSnapPoint(chart, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale });
				const anchor = snap ? { x: snap.x, y: snap.y } : chart;
				const index = this.callbacks.onPenNodeStart?.(anchor);
				if (Number.isInteger(index)) {
					this.drag = { type: "pen-new", index, start: point };
					document.addEventListener("pointermove", this.boundMove);
					document.addEventListener("pointerup", this.boundUp, { once: true });
					document.addEventListener("pointercancel", this.boundUp, { once: true });
				}
			} else {
				this.callbacks.onCurvePoint?.(mapping.toChart(point), false);
			}
			return;
		}
		const freeTransform = this.callbacks.getFreeTransform?.();
		const activeChannels = this.renderIndex?.activeChannelIds
			|| new Set(project.channels.filter(channel => channel.active !== false).map(channel => channel.id));
		const shiftPrimary = event.shiftKey
			? project.events.findLast(candidate => candidate.selected && MOVABLE_TYPES.has(candidate.type)
				&& activeChannels.has(candidate.channel))
			: null;
		if (freeTransform) {
			if (playing) return;
			if (!hit?.type?.startsWith("free-")) return;
			const chart = mapping.toChart(point);
			this.drag = {
				type: hit.type,
				hit,
				start: point,
				startChart: chart,
				matrix: [...freeTransform.matrix],
				bounds: { ...freeTransform.bounds },
			};
			if (hit.type === "free-scale") {
				try { this.drag.startLocal = applyTransform(chart, invertTransform(this.drag.matrix)); } catch { this.drag = null; return; }
			}
		} else if (hit?.type === "event" && !shiftPrimary) {
			if (event.altKey) {
				this.callbacks.onSelectEvents?.([hit.event.id], "remove");
				return;
			}
			if (event.ctrlKey && !hit.event.selected) this.callbacks.onSelectEvents?.([hit.event.id], "add");
			else if (!event.ctrlKey && !hit.event.selected) this.callbacks.onSelectEvents?.([hit.event.id], "replace");
			this.drag = { type: "event", hit, start: point, startChart: hit.position,
				collapseSelectionOnClick: !event.ctrlKey && Boolean(hit.event.selected) };
		} else if (hit?.type === "flick-handle") {
			this.drag = { type: "flick", hit, start: point };
		} else if (hit?.type === "tip-handle") {
			this.drag = { type: "tip", hit, start: point };
		} else if (hit?.type === "snappee-handle") {
			this.drag = { type: "snappee", hit, start: point };
		} else {
			const primary = shiftPrimary;
			if (primary) {
				const position = this.renderIndex?.positionFor(primary)
					|| resolveAttachedPosition(primary, project.snappees) || primary;
				this.drag = {
					type: "event",
					hit: { type: "event", event: primary, position },
					start: point,
					startChart: position,
					collapseSelectionOnClick: false,
				};
			} else {
				this.drag = { type: "box", start: point, mode: event.altKey ? "remove" : event.ctrlKey ? "add" : "replace" };
			}
		}
		document.addEventListener("pointermove", this.boundMove);
		document.addEventListener("pointerup", this.boundUp, { once: true });
		document.addEventListener("pointercancel", this.boundUp, { once: true });
	}

	_freeTransformMatrix(drag, chart, event) {
		if (drag.type === "free-move") {
			return multiplyTransforms([1, 0, 0, 1, chart.x - drag.startChart.x, chart.y - drag.startChart.y], drag.matrix);
		}
		if (drag.type === "free-rotate") {
			const center = applyTransform({
				x: (drag.bounds.minX + drag.bounds.maxX) / 2,
				y: (drag.bounds.minY + drag.bounds.maxY) / 2,
			}, drag.matrix);
			const beginning = Math.atan2(drag.startChart.y - center.y, drag.startChart.x - center.x);
			let angle = Math.atan2(chart.y - center.y, chart.x - center.x) - beginning;
			if (event.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12;
			const cosine = Math.cos(angle);
			const sine = Math.sin(angle);
			const rotation = [cosine, sine, -sine, cosine,
				center.x - cosine * center.x + sine * center.y,
				center.y - sine * center.x - cosine * center.y];
			return multiplyTransforms(rotation, drag.matrix);
		}
		if (drag.type === "free-scale") {
			let local;
			try { local = applyTransform(chart, invertTransform(drag.matrix)); } catch { return drag.matrix; }
			const corners = [
				{ x: drag.bounds.minX, y: drag.bounds.maxY }, { x: drag.bounds.maxX, y: drag.bounds.maxY },
				{ x: drag.bounds.maxX, y: drag.bounds.minY }, { x: drag.bounds.minX, y: drag.bounds.minY },
			];
			const anchor = corners[(drag.hit.index + 2) % 4];
			const startX = drag.startLocal.x - anchor.x;
			const startY = drag.startLocal.y - anchor.y;
			let scaleX = Math.abs(startX) < 1e-8 ? 1 : (local.x - anchor.x) / startX;
			let scaleY = Math.abs(startY) < 1e-8 ? 1 : (local.y - anchor.y) / startY;
			if (event.shiftKey) {
				const magnitude = Math.max(Math.abs(scaleX), Math.abs(scaleY));
				scaleX = Math.sign(scaleX || 1) * magnitude;
				scaleY = Math.sign(scaleY || 1) * magnitude;
			}
			if (Math.abs(scaleX) < 0.01 || Math.abs(scaleY) < 0.01) return drag.matrix;
			return multiplyTransforms(drag.matrix, [scaleX, 0, 0, scaleY,
				anchor.x * (1 - scaleX), anchor.y * (1 - scaleY)]);
		}
		return drag.matrix;
	}

	_pointerMove(event) {
		if (!this.drag) return;
		const point = this.surface.toLocal(event);
		if (Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 3) this.pointerMoved = true;
		const project = projectState(this.state);
		const mapping = this._mapping(this.surface.width, this.surface.height);
		const chart = mapping.toChart(point);
		if (this.drag.type.startsWith("free-")) {
			this.callbacks.onPreviewFreeTransform?.(this._freeTransformMatrix(this.drag, chart, event));
		} else if (this.drag.type === "event") {
			const allowOutOfBounds = Boolean(project.editor?.allowOutOfBounds);
			const target = allowOutOfBounds ? chart : clampPointToChartBounds(chart);
			const snap = findNearestSnapPoint(target, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale,
				bounds: allowOutOfBounds ? undefined : CHART_BOUNDS });
			this.callbacks.onPreviewPosition?.(this.drag.hit.event.id, snap || target);
		} else if (this.drag.type === "flick") {
			const position = resolveAttachedPosition(this.drag.hit.event, project.snappees) || this.drag.hit.event;
			const angle = Math.round(Math.atan2(chart.y - position.y, chart.x - position.x) / (Math.PI / 4)) * Math.PI / 4;
			this.callbacks.onPreviewFlickAngle?.(this.drag.hit.event.id, angle);
		} else if (this.drag.type === "tip") {
			const settingsEvent = this.drag.hit.settingsEvent || this.drag.hit.event;
			this.callbacks.onPreviewTipSpawn?.(settingsEvent.id, this._tipHandleEditPoint(this.drag.hit, chart, project));
		} else if (this.drag.type === "snappee") {
			const candidates = project.snappees.filter(snappee => snappee.id !== this.drag.hit.snappee.id);
			const snap = findNearestSnapPoint(chart, candidates, { activeOnly: true, maxDistance: 9 / mapping.scale });
			this.callbacks.onPreviewSnappeeHandle?.(this.drag.hit.snappee.id, this.drag.hit.index, snap || chart);
		} else if (this.drag.type === "draft-point") {
			const snap = findNearestSnapPoint(chart, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale });
			this.callbacks.onPreviewCurvePoint?.(this.drag.hit.index, snap || chart);
		} else if (this.drag.type === "pen-new") {
			this.callbacks.onPreviewPenNode?.(this.drag.index, chart);
		} else if (this.drag.type === "draft-pen-handle") {
			this.callbacks.onPreviewPenHandle?.(this.drag.hit.index, this.drag.hit.kind, chart);
		} else if (this.drag.type === "box") {
			if (!this.pointerMoved) return;
			this.selectionBox ||= { x1: this.drag.start.x, y1: this.drag.start.y, x2: point.x, y2: point.y };
			this.selectionBox.x2 = point.x;
			this.selectionBox.y2 = point.y;
			const x1 = Math.min(this.selectionBox.x1, point.x);
			const x2 = Math.max(this.selectionBox.x1, point.x);
			const y1 = Math.min(this.selectionBox.y1, point.y);
			const y2 = Math.max(this.selectionBox.y1, point.y);
			this.callbacks.onPreviewBoxSelect?.(this.visibleEvents.filter(item => item.screen.x >= x1 && item.screen.x <= x2
				&& item.screen.y >= y1 && item.screen.y <= y2).map(item => item.event.id), this.drag.mode);
		}
		this.requestRender();
	}

	_pointerUp(event) {
		if (!this.drag) return;
		const drag = this.drag;
		const point = this.surface.toLocal(event);
		const project = projectState(this.state);
		const mapping = this._mapping(this.surface.width, this.surface.height);
		const chart = mapping.toChart(point);
		if (drag.type.startsWith("free-")) {
			this.callbacks.onPreviewFreeTransform?.(this._freeTransformMatrix(drag, chart, event));
		} else if (drag.type === "event" && this.pointerMoved) {
			const allowOutOfBounds = Boolean(project.editor?.allowOutOfBounds);
			const target = allowOutOfBounds ? chart : clampPointToChartBounds(chart);
			const snap = findNearestSnapPoint(target, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale,
				bounds: allowOutOfBounds ? undefined : CHART_BOUNDS });
			this.callbacks.onMovePosition?.(drag.hit.event.id, snap || target);
		} else if (drag.type === "event" && drag.collapseSelectionOnClick) {
			this.callbacks.onSelectEvents?.([drag.hit.event.id], "replace");
		} else if (drag.type === "flick") {
			const position = resolveAttachedPosition(drag.hit.event, project.snappees) || drag.hit.event;
			this.callbacks.onFlickAngle?.(drag.hit.event.id,
				Math.round(Math.atan2(chart.y - position.y, chart.x - position.x) / (Math.PI / 4)) * Math.PI / 4);
		} else if (drag.type === "tip") {
			const settingsEvent = drag.hit.settingsEvent || drag.hit.event;
			this.callbacks.onTipSpawn?.(settingsEvent.id, this._tipHandleEditPoint(drag.hit, chart, project));
		} else if (drag.type === "snappee") {
			const candidates = project.snappees.filter(snappee => snappee.id !== drag.hit.snappee.id);
			const snap = findNearestSnapPoint(chart, candidates, { activeOnly: true, maxDistance: 9 / mapping.scale });
			this.callbacks.onSnappeeHandle?.(drag.hit.snappee.id, drag.hit.index, snap || chart);
		} else if (drag.type === "draft-point") {
			if (this.pointerMoved) {
				const snap = findNearestSnapPoint(chart, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale });
				this.callbacks.onCurvePointMove?.(drag.hit.index, snap || chart);
			} else this.callbacks.onCurvePointActivate?.(drag.hit.index);
		} else if (drag.type === "pen-new") {
			this.callbacks.onPenNode?.(drag.index, chart, this.pointerMoved);
		} else if (drag.type === "draft-pen-handle") {
			this.callbacks.onPenHandle?.(drag.hit.index, drag.hit.kind, chart);
		} else if (drag.type === "box") {
			if (this.pointerMoved) {
				const x1 = Math.min(drag.start.x, point.x);
				const x2 = Math.max(drag.start.x, point.x);
				const y1 = Math.min(drag.start.y, point.y);
				const y2 = Math.max(drag.start.y, point.y);
				this.callbacks.onBoxSelect?.(this.visibleEvents.filter(item => item.screen.x >= x1 && item.screen.x <= x2
					&& item.screen.y >= y1 && item.screen.y <= y2).map(item => item.event.id), drag.mode);
			} else if (drag.mode === "replace") {
				this.callbacks.onSelectEvents?.([], "replace");
			}
		}
		this.callbacks.onEndPreview?.();
		this.selectionBox = null;
		this.drag = null;
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		this.requestRender();
	}

	_doubleClick(event) {
		const playing = Boolean(this.callbacks.isPlaying?.());
		if (this.callbacks.getCurveDraft?.()) {
			if (playing) return;
			this.callbacks.onCurveDoubleClick?.();
			return;
		}
		if (playing && (this.callbacks.getCreationMode?.() || this.callbacks.getFreeTransform?.())) return;
		const point = this.surface.toLocal(event);
		const mapping = this._mapping(this.surface.width, this.surface.height);
		const chartPoint = mapping.toChart(point);
		const project = projectState(this.state);
		let nearest = null;
		for (const snappee of project.snappees) {
			if (!isSnappeeVisible(snappee)) continue;
			let points;
			try { points = sampleSnappee(snappee); } catch { continue; }
			const distance = Math.min(...points.map(candidate => Math.hypot(candidate.x - chartPoint.x, candidate.y - chartPoint.y)));
			if (!nearest || distance < nearest.distance) nearest = { snappee, distance };
		}
		if (nearest && nearest.distance < 8 / mapping.scale) {
			const ids = this.visibleEvents
				.filter(record => record.event.attached && record.event.snappee === nearest.snappee.id)
				.map(record => record.event.id);
			this.callbacks.onSelectEvents?.(ids,
				event.altKey ? "remove" : event.ctrlKey ? "add" : "replace");
		}
	}

	destroy() {
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		cancelAnimationFrame(this.particleAnimationFrame);
		cancelAnimationFrame(this.renderAnimationFrame);
		cancelAnimationFrame(this.pointerMoveAnimationFrame);
		this.particleAnimationFrame = 0;
		this.renderAnimationFrame = 0;
		this.pointerMoveAnimationFrame = 0;
		this.surface.destroy();
	}
};
