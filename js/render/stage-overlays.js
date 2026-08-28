import { descendants } from "../core/grouping.js";
import { CHART_BOUNDS, applyTransform, resolveAttachedPosition } from "../core/geometry.js";
import {
	MOVABLE_TYPES,
	NOTE_TYPES,
	SUNNIESNOW_SKIN,
	sunniesnowNoteRadius,
	currentSeconds,
	buildTipPointGuides,
	tipPointVisualState,
	drawTipPointTrail,
	selectedEvents,
} from "./stage-helpers.js";

// Editing overlays painted on top of the note layer: selection handles, the free
// transform gizmo, tip point markers and checkpoints, grouping outlines, snappee attach
// rings and the rulers. None of them belong to the Sunniesnow playfield itself, they only
// exist to make editing legible, which is why they live apart from stage-notes.js.

function niceRulerStep(raw) {
	const exponent = Math.floor(Math.log10(Math.max(1e-6, raw)));
	const fraction = raw / 10 ** exponent;
	const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
	return nice * 10 ** exponent;
}

function formatRulerValue(value) {
	const text = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(Math.abs(value) >= 10 ? 0 : 1);
	return text.replace(/\.0$/, "");
}

export class StageOverlaysTrait {

	_drawSelectionHandles(context, project, mapping) {
		if (this.callbacks.getFreeTransform?.()) {
			return;
		}
		const selected = [...(this.renderIndex?.stageSelectedEvents || selectedEvents(project))].filter(event =>
			MOVABLE_TYPES.has(event.type),
		);
		const selectedFlicks = selected.filter(event => event.selected && event.type === "flick");
		for (const event of selectedFlicks) {
			const position = this.renderIndex?.positionFor(event) ||
				resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
			const screen = mapping.toScreen(position);
			const angle = Number(event.angle) || 0;
			const visibility = this._noteVisibility(event, currentSeconds(this.state, this.timing));
			const pulse =
				visibility && visibility.phase !== "fadingOut"? 1 - 0.05 * Math.cos(visibility.relativeTime * 5): 1;
			const distance = sunniesnowNoteRadius("flick") * 2 * pulse * mapping.scale;
			const handle = { x: screen.x + Math.cos(angle) * distance, y: screen.y - Math.sin(angle) * distance };
			this._drawDiamond(context, handle.x, handle.y, 6);
			this.hitRegions.push({
				type: "flick-handle",
				event,
				x: handle.x - 10,
				y: handle.y - 10,
				width: 20,
				height: 20,
			});
		}
		if (selected.length !== 1) {
			return;
		}
		const event = selected[0];
		if (!event.selected) {
			return;
		}
		const position = this.renderIndex?.positionFor(event) ||
			resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
		const screen = mapping.toScreen(position);
		const tipGuide = this._dropTipGuideFor(event, project);
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

	// The drop-in guide of a note: the tip point guide that begins at this very note,
	// either because the note heads the guide or because it carries the spawn settings.
	_dropTipGuideFor(event, project) {
		if (!NOTE_TYPES.has(event.type)) {
			return null;
		}
		const guides = this.renderIndex?.tipGuides || buildTipPointGuides(project, this.timing);
		return guides.find(
			guide => guide.events[0] === event && (guide.mode === "drop" || guide.spawnSettings === event),
		);
	}

	_freeTransformGeometry(mapping) {
		const descriptor = this.callbacks.getFreeTransform?.();
		if (!descriptor?.bounds || !Array.isArray(descriptor.matrix)) {
			return null;
		}
		const { minX, maxX, minY, maxY } = descriptor.bounds;
		const original = [
			{ x: minX, y: maxY },
			{ x: maxX, y: maxY },
			{ x: maxX, y: minY },
			{ x: minX, y: minY },
		];
		const chart = original.map(point => applyTransform(point, descriptor.matrix));
		const screen = chart.map(mapping.toScreen);
		const edges = [
			{ x: (minX + maxX) / 2, y: maxY },
			{ x: maxX, y: (minY + maxY) / 2 },
			{ x: (minX + maxX) / 2, y: minY },
			{ x: minX, y: (minY + maxY) / 2 },
		].map(point => applyTransform(point, descriptor.matrix));
		const edgeScreen = edges.map(mapping.toScreen);
		let centerChart = descriptor.anchor;
		if (descriptor.anchorFollows) {
			centerChart = applyTransform(descriptor.anchorLocal, descriptor.matrix);
		}
		const topChart = applyTransform({ x: (minX + maxX) / 2, y: maxY }, descriptor.matrix);
		const center = mapping.toScreen(centerChart);
		const top = mapping.toScreen(topChart);
		const length = Math.hypot(top.x - center.x, top.y - center.y) || 1;
		const rotate = {
			x: top.x + ((top.x - center.x) / length) * 28,
			y: top.y + ((top.y - center.y) / length) * 28,
		};
		const anchor = mapping.toScreen(centerChart);
		// v17: a degenerate bounding-box dimension has no scale handles. Edge handles 0
		// and 2 scale vertically, 1 and 3 horizontally, and corners scale in both.
		const degenerate = descriptor.degenerate || { x: false, y: false };
		const allowCorners = !degenerate.x && !degenerate.y;
		const allowedEdges = [!degenerate.y, !degenerate.x, !degenerate.y, !degenerate.x];
		return {
			descriptor,
			original,
			chart,
			screen,
			edges,
			edgeScreen,
			centerChart,
			center: anchor,
			top,
			rotate,
			allowCorners,
			allowedEdges,
		};
	}

	_drawFreeTransform(context, mapping) {
		const geometry = this._freeTransformGeometry(mapping);
		if (!geometry) {
			return;
		}
		context.save();
		context.strokeStyle = "#72adff";
		context.fillStyle = "#f7f8f9";
		context.lineWidth = 1.5;
		context.setLineDash([5, 3]);
		context.beginPath();
		geometry.screen.forEach((point, index) => {
			if (!index) {
				context.moveTo(point.x, point.y);
			} else {
				context.lineTo(point.x, point.y);
			}
		});
		context.closePath();
		context.stroke();
		geometry.edgeScreen.forEach((point, index) => {
			if (!geometry.allowedEdges[index]) {
				return;
			}
			context.fillRect(point.x - 4, point.y - 4, 8, 8);
			context.strokeRect(point.x - 4, point.y - 4, 8, 8);
		});
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
		context.beginPath();
		context.arc(geometry.center.x, geometry.center.y, 7, 0, Math.PI * 2);
		context.moveTo(geometry.center.x - 10, geometry.center.y);
		context.lineTo(geometry.center.x + 10, geometry.center.y);
		context.moveTo(geometry.center.x, geometry.center.y - 10);
		context.lineTo(geometry.center.x, geometry.center.y + 10);
		context.stroke();
		this.hitRegions.push({
			type: "free-anchor",
			x: geometry.center.x - 12,
			y: geometry.center.y - 12,
			width: 24,
			height: 24,
		});
		this.hitRegions.push({
			type: "free-rotate",
			x: geometry.rotate.x - 10,
			y: geometry.rotate.y - 10,
			width: 20,
			height: 20,
		});
		geometry.edgeScreen.forEach((point, index) => {
			if (!geometry.allowedEdges[index]) {
				return;
			}
			this.hitRegions.push({
				type: "free-scale-edge",
				index,
				x: point.x - 10,
				y: point.y - 10,
				width: 20,
				height: 20,
			});
		});
		geometry.screen.forEach((point, index) => {
			if (!geometry.allowCorners) {
				return;
			}
			context.fillRect(point.x - 5, point.y - 5, 10, 10);
			context.strokeRect(point.x - 5, point.y - 5, 10, 10);
			this.hitRegions.push({
				type: "free-scale",
				index,
				x: point.x - 10,
				y: point.y - 10,
				width: 20,
				height: 20,
			});
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
			const attached =
				this.renderIndex?.tipSpawnPositionFor(event) ||
				resolveAttachedPosition(event, project.snappees, { prefix: "tipPointSpawn" });
			if (attached) {
				return attached;
			}
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
		if (settingsEvent === hit.event || settingsEvent.tipPointSpawnAbsolutePosition) {
			return point;
		}
		const target =
			this.renderIndex?.positionFor(hit.event) ||
			resolveAttachedPosition(hit.event, project.snappees) ||
			hit.event;
		const source =
			this.renderIndex?.positionFor(settingsEvent) ||
			resolveAttachedPosition(settingsEvent, project.snappees) ||
			settingsEvent;
		return {
			x: (Number(source.x) || 0) + point.x - (Number(target.x) || 0),
			y: (Number(source.y) || 0) + point.y - (Number(target.y) || 0),
		};
	}

	_drawTipPointMarker(context, point, radius, scale) {
		if (!point || scale <= 0) {
			return;
		}
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
		if (project.editor?.showTipPoints === false) {
			return;
		}
		const guides = this.renderIndex?.activeTipGuides(now) || buildTipPointGuides(project, this.timing);
		for (const guide of guides) {
			const checkpoints = this._tipPointCheckpoints(guide, project, mapping);
			const visual = tipPointVisualState(checkpoints, now);
			if (!visual) {
				continue;
			}
			context.save();
			const markerRadius = (SUNNIESNOW_SKIN.noteRadius / 3) * mapping.scale;
			const trailWidth = (markerRadius * 2) / 1.5;
			drawTipPointTrail(context, visual.trail, trailWidth, visual.scale, visual.alpha);
			this._drawTipPointMarker(context, visual.head, markerRadius, visual.scale);
			context.restore();
		}
	}

	_drawGrouping(context, project, mapping, now) {
		if (!this.renderIndex) {
			return;
		}
		// Grouping rings around notes follow the main-field toggle. Selected group anchors
		// (and their bounds) stay visible whenever a group is selected, so the handle can
		// still be dragged with the rings turned off.
		if (project.editor?.showGroupingInMainField !== false) {
			this._drawGroupingRings(context, mapping, now);
		}
		this._drawSelectedGroupAnchors(context, mapping);
	}

	_drawGroupingRings(context, mapping, now) {
		const visibleRecords = this.renderIndex
			.visibleMovableRecords(now)
			.filter(record => record.event.type !== "group")
			.concat(this.renderIndex.selectedRecords.filter(record => record.event.type !== "group"));
		const seen = new Set();
		for (const record of visibleRecords) {
			const event = record.event;
			if (seen.has(event.id)) {
				continue;
			}
			seen.add(event.id);
			if (event.type === "group") {
				continue;
			}
			const ancestors = this.renderIndex.ancestorsById.get(event.id) || [];
			if (!ancestors.length || !this.renderIndex.activeChannelIds.has(event.channel)) {
				continue;
			}
			const position = this.renderIndex.positionFor(event) || event;
			const screen = mapping.toScreen(position);
			const noteRadius = sunniesnowNoteRadius(event.type);
			ancestors
				.slice()
				.reverse()
				.forEach((group, index) => {
					context.save();
					context.globalAlpha = 0.84;
					context.strokeStyle = group.color || "#ff9d3d";
					context.lineWidth = 1.5;
					context.beginPath();
					context.arc(screen.x, screen.y, (noteRadius + 6 + index * 4) * mapping.scale, 0, Math.PI * 2);
					context.stroke();
					context.restore();
				});
		}
	}

	_drawSelectedGroupAnchors(context, mapping) {
		for (const record of (this.renderIndex.groupRecords || []).filter(record => record.event.selected)) {
			const group = record.event;
			if (!this.renderIndex.isEventActive(group)) {
				continue;
			}
			const position = this.renderIndex.positionFor(group) || group;
			const screen = mapping.toScreen(position);
			context.save();
			context.strokeStyle = group.color || "#ff9d3d";
			context.fillStyle = this.renderIndex.isEventSelected(group) ? "#ff3158" : "#f7f8f9";
			context.lineWidth = 1.5;
			context.beginPath();
			context.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
			context.moveTo(screen.x - 9, screen.y);
			context.lineTo(screen.x + 9, screen.y);
			context.moveTo(screen.x, screen.y - 9);
			context.lineTo(screen.x, screen.y + 9);
			context.stroke();
			context.fill();
			this.hitRegions.push({
				type: "event",
				event: group,
				position,
				x: screen.x - 10,
				y: screen.y - 10,
				width: 20,
				height: 20,
				centerX: screen.x,
				centerY: screen.y,
				radius: 10,
			});
			if (group.selected) {
				this.hitRegions.push({
					type: "group-anchor",
					event: group,
					position,
					x: screen.x - 8,
					y: screen.y - 8,
					width: 16,
					height: 16,
					centerX: screen.x,
					centerY: screen.y,
					radius: 8,
				});
			}
			const bounds = this._groupBounds(group);
			if (bounds && this.renderIndex.isRootSelectedGroup(group)) {
				context.setLineDash([5, 3]);
				context.strokeStyle = group.color || "#ff9d3d";
				context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
			}
			context.restore();
		}
	}

	_groupBounds(group) {
		const points = descendants(group)
			.filter(event => event.type !== "group")
			.map(event => this.renderIndex.positionFor(event))
			.filter(Boolean);
		if (!points.length) {
			return null;
		}
		const xs = points.map(point => point.x);
		const ys = points.map(point => point.y);
		const padding = 18;
		const topLeft = this._mapping(this.surface.width, this.surface.height).toScreen({
			x: Math.min(...xs),
			y: Math.max(...ys),
		});
		const bottomRight = this._mapping(this.surface.width, this.surface.height).toScreen({
			x: Math.max(...xs),
			y: Math.min(...ys),
		});
		return {
			x: topLeft.x - padding,
			y: topLeft.y - padding,
			width: bottomRight.x - topLeft.x + padding * 2,
			height: bottomRight.y - topLeft.y + padding * 2,
		};
	}

	_tipPointCheckpoints(guide, project, mapping) {
		const revision = this.renderIndex?.timelineTipRevision ?? 0;
		const signature = `${mapping.originX}:${mapping.originY}:${mapping.scale}:${revision}`;
		if (
			this.tipPointScreenCache?.index !== this.renderIndex ||
			this.tipPointScreenCache.signature !== signature
		) {
			this.tipPointScreenCache = { index: this.renderIndex, signature, guides: new WeakMap() };
		}
		const cached = this.tipPointScreenCache.guides.get(guide);
		if (cached) {
			return cached;
		}
		const firstPosition =
			this.renderIndex?.positionFor(guide.events[0]) ||
			resolveAttachedPosition(guide.events[0], project.snappees) ||
			guide.events[0];
		const spawn = this._tipSpawnPosition(guide.spawnSettings, firstPosition, project);
		const checkpoints = [{ ...mapping.toScreen(spawn), time: guide.spawnTime }];
		for (let index = 0; index < guide.events.length; index += 1) {
			const event = guide.events[index];
			const position =
				this.renderIndex?.positionFor(event) || resolveAttachedPosition(event, project.snappees) || event;
			checkpoints.push({ ...mapping.toScreen(position), time: guide.eventTimes[index] });
		}
		this.tipPointScreenCache.guides.set(guide, checkpoints);
		return checkpoints;
	}

	_drawSnappeeAttachRings(context, project, mapping, now) {
		const selectedSnappee = project.snappees?.find(snappee => snappee.selected && snappee.active !== false);
		if (!selectedSnappee || !this.renderIndex) {
			return;
		}
		const records = this.renderIndex
			.visibleMovableRecords(now)
			.filter(record => record.event.type !== "group")
			.concat(this.renderIndex.selectedRecords.filter(record => record.event.type !== "group"));
		const seen = new Set();
		for (const record of records) {
			const event = record.event;
			if (seen.has(event.id) || !event.attached || event.snappee !== selectedSnappee.id) {
				continue;
			}
			if (!this.renderIndex.activeChannelIds.has(event.channel)) {
				continue;
			}
			seen.add(event.id);
			const position = this.renderIndex.positionFor(event) || event;
			const screen = mapping.toScreen(position);
			context.save();
			context.globalAlpha = 0.9;
			context.strokeStyle = selectedSnappee.color || "#00e0ad";
			context.lineWidth = 1.5;
			context.beginPath();
			context.arc(screen.x, screen.y, (sunniesnowNoteRadius(event.type) + 6) * mapping.scale, 0, Math.PI * 2);
			context.stroke();
			context.restore();
		}
	}

	_drawRulers(context, width, height, project, mapping) {
		if (!project.editor?.showRulers) {
			return;
		}
		const thickness = 22;
		const chartLeft = mapping.toScreen({ x: CHART_BOUNDS.minX, y: 0 }).x;
		const chartRight = mapping.toScreen({ x: CHART_BOUNDS.maxX, y: 0 }).x;
		const chartTop = mapping.toScreen({ x: 0, y: CHART_BOUNDS.maxY }).y;
		const chartBottom = mapping.toScreen({ x: 0, y: CHART_BOUNDS.minY }).y;
		context.save();
		context.fillStyle = "#c8c8c8";
		context.fillRect(0, 0, width, thickness);
		context.fillRect(0, 0, thickness, height);
		context.fillStyle = "#ffffff";
		context.fillRect(
			Math.max(0, chartLeft),
			0,
			Math.max(0, Math.min(width, chartRight) - Math.max(0, chartLeft)),
			thickness,
		);
		context.fillRect(
			0,
			Math.max(0, chartTop),
			thickness,
			Math.max(0, Math.min(height, chartBottom) - Math.max(0, chartTop)),
		);
		const step = niceRulerStep(20 / Math.max(1e-6, mapping.scale));
		context.fillStyle = "#404040";
		context.strokeStyle = "#404040";
		context.lineWidth = 1;
		context.font = "10px 'Cascadia Mono', Consolas, sans-serif";
		context.textAlign = "center";
		context.textBaseline = "top";
		const minX = mapping.toChart({ x: thickness, y: 0 }).x;
		const maxX = mapping.toChart({ x: width, y: 0 }).x;
		for (let value = Math.ceil(minX / step) * step; value <= maxX + 1e-9; value += step) {
			const x = mapping.toScreen({ x: value, y: 0 }).x;
			if (x < thickness) {
				continue;
			}
			const major = Math.abs(value / step) % 5 < 1e-6;
			context.beginPath();
			context.moveTo(x + 0.5, thickness - (major ? 12 : 7));
			context.lineTo(x + 0.5, thickness);
			context.stroke();
			if (major) {
				context.fillText(formatRulerValue(value), x, 2);
			}
		}
		context.textAlign = "right";
		context.textBaseline = "middle";
		const maxY = mapping.toChart({ x: 0, y: thickness }).y;
		const minY = mapping.toChart({ x: 0, y: height }).y;
		for (let value = Math.ceil(minY / step) * step; value <= maxY + 1e-9; value += step) {
			const y = mapping.toScreen({ x: 0, y: value }).y;
			if (y < thickness) {
				continue;
			}
			const major = Math.abs(value / step) % 5 < 1e-6;
			context.beginPath();
			context.moveTo(thickness - (major ? 12 : 7), y + 0.5);
			context.lineTo(thickness, y + 0.5);
			context.stroke();
			if (major) {
				context.fillText(formatRulerValue(value), thickness - 14, y);
			}
		}
		if (this.pointerScreen) {
			const marker = this.pointerScreen;
			context.fillStyle = "#ff3b00";
			context.beginPath();
			context.moveTo(marker.x, thickness);
			context.lineTo(marker.x - 7, 2);
			context.lineTo(marker.x + 7, 2);
			context.closePath();
			context.fill();
			context.beginPath();
			context.moveTo(thickness, marker.y);
			context.lineTo(2, marker.y - 7);
			context.lineTo(2, marker.y + 7);
			context.closePath();
			context.fill();
		}
		context.restore();
	}

}
