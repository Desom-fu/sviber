import { Rational } from "../core/rational.js";
import { TimingMap } from "../core/timing.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, multiplyTransforms, resolveAttachedPosition, sampleSnappee } from "../core/geometry.js";
import { PixiCanvasSurface } from "./pixi-surface.js";
import { MOVABLE_TYPES, NOTE_TYPES, PATTERN_TYPES, DURATION_TYPES, TIP_POINT_SPAWN_TYPES, TIP_POINT_TRAIL_DURATION, TIP_POINT_ZOOM_DURATION, TIP_POINT_TRAIL_TAIL_DURATION, SUNNIESNOW_AUTOPLAY_GRADIENT, SUNNIESNOW_SKIN, sunniesnowNoteRadius, sunniesnowNoteTextColor, sunniesnowPlayfieldScale, isSnappeeVisible, sunniesnowTapDoubleLinePairs, circularArcDraftSpan, sunniesnowEventVisualState, sunniesnowPatternVisualState, sunniesnowDisplayedPattern, colorIntegerToCss, randomColor, projectState, timingFor, currentSeconds, tipPointSpawnTime, buildTipPointGuides, tipPointDirection, sampleTipPointPath, tipPointPathBetween, tipPointVisualState, directionBetween, adjacentDirection, tipPointTrailEdges, drawTipPointTrail, appendPolygonPath, polygonPath, selectedEvents, pointInPolygon } from "./stage-helpers.js";

export const withStageNotes = Base => class extends Base {
	_drawNoteBody(context, event, screen, scale, visibility, doubleTap = false, preview = false) {
		const radius = sunniesnowNoteRadius(event.type) * scale;
		const selected = Boolean(event.selected);
		let noteScale = visibility.phase === "fadingIn" ? visibility.progress : 1;
		let noteAlpha = Number.isFinite(visibility.alpha) ? visibility.alpha : 1;
		if (event.type === "hold" && visibility.phase === "holding") {
			noteScale = 1.1 - Math.cos(2 * Math.PI * visibility.relativeTime / 0.27) * 0.1;
		} else if (event.type === "hold" && visibility.phase === "fadingOut") {
			noteScale = 1.1 - Math.cos(2 * Math.PI * (visibility.end - visibility.start) / 0.27) * 0.1;
		} else if (event.type === "bgNote" && visibility.phase === "fadingOut") {
			noteScale = 1 + (3 * (visibility.progress - 1 / 3) ** 2 - 1 / 3) * 0.5;
			noteAlpha = 1 - visibility.progress;
		}
		context.save();
		context.translate(screen.x, screen.y);
		context.scale(noteScale, noteScale);
		context.globalAlpha = noteAlpha * (preview ? 0.58 : 1);
		if (event.type === "hold" && visibility.phase !== "fadingOut") {
			const haloRadius = radius * 1.5;
			context.beginPath();
			if (visibility.phase === "holding") {
				const beginning = -Math.PI / 2 + Math.max(0, Math.min(1, visibility.progress)) * Math.PI * 2;
				context.moveTo(0, 0);
				context.lineTo(Math.cos(beginning) * haloRadius, Math.sin(beginning) * haloRadius);
				context.arc(0, 0, haloRadius, beginning, Math.PI * 3 / 2);
				context.closePath();
			} else context.arc(0, 0, haloRadius, 0, Math.PI * 2);
			context.fillStyle = selected ? "rgba(255,46,89,0.72)" : SUNNIESNOW_SKIN.holdHalo;
			context.fill();
		}

		let bodyVisible = true;
		let bodyScale = 1;
		let bodyAlpha = 1;
		if (visibility.phase === "fadingOut" && ["tap", "flick"].includes(event.type)) bodyVisible = false;
		if (event.type === "hold" && visibility.phase === "fadingOut") {
			const progress = visibility.progress * 2;
			if (progress <= 1) {
				bodyScale = 1 + (1 - (1 - progress) ** 2) * 0.5;
				bodyAlpha = (1 - progress) ** 3;
			} else bodyVisible = false;
		}
		if (bodyVisible) {
			context.save();
			context.scale(bodyScale, bodyScale);
			context.globalAlpha *= bodyAlpha;
		if (event.type === "bgNote") {
			context.fillStyle = selected ? "rgba(255,46,89,0.82)" : "rgba(0,0,0,0.7)";
			polygonPath(context, 0, 0, radius, 6, 0);
			context.fill();
		} else if (event.type === "drag") {
			let lineWidth = radius / 20;
			context.strokeStyle = selected ? "#ffd1da" : SUNNIESNOW_SKIN.dragOuterStroke;
			context.lineWidth = lineWidth;
			context.beginPath();
			context.arc(0, 0, radius - lineWidth / 2, 0, Math.PI * 2);
			context.stroke();
			lineWidth = radius / 9;
			context.strokeStyle = selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.dragStroke;
			context.lineWidth = lineWidth;
			const radius2 = radius * 3 / 4;
			const radius1 = radius / 2;
			const unit1 = radius1 / Math.sqrt(2);
			const unit2 = radius2 / Math.sqrt(2);
			context.beginPath();
			context.arc(0, 0, radius2, 0, Math.PI * 2);
			context.moveTo(radius1, 0);
			context.arc(0, 0, radius1, 0, Math.PI * 2);
			context.moveTo(-unit1, unit1);
			context.lineTo(-unit2, unit2);
			context.moveTo(unit1, -unit1);
			context.lineTo(unit2, -unit2);
			context.stroke();
		} else {
			const palette = event.type === "tap"
				? (doubleTap
					? [SUNNIESNOW_SKIN.doubleTapFill, SUNNIESNOW_SKIN.doubleTapStroke]
					: [SUNNIESNOW_SKIN.tapFill, SUNNIESNOW_SKIN.tapStroke])
				: event.type === "hold"
					? [SUNNIESNOW_SKIN.holdFill, SUNNIESNOW_SKIN.holdStroke]
					: [SUNNIESNOW_SKIN.flickFill, SUNNIESNOW_SKIN.flickStroke];
			const lineWidth = radius / 8;
			context.fillStyle = selected ? SUNNIESNOW_SKIN.selectionTint : palette[0];
			context.strokeStyle = selected ? "#ffd1da" : palette[1];
			context.lineWidth = lineWidth;
			context.beginPath();
			context.arc(0, 0, radius - lineWidth / 2, 0, Math.PI * 2);
			context.fill();
			context.stroke();
		}
			context.restore();
		}

		if (event.text) {
			let textScaleX = 1;
			let textScaleY = 1;
			let textAlpha = 1;
			const textColor = sunniesnowNoteTextColor(event, visibility);
			if (visibility.phase === "fadingOut" && event.type !== "bgNote") {
				const progress = visibility.progress;
				textScaleX = progress < 1 / 4 ? 1 + progress * 4
					: progress < 1 / 2 ? 2 - (progress - 1 / 4) * 2
						: 1.5 + (progress - 1 / 2) * 3;
				textScaleY = progress < 0.5 ? 1 + progress * 2
					: progress < 0.6 ? 2 - (progress - 0.5) * 5
						: 1.5 + (progress - 0.6) / 0.4 * 1.5;
				textAlpha = progress >= 0.5 ? 1 - (progress - 0.5) * 2 : 1;
			}
			const baseFontSize = radius;
			context.font = `${baseFontSize}px 'Sviber Note', 'Noto Sans Math', sans-serif`;
			const measured = context.measureText(String(event.text)).width;
			const fontSize = baseFontSize * Math.min(1, radius * 1.5 / Math.max(measured, 1));
			context.save();
			context.scale(textScaleX, textScaleY);
			context.globalAlpha *= textAlpha;
			context.fillStyle = textColor;
			context.font = `${fontSize}px 'Sviber Note', 'Noto Sans Math', sans-serif`;
			context.textAlign = "center";
			context.textBaseline = "middle";
			if (selected) {
				context.strokeStyle = "rgba(0,0,0,0.82)";
				context.lineWidth = Math.max(1, fontSize / 7);
				context.lineJoin = "round";
				context.strokeText(String(event.text), 0, 0);
			}
			context.fillText(String(event.text), 0, 0);
			context.restore();
		}
		if (event.type === "flick") {
			let arrowScale = 1 - 0.05 * Math.cos(visibility.relativeTime * 5);
			let arrowAlpha = visibility.phase === "fadingIn" ? visibility.progress : 1;
			let arrowOffset = 0;
			if (visibility.phase === "fadingOut") {
				const progress = visibility.progress * 2;
				if (progress > 1) arrowAlpha = 0;
				else {
					arrowScale = 1.05;
					arrowAlpha = (1 - progress) ** 3;
					arrowOffset = radius * 2 * (1 - (1 - progress) ** 2);
				}
			}
			if (arrowAlpha > 0) {
				const angle = -(Number(event.angle) || 0);
				context.save();
				context.rotate(angle);
				context.translate(arrowOffset, 0);
				context.scale(arrowScale, arrowScale);
				context.globalAlpha *= arrowAlpha;
				const innerDistance = radius * 1.1;
				const tipDistance = radius * 2;
				context.beginPath();
				context.arc(0, 0, innerDistance, -Math.PI / 4, Math.PI / 4);
				context.lineTo(tipDistance, 0);
				context.closePath();
				context.fillStyle = selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.flickArrow;
				context.fill();
				context.beginPath();
				context.moveTo(tipDistance, 0);
				context.lineTo(innerDistance / Math.sqrt(2), innerDistance / Math.sqrt(2));
				context.lineTo((innerDistance + tipDistance) / 2, 0);
				context.lineTo(innerDistance / Math.sqrt(2), -innerDistance / Math.sqrt(2));
				context.closePath();
				context.fillStyle = selected ? "#ffd1da" : SUNNIESNOW_SKIN.flickArrowHighlight;
				context.fill();
				context.restore();
			}
		}
		context.restore();
	}

	_drawApproachCircle(context, event, screen, scale, visibility) {
		let circleScale;
		let alpha;
		if (visibility.phase === "fadingIn") {
			circleScale = 1 - (visibility.progress - 1) ** 2;
			alpha = visibility.progress / 3;
		} else if (visibility.phase === "active" && visibility.progress < 1) {
			const targetScale = 1 / 4;
			circleScale = 1 - (1 - targetScale) * visibility.progress;
			alpha = 1 / 3 + 2 / 3 * visibility.progress;
		} else return;
		const radius = sunniesnowNoteRadius(event.type) * 4 * scale * circleScale;
		const lineWidth = sunniesnowNoteRadius(event.type) * scale / 4 * circleScale;
		if (!(radius > 0 && lineWidth > 0)) return;
		context.save();
		context.globalAlpha = alpha;
		context.strokeStyle = event.selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.approachCircle;
		context.lineWidth = lineWidth;
		context.beginPath();
		context.arc(screen.x, screen.y, Math.max(0, radius - lineWidth / 2), 0, Math.PI * 2);
		context.stroke();
		context.restore();
	}

	_drawCreationEchoes(context, project, mapping, now) {
		if (!this.callbacks.getCreationMode?.()) return;
		const speed = Number(this.state?.preferences?.noteSpeed) > 0
			? Number(this.state.preferences.noteSpeed) : SUNNIESNOW_SKIN.approachSpeed;
		const records = this.renderIndex?.creationEchoRecords(now)
			|| project.events.filter(event => MOVABLE_TYPES.has(event.type)).map(event => ({
				event,
				end: this._eventTimes(event).end,
				position: resolveAttachedPosition(event, project.snappees) || event,
			}));
		for (const record of records) {
			const elapsed = now - record.end;
			if (elapsed <= 0 || elapsed > 1 / speed) continue;
			const position = record.position || this.renderIndex?.positionFor(record.event)
				|| resolveAttachedPosition(record.event, project.snappees) || record.event;
			const screen = mapping.toScreen(position);
			const radius = sunniesnowNoteRadius(record.event.type) * mapping.scale;
			context.save();
			context.globalAlpha = (1 - elapsed * speed) * 0.48;
			context.strokeStyle = "#ffffff";
			context.lineWidth = Math.max(1, radius / 10);
			if (record.event.type === "bgNote") polygonPath(context, screen.x, screen.y, radius, 6, 0);
			else {
				context.beginPath();
				context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
			}
			context.stroke();
			context.restore();
		}
	}

	_drawSelectedInvisible(context, project, mapping, now) {
		const displayedPattern = (this.renderIndex
			? this.renderIndex.displayedPattern(now)
			: sunniesnowDisplayedPattern(project.events, this.timing, now))?.event;
		const selected = this.renderIndex?.stageSelectedEvents || project.events.filter(event => event.selected);
		for (const event of selected) {
			if (MOVABLE_TYPES.has(event.type)) {
				if (this._noteVisibility(event, now)) continue;
				const position = this.renderIndex?.positionFor(event)
					|| resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
				const screen = mapping.toScreen(position);
				const radius = sunniesnowNoteRadius(event.type) * mapping.scale;
				context.save();
				context.strokeStyle = SUNNIESNOW_SKIN.selectionTint;
				context.lineWidth = 2;
				context.globalAlpha = 0.72;
				context.setLineDash([4, 3]);
				if (event.type === "bgNote") polygonPath(context, screen.x, screen.y, radius, 6, 0);
				else {
					context.beginPath();
					context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
				}
				context.stroke();
				if (event.text) this._drawSelectedInvisibleText(context, event, screen, radius);
				context.restore();
			} else if (PATTERN_TYPES.has(event.type) && event !== displayedPattern) {
				const center = mapping.toScreen({ x: 0, y: 0 });
				context.save();
				context.strokeStyle = SUNNIESNOW_SKIN.selectionTint;
				context.lineWidth = 2;
				context.globalAlpha = 0.72;
				context.setLineDash([5, 3]);
				context.strokeRect(center.x - 10, center.y - 10, 20, 20);
				context.restore();
			}
		}
	}

	_drawSelectedInvisibleText(context, event, screen, radius) {
		const text = String(event.text || "");
		if (!text) return;
		const baseFontSize = radius;
		context.font = `${baseFontSize}px 'Sviber Note', 'Noto Sans Math', sans-serif`;
		const measured = context.measureText(text).width;
		const fontSize = baseFontSize * Math.min(1, radius * 1.5 / Math.max(measured, 1));
		context.save();
		context.setLineDash([]);
		context.globalAlpha = 1;
		context.font = `${fontSize}px 'Sviber Note', 'Noto Sans Math', sans-serif`;
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.strokeStyle = "rgba(0,0,0,0.82)";
		context.lineWidth = Math.max(1, fontSize / 7);
		context.lineJoin = "round";
		context.strokeText(text, screen.x, screen.y);
		context.fillStyle = sunniesnowNoteTextColor(event, { phase: "active" });
		context.fillText(text, screen.x, screen.y);
		context.restore();
	}

	_drawSelectionHandles(context, project, mapping) {
		if (this.callbacks.getFreeTransform?.()) return;
		const selected = [...(this.renderIndex?.stageSelectedEvents || selectedEvents(project))]
			.filter(event => MOVABLE_TYPES.has(event.type));
		if (selected.length !== 1) return;
		const event = selected[0];
		const position = this.renderIndex?.positionFor(event)
			|| resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
		const screen = mapping.toScreen(position);
		if (event.type === "flick") {
			const angle = Number(event.angle) || 0;
			const visibility = this._noteVisibility(event, currentSeconds(this.state, this.timing));
			const pulse = visibility && visibility.phase !== "fadingOut"
				? 1 - 0.05 * Math.cos(visibility.relativeTime * 5)
				: 1;
			const distance = sunniesnowNoteRadius("flick") * 2 * pulse * mapping.scale;
			const handle = { x: screen.x + Math.cos(angle) * distance, y: screen.y - Math.sin(angle) * distance };
			this._drawDiamond(context, handle.x, handle.y, 6);
			this.hitRegions.push({ type: "flick-handle", event, x: handle.x - 10, y: handle.y - 10, width: 20, height: 20 });
		}
		const tipGuide = NOTE_TYPES.has(event.type)
			? (this.renderIndex?.tipGuides || buildTipPointGuides(project, this.timing)).find(guide => guide.events[0] === event
				&& (guide.mode === "drop" || guide.spawnSettings === event))
			: null;
		if (tipGuide) {
			const spawn = this._tipSpawnPosition(tipGuide.spawnSettings, position, project);
			if (spawn) {
				const handle = mapping.toScreen(spawn);
				context.strokeStyle = "rgba(255,255,255,0.72)";
				context.lineWidth = 2;
				context.beginPath();
				context.moveTo(handle.x, handle.y);
				context.lineTo(screen.x, screen.y);
				context.stroke();
				this._drawDiamond(context, handle.x, handle.y, 6);
				this.hitRegions.push({
					type: "tip-handle",
					event,
					settingsEvent: tipGuide.spawnSettings,
					x: handle.x - 10,
					y: handle.y - 10,
					width: 20,
					height: 20,
				});
			}
		}
	}

	_freeTransformGeometry(mapping) {
		const descriptor = this.callbacks.getFreeTransform?.();
		if (!descriptor?.bounds || !Array.isArray(descriptor.matrix)) return null;
		const { minX, maxX, minY, maxY } = descriptor.bounds;
		const original = [
			{ x: minX, y: maxY }, { x: maxX, y: maxY },
			{ x: maxX, y: minY }, { x: minX, y: minY },
		];
		const chart = original.map(point => applyTransform(point, descriptor.matrix));
		const screen = chart.map(mapping.toScreen);
		const centerChart = applyTransform({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, descriptor.matrix);
		const topChart = applyTransform({ x: (minX + maxX) / 2, y: maxY }, descriptor.matrix);
		const center = mapping.toScreen(centerChart);
		const top = mapping.toScreen(topChart);
		const length = Math.hypot(top.x - center.x, top.y - center.y) || 1;
		const rotate = {
			x: top.x + (top.x - center.x) / length * 28,
			y: top.y + (top.y - center.y) / length * 28,
		};
		return { descriptor, original, chart, screen, centerChart, center, top, rotate };
	}

	_drawFreeTransform(context, mapping) {
		const geometry = this._freeTransformGeometry(mapping);
		if (!geometry) return;
		context.save();
		context.strokeStyle = "#72adff";
		context.fillStyle = "#f7f8f9";
		context.lineWidth = 1.5;
		context.setLineDash([5, 3]);
		context.beginPath();
		geometry.screen.forEach((point, index) => {
			if (!index) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
		});
		context.closePath();
		context.stroke();
		context.setLineDash([]);
		context.beginPath();
		context.moveTo(geometry.top.x, geometry.top.y);
		context.lineTo(geometry.rotate.x, geometry.rotate.y);
		context.stroke();
		context.beginPath();
		context.arc(geometry.rotate.x, geometry.rotate.y, 5, 0, Math.PI * 2);
		context.fill();
		context.stroke();
		this.hitRegions.push({ type: "free-move", polygon: geometry.screen });
		this.hitRegions.push({ type: "free-rotate", x: geometry.rotate.x - 10, y: geometry.rotate.y - 10, width: 20, height: 20 });
		geometry.screen.forEach((point, index) => {
			context.fillRect(point.x - 5, point.y - 5, 10, 10);
			context.strokeRect(point.x - 5, point.y - 5, 10, 10);
			this.hitRegions.push({ type: "free-scale", index, x: point.x - 10, y: point.y - 10, width: 20, height: 20 });
		});
		context.restore();
	}

	_drawDiamond(context, x, y, size) {
		context.save();
		context.translate(x, y);
		context.rotate(Math.PI / 4);
		context.fillStyle = "#f8f9fa";
		context.strokeStyle = "#15171a";
		context.lineWidth = 1;
		context.fillRect(-size / 2, -size / 2, size, size);
		context.strokeRect(-size / 2, -size / 2, size, size);
		context.restore();
	}

	_tipSpawnPosition(event, eventPosition, project) {
		if (event.tipPointSpawnAbsolutePosition) {
			const attached = this.renderIndex?.tipSpawnPositionFor(event)
				|| resolveAttachedPosition(event, project.snappees, { prefix: "tipPointSpawn" });
			if (attached) return attached;
			const x = Number(event.tipPointSpawnX);
			const y = Number(event.tipPointSpawnY);
			return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 100 };
		}
		const providedDistance = Number(event.tipPointSpawnDistance ?? 100);
		const providedAngle = Number(event.tipPointSpawnAngle ?? Math.PI / 2);
		const distance = Math.max(0, Number.isFinite(providedDistance) ? providedDistance : 100);
		const angle = Number.isFinite(providedAngle) ? providedAngle : Math.PI / 2;
		return {
			x: eventPosition.x + Math.cos(angle) * distance,
			y: eventPosition.y + Math.sin(angle) * distance,
		};
	}

	_tipHandleEditPoint(hit, point, project) {
		const settingsEvent = hit.settingsEvent || hit.event;
		if (settingsEvent === hit.event || settingsEvent.tipPointSpawnAbsolutePosition) return point;
		const target = this.renderIndex?.positionFor(hit.event)
			|| resolveAttachedPosition(hit.event, project.snappees) || hit.event;
		const source = this.renderIndex?.positionFor(settingsEvent)
			|| resolveAttachedPosition(settingsEvent, project.snappees) || settingsEvent;
		return {
			x: (Number(source.x) || 0) + point.x - (Number(target.x) || 0),
			y: (Number(source.y) || 0) + point.y - (Number(target.y) || 0),
		};
	}

	_drawTipPointMarker(context, point, radius, scale) {
		if (!point || scale <= 0) return;
		context.save();
		context.translate(point.x, point.y);
		context.rotate(Number.isFinite(point.angle) ? point.angle : -Math.PI / 2);
		context.scale(scale, scale);
		context.fillStyle = "#000000";
		context.beginPath();
		context.arc(0, 0, radius, 0, Math.PI * 2);
		context.fill();
		const unit = radius / Math.sqrt(2);
		context.beginPath();
		context.moveTo(unit, unit);
		context.lineTo(unit * 2, 0);
		context.lineTo(unit, -unit);
		context.closePath();
		context.fill();
		context.beginPath();
		context.arc(0, 0, unit, 0, Math.PI * 2);
		context.strokeStyle = "#ffff00";
		context.lineWidth = radius / 10;
		context.stroke();
		context.restore();
	}

	_drawTipPoints(context, project, mapping, now) {
		const guides = this.renderIndex?.activeTipGuides(now) || buildTipPointGuides(project, this.timing);
		for (const guide of guides) {
			const checkpoints = this._tipPointCheckpoints(guide, project, mapping);
			const visual = tipPointVisualState(checkpoints, now);
			if (!visual) continue;
			context.save();
			const markerRadius = SUNNIESNOW_SKIN.noteRadius / 3 * mapping.scale;
			const trailWidth = markerRadius * 2 / 1.5;
			drawTipPointTrail(context, visual.trail, trailWidth, visual.scale, visual.alpha);
			this._drawTipPointMarker(context, visual.head, markerRadius, visual.scale);
			context.restore();
		}
	}

	_tipPointCheckpoints(guide, project, mapping) {
		const signature = `${mapping.originX}:${mapping.originY}:${mapping.scale}`;
		if (this.tipPointScreenCache?.index !== this.renderIndex
			|| this.tipPointScreenCache.signature !== signature) {
			this.tipPointScreenCache = { index: this.renderIndex, signature, guides: new WeakMap() };
		}
		const cached = this.tipPointScreenCache.guides.get(guide);
		if (cached) return cached;
		const firstPosition = this.renderIndex?.positionFor(guide.events[0])
			|| resolveAttachedPosition(guide.events[0], project.snappees) || guide.events[0];
		const spawn = this._tipSpawnPosition(guide.spawnSettings, firstPosition, project);
		const checkpoints = [{ ...mapping.toScreen(spawn), time: guide.spawnTime }];
		for (let index = 0; index < guide.events.length; index += 1) {
			const event = guide.events[index];
			const position = this.renderIndex?.positionFor(event)
				|| resolveAttachedPosition(event, project.snappees) || event;
			checkpoints.push({ ...mapping.toScreen(position), time: guide.eventTimes[index] });
		}
		this.tipPointScreenCache.guides.set(guide, checkpoints);
		return checkpoints;
	}

	_drawCreationPreview(context, project, mapping) {
		const type = this.callbacks.getCreationMode?.();
		if (!type || !this.creationPreview || !MOVABLE_TYPES.has(type)) return;
		const event = { type, text: "", angle: this.callbacks.getDefaultFlickAngle?.() ?? Math.PI / 2 };
		const screen = mapping.toScreen(this.creationPreview);
		this._drawNoteBody(context, event, screen, mapping.scale, {
			phase: "active", progress: 1, alpha: 1, relativeTime: 0, start: 0, end: 0,
		}, false, true);
		if (this.creationPreview.snappee) {
			context.strokeStyle = this.creationPreview.snappee.color || "#56db79";
			context.lineWidth = 2;
			context.beginPath();
			context.arc(screen.x, screen.y, 17 * mapping.scale, 0, Math.PI * 2);
			context.stroke();
		}
	}

	_drawCurveDraft(context, mapping) {
		const draft = this.callbacks.getCurveDraft?.();
		if (!draft?.points?.length) return;
		const previewPoints = this.curvePreview ? [...draft.points, this.curvePreview] : draft.points;
		context.save();
		context.strokeStyle = draft.color || "#53baf0";
		context.fillStyle = "#f6f8f9";
		context.lineWidth = 1.5;
		if (draft.type === "circularArcCurve" && draft.points.length === 1 && this.curvePreview) {
			context.globalAlpha = 0.4;
		}
		context.beginPath();
		if (draft.type === "penCurve" && draft.penNodes?.length) {
			const nodes = draft.penNodes;
			const first = mapping.toScreen(nodes[0]);
			context.moveTo(first.x, first.y);
			for (let index = 1; index < nodes.length; index += 1) {
				const previous = nodes[index - 1];
				const current = nodes[index];
				const end = mapping.toScreen(current);
				if (previous.outgoing || current.incoming) {
					const control1 = mapping.toScreen(previous.outgoing || previous);
					const control2 = mapping.toScreen(current.incoming || current);
					context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
				} else context.lineTo(end.x, end.y);
			}
			if (draft.closed && nodes.length > 1) {
				const previous = nodes.at(-1);
				const current = nodes[0];
				if (previous.outgoing || current.incoming) {
					const control1 = mapping.toScreen(previous.outgoing || previous);
					const control2 = mapping.toScreen(current.incoming || current);
					context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, first.x, first.y);
				} else context.lineTo(first.x, first.y);
			} else if (this.curvePreview) {
				const previous = nodes.at(-1);
				const end = mapping.toScreen(this.curvePreview);
				if (previous.outgoing) {
					const control = mapping.toScreen(previous.outgoing);
					context.bezierCurveTo(control.x, control.y, end.x, end.y, end.x, end.y);
				} else context.lineTo(end.x, end.y);
			}
		} else if (draft.type === "bezierCurve" && previewPoints.length > 1) {
			const evaluate = progress => {
				const points = previewPoints.map(point => ({ ...point }));
				for (let level = points.length - 1; level > 0; level -= 1) {
					for (let index = 0; index < level; index += 1) {
						points[index].x += (points[index + 1].x - points[index].x) * progress;
						points[index].y += (points[index + 1].y - points[index].y) * progress;
					}
				}
				return points[0];
			};
			for (let step = 0; step <= 96; step += 1) {
				const screen = mapping.toScreen(evaluate(step / 96));
				if (!step) context.moveTo(screen.x, screen.y); else context.lineTo(screen.x, screen.y);
			}
		} else if (draft.type === "circularArcCurve" && previewPoints.length >= 2) {
			const [center, beginning, ending] = previewPoints;
			const radius = Math.hypot(beginning.x - center.x, beginning.y - center.y);
			const start = Math.atan2(beginning.y - center.y, beginning.x - center.x);
			const end = ending ? Math.atan2(ending.y - center.y, ending.x - center.x) : start + Math.PI * 2;
			const span = circularArcDraftSpan(start, end);
			for (let step = 0; step <= 96; step += 1) {
				const angle = start + span * step / 96;
				const screen = mapping.toScreen({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
				if (!step) context.moveTo(screen.x, screen.y); else context.lineTo(screen.x, screen.y);
			}
		} else {
			previewPoints.forEach((point, index) => {
				const screen = mapping.toScreen(point);
				if (!index) context.moveTo(screen.x, screen.y); else context.lineTo(screen.x, screen.y);
			});
		}
		context.stroke();
		if (draft.type === "penCurve") {
			for (let index = 0; index < (draft.penNodes || []).length; index += 1) {
				const node = draft.penNodes[index];
				const anchor = mapping.toScreen(node);
				for (const kind of ["incoming", "outgoing"]) {
					if (!node[kind]) continue;
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
					this.hitRegions.push({ type: "draft-pen-handle", index, kind,
						x: handle.x - 7, y: handle.y - 7, width: 14, height: 14 });
				}
			}
		}
		for (let index = 0; index < draft.points.length; index += 1) {
			const point = draft.points[index];
			const screen = mapping.toScreen(point);
			context.fillRect(screen.x - 4, screen.y - 4, 8, 8);
			this.hitRegions.push({ type: "draft-point", index, x: screen.x - 8, y: screen.y - 8, width: 16, height: 16 });
		}
		context.restore();
	}

	_drawParticles(context, mapping) {
		const now = performance.now();
		this.particles = this.particles.filter(particle => now - particle.started < 190);
		for (const particle of this.particles) {
			const elapsed = now - particle.started;
			if (elapsed < 0) continue;
			const frames = elapsed / (1000 / 60);
			const alpha = Math.max(0, 1 - frames * 0.1);
			if (!(alpha > 0)) continue;
			const screen = mapping.toScreen(particle);
			const radius = particle.radius * mapping.scale;
			context.save();
			context.globalAlpha = alpha;
			for (const spark of particle.sparks) {
				const distance = frames * radius / 2;
				context.strokeStyle = spark.color;
				context.lineWidth = radius / 20;
				context.beginPath();
				context.moveTo(screen.x + Math.cos(spark.angle) * distance, screen.y + Math.sin(spark.angle) * distance);
				context.lineTo(screen.x + Math.cos(spark.angle) * (distance + radius * 2),
					screen.y + Math.sin(spark.angle) * (distance + radius * 2));
				context.stroke();
			}
			for (const contour of particle.contours) {
				const contourScale = 1 + frames * 0.2;
				context.save();
				context.translate(screen.x, screen.y);
				context.rotate(contour.angle);
				context.strokeStyle = contour.color;
				context.lineWidth = radius / 10 * contourScale;
				context.beginPath();
				context.arc(0, 0, radius * 1.5 * contourScale, -Math.PI / 6, Math.PI / 6);
				context.stroke();
				context.restore();
			}
			context.restore();
		}
	}

};
