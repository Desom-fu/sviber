import { Rational } from "../core/rational.js";
import { CHART_BOUNDS, resolveAttachedPosition } from "../core/geometry.js";
import { PixiCanvasSurface } from "./pixi-surface.js";
import { ChartRenderIndex } from "./chart-index.js";
import {
	TIMELINE_DURATION_TYPES,
	TIMELINE_EVENT_COLORS,
	drawTimelineEventIcon,
	eventDrawLayer,
	isBackgroundEvent,
	projectState,
	relativeBeatColor,
	tipSpawnDirectionSegment,
	timingFor,
} from "./timeline-helpers.js";
import { MOVABLE_TYPES, buildTipPointGuides, tipPointSpawnPosition } from "./stage-helpers.js";
import { descendants, flattenEvents } from "../core/grouping.js";
import { eventClickSelectionMode } from "./selection.js";

const DURATION_TYPES = TIMELINE_DURATION_TYPES;

function lowerBound(values, target) {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (values[middle] < target) low = middle + 1;
		else high = middle;
	}
	return low;
}

function upperBound(values, target) {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (values[middle] <= target) low = middle + 1;
		else high = middle;
	}
	return low;
}

export class ScrollView {
	constructor(host, callbacks = {}) {
		this.host = host;
		this.callbacks = callbacks;
		this.surface = new PixiCanvasSurface(host, { background: "#090a0c", onResize: () => this.render() });
		this.state = null;
		this.timing = null;
		this.renderIndex = null;
		this.hitRegions = [];
		this.selectionBox = null;
		this.drag = null;
		this.pointerMoved = false;
		this.renderFrame = 0;
		this.spaceHeld = false;
		this.spaceKeyDown = event => { if (event.code === "Space" || event.key === " ") this.spaceHeld = true; };
		this.spaceKeyUp = event => { if (event.code === "Space" || event.key === " ") this.spaceHeld = false; };
		document.addEventListener("keydown", this.spaceKeyDown, true);
		document.addEventListener("keyup", this.spaceKeyUp, true);
		this.surface.ready.then(() => {
			this.surface.canvas.addEventListener("pointerdown", event => this.#pointerDown(event));
		});
	}

	setState(state, options = {}) {
		this.state = state;
		const project = projectState(state);
		this.timing = timingFor(state);
		this.renderIndex = state?.renderIndex || new ChartRenderIndex(project, this.timing, {
			noteSpeed: state?.preferences?.noteSpeed,
		});
		if (options.render !== false) this.render();
	}

	#mapping(width, height) {
		const project = projectState(this.state);
		const visibleSpan = Math.max(0.001,
			Number(project?.editor?.visibleRangeEnd) - Number(project?.editor?.visibleRangeBeginning));
		const timelineWidth = Math.max(1, Number(this.callbacks.getTimelineWidth?.()) || width);
		const xScale = Math.max(0.1, width / (CHART_BOUNDS.maxX - CHART_BOUNDS.minX));
		const timeScale = Math.max(0.1, timelineWidth / visibleSpan);
		const current = this.#currentSeconds();
		const baseline = height * 0.75;
		const timeSpan = height / timeScale;
		return {
			xScale, timeScale, baseline, timeSpan,
			toScreen: (x, time) => ({
				x: (Number(x) - CHART_BOUNDS.minX) * xScale,
				y: baseline - (Number(time) - current) * timeScale,
			}),
			fromScreen: (x, y) => ({
				x: x / xScale + CHART_BOUNDS.minX,
				time: current - (y - baseline) / timeScale,
			}),
		};
	}

	#currentSeconds() {
		const project = projectState(this.state);
		if (!project || !this.timing) return 0;
		return project.editor?.timeSnapped === false
			? Number(project.editor.currentTime) || 0
			: this.timing.beatToSeconds(project.editor.currentTime || [0, 0, 1]);
	}

	#activeEvents(project) {
		const active = new Set((project.channels || [])
			.filter(channel => channel.active !== false).map(channel => channel.id));
		return flattenEvents(project.events || [], false).filter(event => event.type !== "group" && event.type !== "comment"
			&& active.has(event.channel)
			&& (project.editor?.showBgEventsInTimeline !== false || !isBackgroundEvent(event)));
	}

	#position(event) {
		const resolved = this.renderIndex?.positionFor(event)
			|| resolveAttachedPosition(event, projectState(this.state).snappees);
		return resolved || { x: Number(event.x) || 0, y: Number(event.y) || 0 };
	}

	#eventTime(event) {
		try { return this.timing.beatToSeconds(event.time); } catch { return 0; }
	}

	#eventEnd(event, start) {
		if (!DURATION_TYPES.has(event.type)) return start;
		try { return this.timing.beatToSeconds(Rational.from(event.time).add(event.duration || [0, 1, 1])); }
		catch { return start; }
	}

	#visibleTimeRange(mapping, height, padding = 30) {
		const top = mapping.fromScreen(0, -padding).time;
		const bottom = mapping.fromScreen(0, height + padding).time;
		return [Math.min(top, bottom), Math.max(top, bottom)];
	}

	#drawBeatLines(context, width, height, mapping) {
		const current = this.#currentSeconds();
		const first = this.timing.secondsToBeatNumber(current - mapping.timeSpan * 0.2);
		const last = this.timing.secondsToBeatNumber(current + mapping.timeSpan * 1.1);
		const subdivision = Math.max(1, Math.floor(projectState(this.state).editor.subdivision || 2));
		const lines = this.timing.beatLinesBetween(
			Rational.fromNumber(Math.min(first, last) - 1 / subdivision),
			Rational.fromNumber(Math.max(first, last) + 1 / subdivision),
			subdivision,
		);
		const lineGroups = new Map();
		const labels = [];
		let previousLabelY = Infinity;
		for (const line of lines) {
			const time = this.timing.beatToSeconds(line.beat);
			const y = mapping.toScreen(0, time).y;
			if (y < -2 || y > height + 2) continue;
			const major = line.integerFromBar;
			const color = relativeBeatColor(line.relative);
			const style = `${color}:${line.barLine ? "bar" : major ? "major" : "minor"}`;
			if (!lineGroups.has(style)) lineGroups.set(style, { color, major, barLine: line.barLine, ys: [] });
			lineGroups.get(style).ys.push(Math.round(y) + 0.5);
			if (major && Math.abs(y - previousLabelY) >= 12) {
				labels.push({ text: line.relative.toString(), y });
				previousLabelY = y;
			}
		}
		context.save();
		for (const group of lineGroups.values()) {
			context.strokeStyle = group.color;
			context.globalAlpha = group.major ? 0.72 : 0.3;
			context.lineWidth = group.barLine ? 2.5 : group.major ? 1.35 : 1;
			context.beginPath();
			for (const y of group.ys) {
				context.moveTo(0, y);
				context.lineTo(width, y);
			}
			context.stroke();
		}
		context.font = "10px 'Cascadia Mono', Consolas, monospace";
		context.textAlign = "left";
		context.globalAlpha = 0.95;
		context.fillStyle = "#ff405d";
		for (const label of labels) context.fillText(label.text, 3, label.y - 2);
		context.restore();
	}

	#drawTipGuides(context, project, mapping, beginning, ending) {
		const guides = this.renderIndex?.scrollTipGuides(beginning, ending)
			|| buildTipPointGuides(project, this.timing);
		const activeChannels = this.renderIndex?.activeChannelIds
			|| new Set(project.channels.filter(channel => channel.active !== false).map(channel => channel.id));
		for (const guide of guides) {
			if (!activeChannels.has(guide.events[0]?.channel)) continue;
			const firstVisible = Math.max(0, lowerBound(guide.eventTimes, beginning) - 1);
			const lastVisible = Math.min(guide.events.length, upperBound(guide.eventTimes, ending) + 1);
			const visibleCount = lastVisible - firstVisible;
			const sampleCount = Math.min(visibleCount, Math.max(96, Math.ceil(this.surface.height / 2)));
			const checkpoints = [];
			let previousIndex = -1;
			for (let sample = 0; sample < sampleCount; sample += 1) {
				const offset = sampleCount === visibleCount ? sample
					: Math.round(sample * (visibleCount - 1) / Math.max(1, sampleCount - 1));
				const index = firstVisible + offset;
				if (index === previousIndex) continue;
				previousIndex = index;
				const event = guide.events[index];
				const point = this.#position(event);
				checkpoints.push({ ...mapping.toScreen(point.x, guide.eventTimes[index]), event });
			}
			if (!checkpoints.length) continue;
			const firstPosition = this.#position(guide.events[0]);
			const firstScreen = mapping.toScreen(firstPosition.x, guide.eventTimes[0]);
			const resolvedSpawn = this.renderIndex?.tipSpawnPositionFor(guide.spawnSettings);
			const spawnPosition = tipPointSpawnPosition(
				guide.spawnSettings, firstPosition, project.snappees, resolvedSpawn,
			);
			const connector = tipSpawnDirectionSegment(firstPosition, spawnPosition, firstScreen, 12);
			context.save();
			context.strokeStyle = "rgba(255,255,255,0.24)";
			context.lineWidth = 5;
			context.lineCap = "round";
			context.beginPath();
			checkpoints.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
			if (checkpoints.length > 1) context.stroke();
			if (connector.length > 1) {
				context.strokeStyle = "#a98500";
				context.lineWidth = 1.5;
				context.beginPath();
				context.moveTo(connector[0].x, connector[0].y);
				context.lineTo(connector[1].x, connector[1].y);
				context.stroke();
			}
			context.restore();
		}
	}

	#drawEvents(context, project, mapping, width, height, beginning, ending) {
		const maximumIcons = Math.max(256, Math.ceil(width * height / 160));
		const indexedRecords = this.renderIndex?.scrollEventRecords(beginning, ending, maximumIcons * 2);
		const source = indexedRecords || this.#activeEvents(project).map(event => {
			const start = this.#eventTime(event);
			return { event, start, end: this.#eventEnd(event, start) };
		});
		const dense = Boolean(indexedRecords?.sampled) || source.length > maximumIcons * 2;
		const bucketSize = dense ? Math.max(8, Math.sqrt(width * height / Math.max(1, maximumIcons / 2))) : 0;
		const buckets = dense ? new Map() : null;
		const records = [];
		for (const record of source) {
			const { event } = record;
			if (project.editor?.showBgEventsInTimeline === false && isBackgroundEvent(event)) continue;
			const item = { event, start: record.start, end: record.end,
				point: record.position || this.#position(event) };
			const screen = mapping.toScreen(item.point.x, item.start);
			const endY = mapping.toScreen(item.point.x, item.end).y;
			if (Math.max(screen.y, endY) <= -30 || Math.min(screen.y, endY) >= height + 30) continue;
			if (!dense) {
				records.push(item);
				continue;
			}
			const layer = event.type === "bgNote" ? 0 : 1;
			const bucketY = Math.max(-30, Math.min(height + 30, screen.y));
			const key = `${layer}:${Math.floor(screen.x / bucketSize)}:${Math.floor(bucketY / bucketSize)}`;
			const existing = buckets.get(key);
			if (!existing || (event.selected && !existing.event.selected)
				|| Boolean(event.selected) === Boolean(existing.event.selected) && item.start >= existing.start) {
				buckets.set(key, item);
			}
		}
		if (dense) records.push(...buckets.values());
		records.sort((left, right) => eventDrawLayer(left.event) - eventDrawLayer(right.event)
			|| left.start - right.start);
		this.#drawSelectedGroupBounds(context, mapping);
		for (const record of records) {
			const { event, point } = record;
			const screen = mapping.toScreen(point.x, record.start);
			const selected = this.renderIndex?.isEventSelected(event) ?? Boolean(event.selected);
			const color = selected ? "#ff3158" : TIMELINE_EVENT_COLORS[event.type] || "#d5dade";
			const ancestors = project.editor?.showGroupingInTimeline === false
				? [] : this.renderIndex?.ancestorsById.get(event.id) || [];
			ancestors.slice().reverse().forEach((group, index) => {
				context.save();
				context.strokeStyle = group.color || "#ff9d3d";
				context.lineWidth = 1.4;
				context.beginPath();
				context.arc(screen.x, screen.y, 12 + index * 5, 0, Math.PI * 2);
				context.stroke();
				context.restore();
			});
			if (DURATION_TYPES.has(event.type) && record.end > record.start) {
				const end = mapping.toScreen(point.x, record.end);
				context.save();
				context.strokeStyle = color;
				context.globalAlpha = selected ? 0.92 : 0.58;
				context.lineWidth = event.type === "hold" ? 8 : 6;
				context.beginPath();
				context.moveTo(screen.x, screen.y);
				context.lineTo(end.x, end.y);
				context.stroke();
				context.restore();
			}
			drawTimelineEventIcon(context, event, screen.x, screen.y, color);
			this.hitRegions.push({ event, x: screen.x, y: screen.y, radius: 12 });
		}
	}

	#drawSelectedGroupBounds(context, mapping) {
		if (!this.renderIndex) return;
		for (const group of this.renderIndex.groupRecords.map(record => record.event)
			.filter(event => this.renderIndex.isRootSelectedGroup(event))) {
			const points = descendants(group).filter(event => event.type !== "group" && MOVABLE_TYPES.has(event.type))
				.map(event => {
					const record = this.renderIndex.recordFor(event);
					const position = record?.position || this.#position(event);
					return record && position ? mapping.toScreen(position.x, record.start) : null;
				}).filter(Boolean);
			if (!points.length) continue;
			const xs = points.map(point => point.x);
			const ys = points.map(point => point.y);
			context.save();
			context.strokeStyle = group.color || "#ff9d3d";
			context.setLineDash([5, 3]);
			context.strokeRect(Math.min(...xs) - 14, Math.min(...ys) - 14,
				Math.max(...xs) - Math.min(...xs) + 28, Math.max(...ys) - Math.min(...ys) + 28);
			context.restore();
		}
	}

	#eventsInBox(x1, y1, x2, y2) {
		const mapping = this.#mapping(this.surface.width, this.surface.height);
		const beginning = mapping.fromScreen(0, Math.max(y1, y2)).time;
		const ending = mapping.fromScreen(0, Math.min(y1, y2)).time;
		const records = this.renderIndex?.scrollEventRecords(beginning, ending) || [];
		return records.filter(record => {
			const position = record.position || this.#position(record.event);
			const center = mapping.toScreen(position.x, record.start);
			return center.x >= Math.min(x1, x2) && center.x <= Math.max(x1, x2)
				&& center.y >= Math.min(y1, y2) && center.y <= Math.max(y1, y2);
		}).map(record => this.renderIndex?.selectionTarget(record.event)?.id || record.event.id)
			.filter((id, index, ids) => ids.indexOf(id) === index);
	}

	#draw(context, width, height) {
		const project = projectState(this.state);
		const mapping = this.#mapping(width, height);
		const [beginning, ending] = this.#visibleTimeRange(mapping, height);
		context.fillStyle = "#090a0c";
		context.fillRect(0, 0, width, height);
		this.#drawBeatLines(context, width, height, mapping);
		this.#drawTipGuides(context, project, mapping, beginning, ending);
		this.hitRegions = [];
		this.#drawEvents(context, project, mapping, width, height, beginning, ending);
		const currentY = mapping.baseline;
		context.strokeStyle = "#ffe331";
		context.lineWidth = 2;
		context.beginPath();
		context.moveTo(0, currentY + 0.5);
		context.lineTo(width, currentY + 0.5);
		context.stroke();
		if (this.selectionBox) {
			const box = this.selectionBox;
			context.fillStyle = "rgba(48,134,255,0.17)";
			context.strokeStyle = "#72adff";
			context.fillRect(box.x, box.y, box.width, box.height);
			context.strokeRect(box.x + 0.5, box.y + 0.5, box.width, box.height);
		}
	}

	render() {
		if (this.renderFrame) {
			cancelAnimationFrame(this.renderFrame);
			this.renderFrame = 0;
		}
		if (!this.state || !this.surface.context) return;
		this.surface.resize();
		this.surface.render((context, width, height) => this.#draw(context, width, height));
	}

	requestRender() {
		if (this.renderFrame) return;
		this.renderFrame = requestAnimationFrame(() => { this.renderFrame = 0; this.render(); });
	}

	#pointerDown(event) {
		if (event.button !== 0 || !this.state) return;
		event.preventDefault();
		const point = this.surface.toLocal(event);
		if (event.ctrlKey && this.spaceHeld) {
			const project = projectState(this.state);
			const mapping = this.#mapping(this.surface.width, this.surface.height);
			this.drag = { type: "viewport-pan", start: point, startSeconds: this.#currentSeconds(),
				current: this.#currentSeconds(), beginning: Number(project.editor.visibleRangeBeginning),
				end: Number(project.editor.visibleRangeEnd), followRange: project.editor.lockVisibleRange !== true
					&& this.#currentSeconds() >= project.editor.visibleRangeBeginning
					&& this.#currentSeconds() <= project.editor.visibleRangeEnd, timeScale: mapping.timeScale };
			this.pointerMoved = false;
			const move = moveEvent => {
				const current = this.surface.toLocal(moveEvent);
				this.pointerMoved ||= Math.hypot(current.x - this.drag.start.x, current.y - this.drag.start.y) > 3;
				if (!this.pointerMoved) return;
				const delta = -(current.y - this.drag.start.y) / this.drag.timeScale;
				this.callbacks.onScrollPan?.(this.drag.startSeconds + delta, false, this.drag);
			};
			const up = upEvent => {
				document.removeEventListener("pointermove", move);
				document.removeEventListener("pointerup", up);
				const current = this.surface.toLocal(upEvent);
				const delta = -(current.y - this.drag.start.y) / this.drag.timeScale;
				this.callbacks.onScrollPan?.(this.drag.startSeconds + delta, true, this.drag);
				this.drag = null;
				this.requestRender();
			};
			document.addEventListener("pointermove", move);
			document.addEventListener("pointerup", up, { once: true });
			return;
		}
		const hit = [...this.hitRegions].reverse().find(region =>
			Math.hypot(point.x - region.x, point.y - region.y) <= region.radius);
		if (hit) {
			const selected = this.renderIndex?.isEventSelected(hit.event) ?? Boolean(hit.event.selected);
			const mode = eventClickSelectionMode({ selected, ctrlKey: event.ctrlKey, altKey: event.altKey });
			this.callbacks.onSelectEvents?.([this.renderIndex?.selectionTarget(hit.event)?.id || hit.event.id], mode);
			return;
		}
		this.drag = { x: point.x, y: point.y, mode: event.altKey ? "remove" : event.ctrlKey ? "add" : "replace" };
		this.pointerMoved = false;
		const move = moveEvent => {
			const current = this.surface.toLocal(moveEvent);
			this.pointerMoved ||= Math.hypot(current.x - this.drag.x, current.y - this.drag.y) > 3;
			if (!this.pointerMoved) return;
			this.selectionBox = {
				x: Math.min(this.drag.x, current.x), y: Math.min(this.drag.y, current.y),
				width: Math.abs(current.x - this.drag.x), height: Math.abs(current.y - this.drag.y),
			};
			this.requestRender();
		};
		const up = upEvent => {
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", up);
			const current = this.surface.toLocal(upEvent);
			if (this.pointerMoved) {
				const x1 = Math.min(this.drag.x, current.x);
				const x2 = Math.max(this.drag.x, current.x);
				const y1 = Math.min(this.drag.y, current.y);
				const y2 = Math.max(this.drag.y, current.y);
				this.callbacks.onSelectEvents?.(this.#eventsInBox(x1, y1, x2, y2), this.drag.mode);
			}
			this.drag = null;
			this.selectionBox = null;
			this.requestRender();
		};
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", up, { once: true });
	}

	destroy() {
		if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
		document.removeEventListener("keydown", this.spaceKeyDown, true);
		document.removeEventListener("keyup", this.spaceKeyUp, true);
		this.surface.destroy();
	}
}
