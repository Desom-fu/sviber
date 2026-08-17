import { Rational } from "../core/rational.js";
import { TimingMap } from "../core/timing.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, multiplyTransforms, resolveAttachedPosition, sampleSnappee, sampleSnappeePath } from "../core/geometry.js";
import { PixiCanvasSurface } from "./pixi-surface.js";
import { ChartRenderIndex } from "./chart-index.js";
import { MOVABLE_TYPES, NOTE_TYPES, PATTERN_TYPES, DURATION_TYPES, TIP_POINT_SPAWN_TYPES, TIP_POINT_TRAIL_DURATION, TIP_POINT_ZOOM_DURATION, TIP_POINT_TRAIL_TAIL_DURATION, SUNNIESNOW_AUTOPLAY_GRADIENT, SUNNIESNOW_SKIN, sunniesnowNoteRadius, sunniesnowNoteTextColor, sunniesnowPlayfieldScale, isSnappeeVisible, sunniesnowTapDoubleLinePairs, circularArcDraftSpan, sunniesnowEventVisualState, sunniesnowPatternVisualState, sunniesnowDisplayedPattern, colorIntegerToCss, randomColor, projectState, timingFor, currentSeconds, tipPointSpawnTime, buildTipPointGuides, tipPointDirection, sampleTipPointPath, tipPointPathBetween, tipPointVisualState, directionBetween, adjacentDirection, tipPointTrailEdges, drawTipPointTrail, appendPolygonPath, polygonPath, selectedEvents, pointInPolygon } from "./stage-helpers.js";

export class StageViewCore {
	constructor(host, callbacks = {}) {
		this.host = host;
		this.callbacks = callbacks;
		this.surface = new PixiCanvasSurface(host, {
			background: "#55585b",
			onResize: () => this.render(),
		});
		this.state = null;
		this.timing = null;
		this.renderIndex = null;
		this.hitRegions = [];
		this.visibleEvents = [];
		this.selectionBox = null;
		this.creationPreview = null;
		this.curvePreview = null;
		this.drag = null;
		this.pointerMoved = false;
		this.backgroundImage = null;
		this.backgroundCache = document.createElement("canvas");
		this.backgroundSource = document.createElement("canvas");
		this.backgroundPadded = document.createElement("canvas");
		this.backgroundDirty = true;
		this.particles = [];
		this.particleAnimationFrame = 0;
		this.renderAnimationFrame = 0;
		this.pointerMoveAnimationFrame = 0;
		this.pendingPointerMove = null;
		this.lastHudCombo = null;
		this.hudComboAnimationStarted = null;
		this.boundMove = event => this._queuePointerMove(event);
		this.boundUp = event => {
			this._flushPointerMove();
			this._pointerUp(event);
		};
		this.surface.ready.then(() => {
			this.surface.canvas.addEventListener("pointerdown", event => this._pointerDown(event));
			this.surface.canvas.addEventListener("pointermove", event => this._hoverMove(event));
			this.surface.canvas.addEventListener("pointerleave", () => this._pointerLeave());
			this.surface.canvas.addEventListener("dblclick", event => this._doubleClick(event));
			this.render();
		});
	}

	setState(state) {
		this.state = state;
		const project = projectState(state);
		this.renderIndex = state?.renderIndex || new ChartRenderIndex(project, timingFor(state), {
			noteSpeed: state?.preferences?.noteSpeed,
		});
		this.timing = this.renderIndex.timing;
		this.render();
	}

	setBackground(image) {
		this.backgroundImage = image;
		this.backgroundDirty = true;
		this.render();
	}

	triggerHit(event, delaySeconds = 0) {
		const project = projectState(this.state);
		const position = this.renderIndex?.positionFor(event)
			|| resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
		const flick = event.type === "flick";
		const sparkColors = [0xbfaa00, 0xffff00];
		const contourColors = [0xbfaa00, 0xff7f00];
		this.particles.push({
			x: position.x,
			y: position.y,
			radius: sunniesnowNoteRadius(event.type),
			started: performance.now() + Math.max(0, Number(delaySeconds) || 0) * 1000,
			sparks: Array.from({ length: 20 }, () => ({
				angle: flick
					? Math.random() * Math.PI - Math.PI / 2 - (Number(event.angle) || 0)
					: Math.random() * Math.PI * 2,
				color: randomColor(...sparkColors),
			})),
			contours: Array.from({ length: 3 }, () => ({
				angle: Math.random() * Math.PI * 2,
				color: randomColor(...contourColors),
			})),
		});
		this._animateParticles();
	}

	cancelScheduledHits() {
		const now = performance.now();
		this.particles = this.particles.filter(particle => particle.started <= now);
		this.render();
	}

	_animateParticles() {
		// Playback already renders once per audio animation frame.
		if (this.callbacks.isPlaying?.()) return;
		if (this.particleAnimationFrame) return;
		const animate = () => {
			this.particleAnimationFrame = 0;
			const now = performance.now();
			this.particles = this.particles.filter(particle => now - particle.started < 190);
			this.render();
			if (this.particles.length) this.particleAnimationFrame = requestAnimationFrame(animate);
		};
		this.particleAnimationFrame = requestAnimationFrame(animate);
	}

	render() {
		if (this.renderAnimationFrame) {
			cancelAnimationFrame(this.renderAnimationFrame);
			this.renderAnimationFrame = 0;
		}
		if (!this.state || !this.surface.context) return;
		if (this.surface.resize()) this.backgroundDirty = true;
		this.surface.render((context, width, height) => this._draw(context, width, height));
	}

	requestRender() {
		if (this.renderAnimationFrame) return;
		this.renderAnimationFrame = requestAnimationFrame(() => {
			this.renderAnimationFrame = 0;
			this.render();
		});
	}

	_queuePointerMove(event) {
		this.pendingPointerMove = {
			clientX: event.clientX,
			clientY: event.clientY,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
		};
		if (this.pointerMoveAnimationFrame) return;
		this.pointerMoveAnimationFrame = requestAnimationFrame(() => this._flushPointerMove());
	}

	_flushPointerMove() {
		if (this.pointerMoveAnimationFrame) cancelAnimationFrame(this.pointerMoveAnimationFrame);
		this.pointerMoveAnimationFrame = 0;
		const event = this.pendingPointerMove;
		this.pendingPointerMove = null;
		if (event) this._pointerMove(event);
	}

	_mapping(width, height) {
		const scale = sunniesnowPlayfieldScale(width, height);
		return {
			scale,
			originX: width / 2,
			originY: height / 2,
			toScreen: point => ({ x: width / 2 + point.x * scale, y: height / 2 - point.y * scale }),
			toChart: point => ({ x: (point.x - width / 2) / scale, y: (height / 2 - point.y) / scale }),
		};
	}

	_prepareBackground(width, height) {
		if (!this.backgroundDirty && this.backgroundCache.width === width && this.backgroundCache.height === height) return;
		this.backgroundCache.width = width;
		this.backgroundCache.height = height;
		this.backgroundSource.width = width;
		this.backgroundSource.height = height;
		const source = this.backgroundSource.getContext("2d", { alpha: false });
		source.fillStyle = "#ffffff";
		source.fillRect(0, 0, width, height);
		if (this.backgroundImage) {
			const imageWidth = this.backgroundImage.naturalWidth || this.backgroundImage.width || width;
			const imageHeight = this.backgroundImage.naturalHeight || this.backgroundImage.height || height;
			const scale = Math.max(width / imageWidth, height / imageHeight);
			const drawWidth = imageWidth * scale;
			const drawHeight = imageHeight * scale;
			source.drawImage(this.backgroundImage, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
		}

		// Pixi's BlurFilter samples clamped edge pixels. Repeating the outermost
		// source pixels into a padded bitmap produces the same edge behavior here.
		const padding = Math.ceil(SUNNIESNOW_SKIN.backgroundBlur * 3);
		this.backgroundPadded.width = width + padding * 2;
		this.backgroundPadded.height = height + padding * 2;
		const padded = this.backgroundPadded.getContext("2d", { alpha: false });
		padded.drawImage(this.backgroundSource, padding, padding);
		padded.drawImage(this.backgroundSource, 0, 0, 1, height, 0, padding, padding, height);
		padded.drawImage(this.backgroundSource, width - 1, 0, 1, height, padding + width, padding, padding, height);
		padded.drawImage(this.backgroundSource, 0, 0, width, 1, padding, 0, width, padding);
		padded.drawImage(this.backgroundSource, 0, height - 1, width, 1, padding, padding + height, width, padding);
		padded.fillStyle = source.getImageData(0, 0, 1, 1).data.slice(0, 3).reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(0, 0, padding, padding);
		padded.fillStyle = source.getImageData(width - 1, 0, 1, 1).data.slice(0, 3).reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(padding + width, 0, padding, padding);
		padded.fillStyle = source.getImageData(0, height - 1, 1, 1).data.slice(0, 3).reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(0, padding + height, padding, padding);
		padded.fillStyle = source.getImageData(width - 1, height - 1, 1, 1).data.slice(0, 3).reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(padding + width, padding + height, padding, padding);

		const context = this.backgroundCache.getContext("2d", { alpha: false });
		context.save();
		context.filter = `blur(${SUNNIESNOW_SKIN.backgroundBlur}px) brightness(${SUNNIESNOW_SKIN.backgroundBrightness * 100}%)`;
		context.drawImage(this.backgroundPadded, -padding, -padding);
		context.restore();
		this.backgroundDirty = false;
	}

	_draw(context, width, height) {
		const project = projectState(this.state);
		const mapping = this._mapping(width, height);
		const now = currentSeconds(this.state, this.timing);
		this.hitRegions = [];
		this.visibleEvents = [];
		this._prepareBackground(width, height);
		context.drawImage(this.backgroundCache, 0, 0);
		this._drawBackgroundPatterns(context, project, mapping, now);
		this._drawBoundary(context, mapping);
		this._drawHud(context, width, height, project, now);
		this._drawParticles(context, mapping);
		this._drawSnappees(context, project, mapping);
		this._drawNotes(context, project, mapping, now);
		this._drawCreationEchoes(context, project, mapping, now);
		this._drawTipPoints(context, project, mapping, now);
		this._drawSelectedInvisible(context, project, mapping, now);
		this._drawSelectionHandles(context, project, mapping);
		this._drawFreeTransform(context, mapping);
		this._drawCreationPreview(context, project, mapping);
		this._drawCurveDraft(context, mapping);
		if (this.selectionBox) this._drawSelectionBox(context, this.selectionBox);
	}

	_drawBoundary(context, mapping) {
		const topLeft = mapping.toScreen({ x: -100, y: 50 });
		const bottomRight = mapping.toScreen({ x: 100, y: -50 });
		context.strokeStyle = "rgba(225,230,233,0.72)";
		context.lineWidth = 1;
		context.strokeRect(
			Math.round(topLeft.x) + 0.5,
			Math.round(topLeft.y) + 0.5,
			Math.round(bottomRight.x - topLeft.x),
			Math.round(bottomRight.y - topLeft.y),
		);
	}

	_eventTimes(event) {
		const indexed = this.renderIndex?.recordFor(event);
		if (indexed) return { start: indexed.start, end: indexed.end };
		const start = this.timing.beatToSeconds(event.time);
		const end = DURATION_TYPES.has(event.type)
			? this.timing.beatToSeconds(Rational.from(event.time).add(event.duration || [0, 1, 1]))
			: start;
		return { start, end };
	}

	_drawBackgroundPatterns(context, project, mapping, now) {
		const record = this.renderIndex
			? this.renderIndex.displayedPattern(now)
			: sunniesnowDisplayedPattern(project.events, this.timing, now);
		if (!record) return;
		const { visual } = record;
		context.save();
		if (visual.phase === "fadingIn") {
			context.globalAlpha = visual.progress;
			const center = mapping.toScreen({ x: 0, y: 0 });
			context.translate(center.x, center.y);
			context.scale(visual.progress, visual.progress);
			context.translate(-center.x, -center.y);
		} else if (visual.phase === "fadingOut") {
			context.globalAlpha = 1 - visual.progress;
		}
		this._drawPattern(context, record.event, mapping);
		context.restore();
	}

	_drawPattern(context, event, mapping) {
		const center = mapping.toScreen({ x: 0, y: 0 });
		const unit = SUNNIESNOW_SKIN.noteRadius * 2 * mapping.scale;
		const selected = Boolean(event.selected);
		const stroke = selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.patternStroke;
		context.save();
		context.translate(center.x, center.y);
		if (event.type === "grid") {
			const halfWidth = unit * 4;
			const halfHeight = unit * 2;
			const margin = unit / 10;
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
			context.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
			context.beginPath();
			for (let index = -4; index <= 4; index += 1) {
				context.moveTo(index * unit, -halfHeight - margin);
				context.lineTo(index * unit, halfHeight + margin);
			}
			for (let index = -2; index <= 2; index += 1) {
				context.moveTo(-halfWidth - margin, index * unit);
				context.lineTo(halfWidth + margin, index * unit);
			}
			context.strokeStyle = stroke;
			context.lineWidth = unit / 50;
			context.stroke();
		} else if (event.type === "checkerboard") {
			for (let row = 0; row < 4; row += 1) {
				for (let column = 0; column < 4; column += 1) {
					context.fillStyle = selected
						? `rgba(255,46,89,${(row + column) % 2 ? 0.22 : 0.48})`
						: ((row + column) % 2 ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.4)");
					context.fillRect((row - 2) * unit, (column - 2) * unit, unit, unit);
				}
			}
		} else if (event.type === "turntable") {
			const thickness = unit / 20;
			context.beginPath();
			context.arc(0, 0, unit * 2, 0, Math.PI * 2);
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
			context.fill();
			context.strokeStyle = stroke;
			context.lineWidth = thickness;
			context.stroke();
			context.beginPath();
			context.arc(0, 0, unit * 1.12, 0, Math.PI * 2);
			context.stroke();
			context.beginPath();
			context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
			context.stroke();
		} else if (event.type === "bigText") {
			const baseSize = SUNNIESNOW_SKIN.noteRadius * 10 * mapping.scale;
			const text = String(event.text || "");
			context.font = `${baseSize}px 'Sviber Big Text', 'YujiBoku', 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
			const measured = context.measureText(text).width;
			const fontSize = baseSize * Math.min(1, 250 * mapping.scale / Math.max(measured, 1));
			context.font = `${fontSize}px 'Sviber Big Text', 'YujiBoku', 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillStyle = selected ? SUNNIESNOW_SKIN.selectionTint : "rgba(255,255,255,0.8)";
			context.fillText(text, 0, 0);
		} else if (event.type === "diamondGrid") {
			const margin = unit / 10;
			const ends = [3, 2, 1, -1];
			const halfSpan = ends.length - 1;
			context.beginPath();
			for (let index = -halfSpan; index <= halfSpan; index += 1) {
				const x = index * unit * 2;
				const start = -ends[Math.max(0, -index)] * unit;
				const ending = ends[Math.max(0, index)] * unit;
				context.moveTo(x + start - margin, start - margin);
				context.lineTo(x + ending + margin, ending + margin);
				context.moveTo(-x - start + margin, start - margin);
				context.lineTo(-x - ending - margin, ending + margin);
			}
			context.strokeStyle = stroke;
			context.lineWidth = unit / 50;
			context.stroke();
		} else if (event.type === "hexagon") {
			const thickness = unit / 20;
			polygonPath(context, 0, 0, unit * 4 / Math.sqrt(3), 6, Math.PI / 2);
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
			context.fill();
			context.strokeStyle = stroke;
			context.lineWidth = thickness;
			context.stroke();
			context.beginPath();
			appendPolygonPath(context, 0, 0, unit * 2, 6, 0);
			appendPolygonPath(context, 0, 0, unit * Math.sqrt(3), 6, Math.PI / 2);
			context.globalAlpha *= 0.7;
			context.lineWidth = unit / 50;
			context.stroke();
			context.globalAlpha /= 0.7;
			context.beginPath();
			context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
			context.lineWidth = thickness;
			context.stroke();
		} else if (event.type === "pentagon") {
			const thickness = unit / 20;
			const radius = 4 * unit / (1 + Math.cos(Math.PI / 5));
			polygonPath(context, 0, -2 * unit + radius, radius, 5, 0);
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
			context.fill();
			context.strokeStyle = stroke;
			context.lineWidth = thickness;
			context.stroke();
			context.beginPath();
			context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
			context.stroke();
		} else if (event.type === "hexagram") {
			const thickness = unit / 20;
			const points = [];
			for (let index = 0; index < 12; index += 1) {
				const radius = index % 2 ? unit * 2 : unit * 2 / Math.sqrt(3);
				const angle = index * Math.PI / 6;
				points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
			}
			context.beginPath();
			points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
			context.closePath();
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
			context.fill();
			context.beginPath();
			appendPolygonPath(context, 0, 0, unit * 2, 3, 0);
			appendPolygonPath(context, 0, 0, unit * 2, 3, Math.PI);
			context.strokeStyle = stroke;
			context.lineWidth = thickness;
			context.stroke();
			context.beginPath();
			context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
			context.stroke();
		}
		context.restore();
	}

	_drawSnappees(context, project, mapping) {
		for (const snappee of project.snappees) {
			if (!isSnappeeVisible(snappee)) continue;
			let points;
			try { points = this.renderIndex?.snappeeSamples.get(snappee) || sampleSnappee(snappee); } catch { continue; }
			if (!points.length) continue;
			context.save();
			context.strokeStyle = snappee.color || "#58b6ef";
			context.fillStyle = snappee.color || "#58b6ef";
			context.globalAlpha = 0.82;
			context.lineWidth = snappee.selected ? 1.8 : 1;
			if (snappee.type === "rectangularMesh" || snappee.type === "parametricMesh") {
				const byIndex = new Map(points.map(value => [String(value.snapPoint), value]));
				context.beginPath();
				for (const value of points) {
					const [i, j] = value.snapPoint;
					for (const neighbor of [[i + 1, j], [i, j + 1]]) {
						const next = byIndex.get(String(neighbor));
						if (!next) continue;
						const from = mapping.toScreen(value);
						const to = mapping.toScreen(next);
						context.moveTo(from.x, from.y);
						context.lineTo(to.x, to.y);
					}
				}
				context.stroke();
			} else if (snappee.type === "radialMesh") {
				this._drawRadialMeshPath(context, snappee, mapping);
			} else if (snappee.type === "bezierCurve" || snappee.type === "penCurve") {
				let path;
				try { path = sampleSnappeePath(snappee); } catch { path = points; }
				context.beginPath();
				path.forEach((value, index) => {
					const point = mapping.toScreen(value);
					if (!index) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
				});
				context.stroke();
			} else {
				context.beginPath();
				points.forEach((value, index) => {
					const point = mapping.toScreen(value);
					if (!index) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
				});
				if (snappee.closed) context.closePath();
				context.stroke();
			}
			for (const value of points) {
				const point = mapping.toScreen(value);
				context.beginPath();
				context.arc(point.x, point.y, snappee.selected ? 2.6 : 1.7, 0, Math.PI * 2);
				context.fill();
			}
			if (snappee.selected) this._drawSnappeeHandles(context, snappee, points, mapping);
			context.restore();
		}
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
			mapping.scale * a, -mapping.scale * b,
			mapping.scale * c, -mapping.scale * d,
			mapping.originX + mapping.scale * e,
			mapping.originY - mapping.scale * f,
		);
		context.lineWidth = Math.max(0.2, context.lineWidth / Math.max(mapping.scale, 0.001));
		context.beginPath();
		for (let index = 1; index <= radialTiles; index += 1) {
			context.moveTo(centerX + radius * index / radialTiles, centerY);
			context.arc(centerX, centerY, radius * index / radialTiles, 0, Math.PI * 2);
		}
		for (let index = 0; index < azimuthalTiles; index += 1) {
			const direction = angle + index * Math.PI * 2 / azimuthalTiles;
			context.moveTo(centerX, centerY);
			context.lineTo(centerX + Math.cos(direction) * radius, centerY + Math.sin(direction) * radius);
		}
		context.stroke();
		context.restore();
	}

	_drawSnappeeHandles(context, snappee, points, mapping) {
		let handles = [];
		if (snappee.type === "rectangularMesh") handles = [points[0], points.at(-1)];
		else if (snappee.type === "radialMesh") handles = [points[0], points.find(point => point.snapPoint[1] === (snappee.radialTiles || 1))];
		else if (snappee.type === "regularPolygonCurve") handles = [
			applyTransform({ x: snappee.centerX, y: snappee.centerY }, snappee.transformation),
			points[0],
		];
		else if (snappee.type === "bezierCurve") handles = (snappee.controlPoints || []).map((point, index) => ({
			...applyTransform(point, snappee.transformation), handleIndex: index,
		}));
		else if (snappee.type === "circularArcCurve") handles = [
			{ ...applyTransform({ x: snappee.centerX, y: snappee.centerY }, snappee.transformation), handleIndex: "center" },
			points[0], points.at(-1),
		];
		else if (snappee.type === "penCurve") {
			for (let commandIndex = 0; commandIndex < (snappee.commands || []).length; commandIndex += 1) {
				const command = snappee.commands[commandIndex];
				for (const [x, y] of [["x1", "y1"], ["x2", "y2"], ["x", "y"]]) {
					if (!Number.isFinite(Number(command?.[x])) || !Number.isFinite(Number(command?.[y]))) continue;
					handles.push({
						...applyTransform({ x: Number(command[x]), y: Number(command[y]) }, snappee.transformation),
						handleIndex: { command: commandIndex, x, y },
					});
				}
			}
		}
		for (let index = 0; index < handles.length; index += 1) {
			const handle = handles[index];
			if (!handle) continue;
			const point = mapping.toScreen(handle);
			context.fillStyle = "#f7f8f9";
			context.strokeStyle = "#101215";
			context.lineWidth = 1;
			context.fillRect(point.x - 5, point.y - 5, 10, 10);
			context.strokeRect(point.x - 5, point.y - 5, 10, 10);
			this.hitRegions.push({ type: "snappee-handle", snappee, index: handle.handleIndex ?? index,
				x: point.x - 8, y: point.y - 8, width: 16, height: 16 });
		}
	}

	_noteVisibility(event, now) {
		const { start, end } = this._eventTimes(event);
		return sunniesnowEventVisualState(event, start, end, now, this.state?.preferences?.noteSpeed);
	}

	_drawNotes(context, project, mapping, now) {
		const doubleTapIds = this._doubleTapIds(project);
		const records = [];
		const backgroundRecords = [];
		const noteRecords = [];
		const candidates = this.renderIndex?.visibleMovableRecords(now)
			|| project.events.filter(event => MOVABLE_TYPES.has(event.type)).map(event => ({ event }));
		for (const indexed of candidates) {
			const { event } = indexed;
			const visibility = indexed.start == null
				? this._noteVisibility(event, now)
				: sunniesnowEventVisualState(event, indexed.start, indexed.end, now, this.state?.preferences?.noteSpeed);
			if (!visibility) continue;
			const position = indexed.position || resolveAttachedPosition(event, project.snappees)
				|| { x: Number(event.x) || 0, y: Number(event.y) || 0 };
			const screen = mapping.toScreen(position);
			const record = { event, position, screen, visibility, doubleTap: doubleTapIds.has(event.id) };
			records.push(record);
			if (event.type === "bgNote") backgroundRecords.push(record);
			else if (NOTE_TYPES.has(event.type)) noteRecords.push(record);
			this.visibleEvents.push(record);
		}
		for (const record of backgroundRecords) {
			this._drawNoteBody(context, record.event, record.screen, mapping.scale, record.visibility, record.doubleTap);
		}
		this._drawDoubleLines(context, project, mapping, now);
		for (const record of noteRecords) {
			this._drawNoteBody(context, record.event, record.screen, mapping.scale, record.visibility, record.doubleTap);
		}
		// Sunniesnow keeps all shrinking circles in a separate layer above note bodies.
		for (const record of noteRecords) {
			this._drawApproachCircle(context, record.event, record.screen, mapping.scale, record.visibility);
		}
		for (const { event, position, screen } of records) {
			const radius = sunniesnowNoteRadius(event.type) * mapping.scale;
			const region = {
				type: "event", event, position,
				x: screen.x - radius, y: screen.y - radius,
				width: radius * 2, height: radius * 2,
				centerX: screen.x, centerY: screen.y,
			};
			if (event.type === "bgNote") {
				region.polygon = Array.from({ length: 6 }, (_, index) => ({
					x: screen.x + Math.cos(index * Math.PI / 3) * radius,
					y: screen.y + Math.sin(index * Math.PI / 3) * radius,
				}));
			} else region.radius = radius;
			this.hitRegions.push(region);
		}
	}

	_doubleTapIds(project) {
		return this.renderIndex?.doubleTapIds
			|| new Set(sunniesnowTapDoubleLinePairs(project.events).flat().map(event => event.id));
	}

	_drawDoubleLines(context, project, mapping, now) {
		const approachSpeed = Number(this.state?.preferences?.noteSpeed) > 0
			? Number(this.state.preferences.noteSpeed)
			: SUNNIESNOW_SKIN.approachSpeed;
		const pairs = this.renderIndex?.activeDoubleTapPairs(now)
			|| sunniesnowTapDoubleLinePairs(project.events).map(([event1, event2]) => ({ event1, event2 }));
		for (const pair of pairs) {
				const { event1, event2 } = pair;
				const start = pair.start ?? this.timing.beatToSeconds(event1.time);
				const relativeTime = now - start;
				let progress = 1;
				let alpha = 1;
				const fadeStart = -1 / approachSpeed - 0.25;
				if (relativeTime < fadeStart || relativeTime >= 1 / 3) continue;
				if (relativeTime < -1 / approachSpeed) {
					progress = (relativeTime - fadeStart) / 0.25;
				} else if (relativeTime > 0) alpha = (1 - relativeTime / (1 / 3)) ** 2;
				const position1 = pair.position1 || resolveAttachedPosition(event1, project.snappees) || event1;
				const position2 = pair.position2 || resolveAttachedPosition(event2, project.snappees) || event2;
				const point1 = mapping.toScreen(position1);
				const point2 = mapping.toScreen(position2);
				const beginning = {
					x: point1.x + (point2.x - point1.x) * (1 - progress) / 2,
					y: point1.y + (point2.y - point1.y) * (1 - progress) / 2,
				};
				const ending = {
					x: point1.x + (point2.x - point1.x) * (1 + progress) / 2,
					y: point1.y + (point2.y - point1.y) * (1 + progress) / 2,
				};
				context.save();
				context.globalAlpha = alpha;
				context.strokeStyle = event1.selected || event2.selected ? SUNNIESNOW_SKIN.selectionTint : "#f9f9e9";
				context.lineWidth = SUNNIESNOW_SKIN.noteRadius * mapping.scale / 12;
				context.setLineDash([SUNNIESNOW_SKIN.noteRadius * mapping.scale / 4, SUNNIESNOW_SKIN.noteRadius * mapping.scale / 4]);
				context.beginPath();
				context.moveTo(beginning.x, beginning.y);
				context.lineTo(ending.x, ending.y);
				context.stroke();
				context.restore();
		}
	}

}
