import { Rational } from "../core/rational.js";
import { PixiCanvasSurface } from "./pixi-surface.js";
import { ChartRenderIndex } from "./chart-index.js";
import { buildTipPointGuides, drawTipPointTrail, tipPointPathBetween, tipPointVisualState } from "./stage.js";
import {
	BEAT_LINE_COLORS,
	TIMELINE_DURATION_TYPES as DURATION_TYPES,
	TIMELINE_EVENT_COLORS as NOTE_COLORS,
	beatColor,
	beatDenominator,
	currentSeconds,
	drawPatternIcon,
	projectState,
	timelineTipConnector,
	timingFor,
} from "./timeline-helpers.js";

export { timelineTipConnector } from "./timeline-helpers.js";

const ZERO_DURATION_TYPES = new Set(["bgNote", "comment"]);

export class TimelineView {
	constructor(host, callbacks = {}) {
		this.host = host;
		this.callbacks = callbacks;
		this.surface = new PixiCanvasSurface(host, {
			background: "#090a0c",
			onResize: () => this.render(),
		});
		this.state = null;
		this.timing = null;
		this.renderIndex = null;
		this.tipPointCheckpointCache = null;
		this.hitRegions = [];
		this.eventCenters = [];
		this.channelOffset = 0;
		this.drag = null;
		this.selectionBox = null;
		this.pointerMoved = false;
		this.renderAnimationFrame = 0;
		this.pointerMoveAnimationFrame = 0;
		this.pendingPointerMove = null;
		this.boundMove = event => this.#queuePointerMove(event);
		this.boundUp = event => {
			this.#flushPointerMove();
			this.#pointerUp(event);
		};
		this.surface.ready.then(() => {
			this.surface.canvas.addEventListener("pointerdown", event => this.#pointerDown(event));
			this.surface.canvas.addEventListener("dblclick", event => this.#doubleClick(event));
			this.surface.canvas.addEventListener("wheel", event => this.#wheel(event), { passive: false });
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

	render() {
		if (this.renderAnimationFrame) {
			cancelAnimationFrame(this.renderAnimationFrame);
			this.renderAnimationFrame = 0;
		}
		if (!this.state || !this.surface.context) return;
		this.surface.resize();
		this.surface.render((context, width, height) => this.#draw(context, width, height));
	}

	requestRender() {
		if (this.renderAnimationFrame) return;
		this.renderAnimationFrame = requestAnimationFrame(() => {
			this.renderAnimationFrame = 0;
			this.render();
		});
	}

	revealChannel(channelId) {
		const project = projectState(this.state);
		const index = project.channels.findIndex(channel => channel.id === channelId);
		if (index < 0) return;
		if (index < this.channelOffset) this.channelOffset = index;
		else if (index >= this.channelOffset + 3) this.channelOffset = index - 2;
		this.requestRender();
	}

	#queuePointerMove(event) {
		this.pendingPointerMove = {
			clientX: event.clientX,
			clientY: event.clientY,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
		};
		if (this.pointerMoveAnimationFrame) return;
		this.pointerMoveAnimationFrame = requestAnimationFrame(() => this.#flushPointerMove());
	}

	#flushPointerMove() {
		if (this.pointerMoveAnimationFrame) cancelAnimationFrame(this.pointerMoveAnimationFrame);
		this.pointerMoveAnimationFrame = 0;
		const event = this.pendingPointerMove;
		this.pendingPointerMove = null;
		if (event) this.#pointerMove(event);
	}

	#layout(width, height) {
		const waveformHeight = Math.max(46, Math.min(64, height * 0.28));
		const scrollHeight = 25;
		const channelsHeight = Math.max(45, height - waveformHeight - scrollHeight);
		const project = projectState(this.state);
		const visibleCount = Math.max(1, Math.min(3, project.channels.length));
		return {
			waveform: { x: 0, y: 0, width, height: waveformHeight },
			channels: { x: 0, y: waveformHeight, width, height: channelsHeight },
			scroll: { x: 0, y: waveformHeight + channelsHeight, width, height: scrollHeight },
			channelHeight: channelsHeight / visibleCount,
			visibleCount,
		};
	}

	#timeToX(seconds, width) {
		const editor = projectState(this.state).editor;
		const span = Math.max(0.001, editor.visibleRangeEnd - editor.visibleRangeBeginning);
		return (seconds - editor.visibleRangeBeginning) / span * width;
	}

	#xToSeconds(x, width) {
		const editor = projectState(this.state).editor;
		return editor.visibleRangeBeginning + x / Math.max(1, width)
			* (editor.visibleRangeEnd - editor.visibleRangeBeginning);
	}

	#draw(context, width, height) {
		const project = projectState(this.state);
		const layout = this.#layout(width, height);
		const editor = project.editor;
		const current = currentSeconds(this.state, this.timing);
		this.hitRegions = [];
		this.eventCenters = [];

		context.fillStyle = "#090a0c";
		context.fillRect(0, 0, width, height);
		this.#drawWaveform(context, layout.waveform, editor);
		this.#drawChannels(context, layout, project);
		this.#drawBeatLines(context, layout, editor);
		this.#drawTipPointLines(context, layout, project, current);
		this.#drawEvents(context, layout, project);
		this.#drawBpmChanges(context, layout.waveform, project);
		this.#drawCurrentLines(context, layout, project, current);
		this.#drawScrollbar(context, layout.scroll, project, current);
		this.#drawChannelScrollbar(context, layout, project);
		if (this.selectionBox) this.#drawSelectionBox(context, this.selectionBox);
	}

	#drawWaveform(context, rectangle, editor) {
		context.fillStyle = "#101216";
		context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
		const waveform = this.callbacks.getWaveform?.();
		if (!waveform) {
			context.strokeStyle = "#5e646b";
			context.lineWidth = 1;
			context.beginPath();
			context.moveTo(0, rectangle.height / 2);
			context.lineTo(rectangle.width, rectangle.height / 2);
			context.stroke();
			return;
		}
		const columns = waveform.getColumns(
			editor.visibleRangeBeginning,
			editor.visibleRangeEnd,
			rectangle.width,
		);
		const middle = rectangle.y + rectangle.height / 2;
		const amplitude = rectangle.height * 0.43;
		context.strokeStyle = "#8c9298";
		context.globalAlpha = 0.9;
		context.lineWidth = 1;
		context.beginPath();
		for (let x = 0; x < columns.length; x += 1) {
			const peak = columns[x];
			context.moveTo(x + 0.5, middle - peak.max * amplitude);
			context.lineTo(x + 0.5, middle - peak.min * amplitude);
		}
		context.stroke();
		context.globalAlpha = 1;
	}

	#drawBeatLines(context, layout, editor) {
		const subdivision = Math.max(1, Math.floor(editor.subdivision || 2));
		const beginningBeat = this.timing.secondsToBeatNumber(editor.visibleRangeBeginning);
		const endingBeat = this.timing.secondsToBeatNumber(editor.visibleRangeEnd);
		const firstStep = Math.floor(Math.min(beginningBeat, endingBeat) * subdivision) - 1;
		const lastStep = Math.ceil(Math.max(beginningBeat, endingBeat) * subdivision) + 1;
		context.save();
		context.font = "10px 'Cascadia Mono', Consolas, monospace";
		context.textBaseline = "top";
		for (let step = firstStep; step <= lastStep; step += 1) {
			const beat = new Rational(step, subdivision);
			const x = this.#timeToX(this.timing.beatToSeconds(beat), layout.waveform.width);
			if (x < -1 || x > layout.waveform.width + 1) continue;
			context.strokeStyle = beatColor(step, subdivision);
			context.globalAlpha = beatDenominator(step, subdivision) === 1 ? 0.72 : 0.34;
			context.lineWidth = beatDenominator(step, subdivision) === 1 ? 1.35 : 1;
			context.beginPath();
			context.moveTo(Math.round(x) + 0.5, 0);
			context.lineTo(Math.round(x) + 0.5, layout.scroll.y);
			context.stroke();
			if (step % subdivision === 0) {
				context.globalAlpha = 0.9;
				context.fillStyle = beatColor(step, subdivision);
				context.fillText(String(step / subdivision), x + 3, 3);
			}
		}
		context.restore();
	}

	#visibleChannels(project) {
		const maxOffset = Math.max(0, project.channels.length - 3);
		this.channelOffset = Math.max(0, Math.min(this.channelOffset, maxOffset));
		return project.channels.slice(this.channelOffset, this.channelOffset + 3);
	}

	#drawChannels(context, layout, project) {
		const channels = this.#visibleChannels(project);
		context.fillStyle = "#090a0c";
		context.fillRect(0, layout.channels.y, layout.channels.width, layout.channels.height);
		context.font = "10px 'Cascadia Mono', Consolas, monospace";
		context.textBaseline = "top";
		channels.forEach((channel, index) => {
			const y = layout.channels.y + index * layout.channelHeight;
			if (index) {
				context.strokeStyle = "#34383d";
				context.lineWidth = 1;
				context.beginPath();
				context.moveTo(0, Math.round(y) + 0.5);
				context.lineTo(layout.channels.width, Math.round(y) + 0.5);
				context.stroke();
			}
			context.fillStyle = channel.id === project.editor.currentChannel ? "#ffe331" : "#c4c9ce";
			context.globalAlpha = channel.active === false ? 0.34 : 0.9;
			const name = String(channel.name || `Channel ${index + this.channelOffset + 1}`);
			context.fillText(name, 4, y + 4, Math.max(20, layout.channels.width - 18));
			context.globalAlpha = 1;
		});
	}

	#eventLaneOffsets(events) {
		if (this.renderIndex) return this.renderIndex.eventLaneOffsets;
		const groups = new Map();
		for (const event of events) {
			const key = `${event.channel}:${Rational.from(event.time).toString()}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(event);
		}
		const offsets = new Map();
		for (const simultaneous of groups.values()) {
			simultaneous.forEach((event, index) => offsets.set(event.id,
				(index - (simultaneous.length - 1) / 2) * 7));
		}
		return offsets;
	}

	#eventPosition(event, layout, project, offsets, record = null) {
		const visibleChannels = this.#visibleChannels(project);
		const channelIndex = visibleChannels.findIndex(channel => channel.id === event.channel);
		if (channelIndex < 0) return null;
		const time = record?.start ?? this.renderIndex?.recordFor(event)?.start
			?? this.timing.beatToSeconds(event.time);
		const x = this.#timeToX(time, layout.channels.width);
		const y = layout.channels.y + (channelIndex + 0.5) * layout.channelHeight
			+ (offsets.get(event.id) || 0);
		return { x, y, time, channelIndex };
	}

	#drawEvents(context, layout, project) {
		const offsets = this.#eventLaneOffsets(project.events);
		const activeChannelIds = this.renderIndex?.activeChannelIds
			|| new Set(project.channels.filter(channel => channel.active !== false).map(channel => channel.id));
		const beginning = project.editor.visibleRangeBeginning;
		const ending = project.editor.visibleRangeEnd;
		const records = this.renderIndex?.timelineRecords(beginning, ending)
			|| project.events.map(event => ({ event }));
		for (const record of records) {
			const { event } = record;
			const interactive = activeChannelIds.has(event.channel);
			const position = this.#eventPosition(event, layout, project, offsets, record);
			if (!position) continue;
			const endTime = record.end ?? (DURATION_TYPES.has(event.type)
				? this.timing.beatToSeconds(Rational.from(event.time).add(event.duration || [0, 1, 1]))
				: position.time);
			const endX = this.#timeToX(endTime, layout.channels.width);
			if (Math.max(position.x, endX) < -20 || Math.min(position.x, endX) > layout.channels.width + 20) continue;
			const selected = Boolean(event.selected);
			const color = selected ? "#ff3158" : NOTE_COLORS[event.type] || "#d5dade";
			context.save();
			if (!interactive) context.globalAlpha = 0.28;
			if (DURATION_TYPES.has(event.type)) {
				context.strokeStyle = color;
				context.globalAlpha *= selected ? 0.92 : 0.58;
				context.lineWidth = event.type === "hold" ? 8 : 6;
				context.beginPath();
				context.moveTo(position.x, position.y);
				context.lineTo(endX, position.y);
				context.stroke();
				context.globalAlpha = interactive ? 1 : 0.28;
				if (interactive) this.hitRegions.push({
					type: "event", event, x: Math.min(position.x, endX) - 5,
					y: position.y - 8, width: Math.abs(endX - position.x) + 10, height: 16,
				});
			}
			this.#drawEventIcon(context, event, position.x, position.y, color);
			if (interactive) {
				this.eventCenters.push({ event, x: position.x, y: position.y });
				this.hitRegions.push({ type: "event", event, x: position.x - 12, y: position.y - 12, width: 24, height: 24 });
			}
			if ((event.type === "bigText" || event.type === "comment") && event.text) {
				context.save();
				context.fillStyle = color;
				context.font = "11px sans-serif";
				context.textBaseline = "bottom";
				context.fillText(String(event.text).slice(0, 40), Math.min(position.x, endX) + 3, position.y - 8,
					Math.max(30, Math.abs(endX - position.x) - 6));
				context.restore();
			}
			if (interactive && selected && DURATION_TYPES.has(event.type)) {
				this.#drawDiamond(context, endX, position.y, 7);
				this.hitRegions.push({ type: "duration", event, x: endX - 7, y: position.y - 7, width: 14, height: 14 });
			}
			context.restore();
		}
	}

	#drawEventIcon(context, event, x, y, color) {
		context.save();
		context.fillStyle = color;
		context.strokeStyle = color;
		context.lineWidth = 2;
		if (["grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"].includes(event.type)) {
			drawPatternIcon(context, event.type, x, y, 8, color);
		} else if (event.type === "bigText") {
			context.font = "bold 13px sans-serif";
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillText("T", x, y);
		} else if (event.type === "comment") {
			context.beginPath();
			context.moveTo(x - 8, y - 6);
			context.lineTo(x + 8, y - 6);
			context.lineTo(x + 8, y + 4);
			context.lineTo(x + 2, y + 4);
			context.lineTo(x - 2, y + 8);
			context.lineTo(x - 2, y + 4);
			context.lineTo(x - 8, y + 4);
			context.closePath();
			context.stroke();
		} else if (event.type === "bgNote") {
			context.beginPath();
			for (let index = 0; index < 6; index += 1) {
				const angle = index * Math.PI / 3;
				const px = x + Math.cos(angle) * 9;
				const py = y + Math.sin(angle) * 9;
				if (!index) context.moveTo(px, py); else context.lineTo(px, py);
			}
			context.closePath();
			context.fill();
		} else if (event.type === "drag") {
			context.beginPath();
			context.arc(x, y, 6, 0, Math.PI * 2);
			context.stroke();
			context.beginPath();
			context.arc(x, y, 2.5, 0, Math.PI * 2);
			context.fill();
		} else {
			context.beginPath();
			context.arc(x, y, 8, 0, Math.PI * 2);
			context.fill();
			if (event.text) {
				context.fillStyle = "#111417";
				context.font = "bold 8px sans-serif";
				context.textAlign = "center";
				context.textBaseline = "middle";
				context.fillText(String(event.text).slice(0, 3), x, y);
			}
		}
		context.restore();
	}

	#drawDiamond(context, x, y, size = 10) {
		context.save();
		context.translate(x, y);
		context.rotate(Math.PI / 4);
		context.fillStyle = "#f6f7f8";
		context.strokeStyle = "#111417";
		context.lineWidth = 1;
		context.fillRect(-size / 2, -size / 2, size, size);
		context.strokeRect(-size / 2, -size / 2, size, size);
		context.restore();
	}

	#drawTipPointMarker(context, point, scale) {
		if (!point || scale <= 0) return;
		context.save();
		context.translate(point.x, point.y);
		context.rotate(point.angle || 0);
		context.scale(scale, scale);
		context.fillStyle = "#101215";
		context.strokeStyle = "#ffe331";
		context.lineWidth = 1.2;
		context.beginPath();
		context.arc(0, 0, 4.5, 0, Math.PI * 2);
		context.fill();
		context.stroke();
		context.beginPath();
		context.moveTo(2.5, -3.2);
		context.lineTo(7, 0);
		context.lineTo(2.5, 3.2);
		context.closePath();
		context.fill();
		context.stroke();
		context.restore();
	}

	#drawTipPointLines(context, layout, project, now) {
		const offsets = this.#eventLaneOffsets(project.events);
		const beginning = project.editor.visibleRangeBeginning;
		const ending = project.editor.visibleRangeEnd;
		const guides = this.renderIndex?.timelineTipGuides(beginning, ending)
			|| buildTipPointGuides(project, this.timing);
		const activeChannelIds = this.renderIndex?.activeChannelIds
			|| new Set(project.channels.filter(channel => channel.active !== false).map(channel => channel.id));
		for (const guide of guides) {
			const checkpoints = this.#tipPointCheckpoints(guide, layout, project, offsets);
			if (!checkpoints) continue;
			const line = tipPointPathBetween(timelineTipConnector(checkpoints), beginning, ending);
			context.save();
			if (!activeChannelIds.has(guide.events[0]?.channel)) context.globalAlpha = 0.28;
			context.strokeStyle = "rgba(255,255,255,0.24)";
			context.lineWidth = 5;
			context.lineCap = "round";
			context.lineJoin = "round";
			context.beginPath();
			line.forEach((point, index) => {
				if (!index) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
			});
			if (line.length > 1) context.stroke();
			const visual = tipPointVisualState(checkpoints, now);
			if (!visual) {
				context.restore();
				continue;
			}
			drawTipPointTrail(context, visual.trail, 5, visual.scale, visual.alpha, 0.64);
			this.#drawTipPointMarker(context, visual.head, visual.scale);
			context.restore();
		}
	}

	#tipPointCheckpoints(guide, layout, project, offsets) {
		const signature = `${layout.channels.width}:${layout.channels.y}:${layout.channelHeight}:${this.channelOffset}`;
		if (this.tipPointCheckpointCache?.index !== this.renderIndex
			|| this.tipPointCheckpointCache.signature !== signature) {
			this.tipPointCheckpointCache = { index: this.renderIndex, signature, guides: new WeakMap() };
		}
		const cached = this.tipPointCheckpointCache.guides.get(guide);
		if (cached !== undefined) return cached;
		const channels = this.#visibleChannels(project);
		const channelIndex = channels.findIndex(channel => channel.id === guide.events[0].channel);
		if (channelIndex < 0) {
			this.tipPointCheckpointCache.guides.set(guide, null);
			return null;
		}
		const makePoint = (time, y) => {
			const point = { time, y };
			Object.defineProperty(point, "x", {
				enumerable: true,
				get: () => this.#timeToX(time, layout.channels.width),
			});
			return point;
		};
		const baseY = layout.channels.y + (channelIndex + 0.5) * layout.channelHeight;
		const firstY = baseY + (offsets.get(guide.events[0].id) || 0);
		const checkpoints = [makePoint(guide.spawnTime, firstY)];
		for (let index = 0; index < guide.events.length; index += 1) {
			const event = guide.events[index];
			checkpoints.push(makePoint(guide.eventTimes[index], baseY + (offsets.get(event.id) || 0)));
		}
		this.tipPointCheckpointCache.guides.set(guide, checkpoints);
		return checkpoints;
	}

	#drawBpmChanges(context, rectangle, project) {
		context.save();
		context.font = "bold 11px 'Cascadia Mono', Consolas, monospace";
		context.textBaseline = "bottom";
		for (let index = 0; index < project.timing.bpmChanges.length; index += 1) {
			const change = project.timing.bpmChanges[index];
			const x = this.#timeToX(this.timing.beatToSeconds(change.time), rectangle.width);
			if (x < -40 || x > rectangle.width + 4) continue;
			const text = Number(change.bpm).toFixed(Number.isInteger(change.bpm) ? 0 : 2);
			const metrics = context.measureText(text);
			context.fillStyle = "#d567ff";
			context.fillText(text, x + 3, rectangle.height - 3);
			this.hitRegions.push({ type: "bpm", index, x, y: rectangle.height - 18, width: metrics.width + 7, height: 18 });
		}
		context.restore();
	}

	#drawCurrentLines(context, layout, project, current) {
		const x = this.#timeToX(current, layout.waveform.width);
		context.strokeStyle = "#ffe331";
		context.lineWidth = 2;
		context.beginPath();
		context.moveTo(x, 0);
		context.lineTo(x, layout.waveform.height);
		context.stroke();
		const channels = this.#visibleChannels(project);
		const index = channels.findIndex(channel => channel.id === project.editor.currentChannel);
		if (index >= 0) {
			const top = layout.channels.y + index * layout.channelHeight;
			context.beginPath();
			context.moveTo(x, top);
			context.lineTo(x, top + layout.channelHeight);
			context.stroke();
		}
	}

	#timeBounds(project) {
		const provided = this.callbacks.getTimeBounds?.();
		if (provided) return provided;
		if (this.renderIndex) {
			return [Math.min(0, this.timing.beatToSeconds([0, 0, 1])), this.renderIndex.maximumTime];
		}
		let maximum = 10;
		for (const event of project.events) {
			let endBeat = Rational.from(event.time);
			if (DURATION_TYPES.has(event.type)) endBeat = endBeat.add(event.duration || [0, 1, 1]);
			maximum = Math.max(maximum, this.timing.beatToSeconds(endBeat) + 10);
		}
		return [Math.min(0, this.timing.beatToSeconds([0, 0, 1])), maximum];
	}

	#scrollX(seconds, rectangle, bounds) {
		return rectangle.x + (seconds - bounds[0]) / Math.max(0.001, bounds[1] - bounds[0]) * rectangle.width;
	}

	#drawScrollbar(context, rectangle, project, current) {
		const bounds = this.#timeBounds(project);
		const beginningX = this.#scrollX(project.editor.visibleRangeBeginning, rectangle, bounds);
		const endingX = this.#scrollX(project.editor.visibleRangeEnd, rectangle, bounds);
		const currentX = this.#scrollX(current, rectangle, bounds);
		context.fillStyle = "#15181b";
		context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
		context.strokeStyle = "#56db79";
		context.lineWidth = 3;
		context.beginPath();
		context.moveTo(beginningX, rectangle.y + rectangle.height / 2);
		context.lineTo(endingX, rectangle.y + rectangle.height / 2);
		context.stroke();
		for (const x of [beginningX, endingX]) {
			context.lineWidth = 2;
			context.beginPath();
			context.moveTo(x, rectangle.y + 3);
			context.lineTo(x, rectangle.y + rectangle.height - 3);
			context.stroke();
		}
		context.strokeStyle = "#ffe331";
		context.lineWidth = 2;
		context.beginPath();
		context.moveTo(currentX, rectangle.y + 1);
		context.lineTo(currentX, rectangle.y + rectangle.height - 1);
		context.stroke();
		this.hitRegions.push({ type: "scroll-current", x: currentX - 5, y: rectangle.y, width: 10, height: rectangle.height, bounds, rectangle });
		this.hitRegions.push({ type: "scroll-begin", x: beginningX - 5, y: rectangle.y, width: 10, height: rectangle.height, bounds, rectangle });
		this.hitRegions.push({ type: "scroll-end", x: endingX - 5, y: rectangle.y, width: 10, height: rectangle.height, bounds, rectangle });
		this.hitRegions.push({ type: "scroll-range", x: Math.min(beginningX, endingX), y: rectangle.y + 5,
			width: Math.abs(endingX - beginningX), height: rectangle.height - 10, bounds, rectangle });
		this.hitRegions.push({ type: "scroll-track", x: rectangle.x, y: rectangle.y,
			width: rectangle.width, height: rectangle.height, bounds, rectangle, beginningX, endingX });
	}

	#drawChannelScrollbar(context, layout, project) {
		if (project.channels.length <= 3) return;
		const width = 10;
		const x = layout.channels.width - width;
		context.fillStyle = "#20242a";
		context.fillRect(x, layout.channels.y, width, layout.channels.height);
		const thumbHeight = Math.max(22, layout.channels.height * 3 / project.channels.length);
		const maxOffset = project.channels.length - 3;
		const thumbY = layout.channels.y + (layout.channels.height - thumbHeight) * this.channelOffset / maxOffset;
		context.fillStyle = "#68717a";
		context.fillRect(x + 2, thumbY, width - 4, thumbHeight);
		this.hitRegions.push({ type: "channel-scroll", x, y: layout.channels.y, width, height: layout.channels.height,
			thumbY, thumbHeight, maxOffset });
	}

	#drawSelectionBox(context, rectangle) {
		const x = Math.min(rectangle.x1, rectangle.x2);
		const y = Math.min(rectangle.y1, rectangle.y2);
		const width = Math.abs(rectangle.x2 - rectangle.x1);
		const height = Math.abs(rectangle.y2 - rectangle.y1);
		context.fillStyle = "rgba(48,134,255,0.18)";
		context.strokeStyle = "#72adff";
		context.lineWidth = 1;
		context.fillRect(x, y, width, height);
		context.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width, height);
	}

	#hitTest(point) {
		const priorities = ["scroll-current", "scroll-begin", "scroll-end", "scroll-range", "scroll-track",
			"channel-scroll", "duration", "event", "bpm"];
		for (const type of priorities) {
			for (let index = this.hitRegions.length - 1; index >= 0; index -= 1) {
				const region = this.hitRegions[index];
				if (region.type === type && point.x >= region.x && point.x <= region.x + region.width
					&& point.y >= region.y && point.y <= region.y + region.height) return region;
			}
		}
		return null;
	}

	#pointerDown(event) {
		if (event.button !== 0) return;
		event.preventDefault();
		const point = this.surface.toLocal(event);
		const hit = this.#hitTest(point);
		const project = projectState(this.state);
		const layout = this.#layout(this.surface.width, this.surface.height);
		this.pointerMoved = false;
		const playing = Boolean(this.callbacks.isPlaying?.());
		if (playing && hit?.type === "bpm") return;
		if (hit?.type === "bpm") {
			this.drag = { type: "bpm-click", hit, start: point };
		} else if (hit?.type === "event") {
			if (event.shiftKey) {
				if (playing) return;
				this.callbacks.onRangeSelect?.(hit.event.time, hit.event.channel,
					event.altKey ? "remove" : event.ctrlKey ? "add" : "replace");
				return;
			}
			if (event.altKey) {
				this.callbacks.onSelectEvents?.([hit.event.id], "remove");
				return;
			}
			if (event.ctrlKey && !hit.event.selected) this.callbacks.onSelectEvents?.([hit.event.id], "add");
			else if (!event.ctrlKey && !hit.event.selected) this.callbacks.onSelectEvents?.([hit.event.id], "replace");
			const selectedEvents = project.events.filter(candidate => candidate.selected);
			const simultaneous = selectedEvents.length > 0
				&& selectedEvents.every(candidate => Rational.from(candidate.time).equals(hit.event.time));
			this.drag = {
				type: "event", event: hit.event, start: point,
				startBeat: Rational.from(hit.event.time), copy: event.ctrlKey,
				absoluteBeatSnap: simultaneous,
				collapseSelectionOnClick: !event.ctrlKey && Boolean(hit.event.selected),
			};
		} else if (hit?.type === "duration") {
			const activeChannelIds = this.renderIndex?.activeChannelIds
				|| new Set(project.channels.filter(channel => channel.active !== false).map(channel => channel.id));
			const events = project.events.filter(candidate => candidate.selected
				&& DURATION_TYPES.has(candidate.type) && activeChannelIds.has(candidate.channel));
			const records = events.map(candidate => ({
				event: candidate,
				start: Rational.from(candidate.time),
				end: Rational.from(candidate.time).add(candidate.duration || 0),
			}));
			const aligned = records.length > 0 && records.every(record => record.end.equals(records[0].end));
			this.drag = {
				type: "duration",
				event: hit.event,
				start: point,
				records,
				aligned,
				pointerStartBeat: this.timing.secondsToSnappedBeat(
					this.#xToSeconds(point.x, layout.channels.width), project.editor.subdivision),
			};
		} else if (hit?.type?.startsWith("scroll-")) {
			if (hit.type === "scroll-track") {
				const direction = point.x < Math.min(hit.beginningX, hit.endingX) ? -1 : 1;
				this.callbacks.onPageVisibleRange?.(direction);
				return;
			}
			this.drag = { type: hit.type, hit, start: point,
				beginning: project.editor.visibleRangeBeginning, ending: project.editor.visibleRangeEnd };
			if (hit.type === "scroll-current") this.callbacks.onSeekStart?.();
		} else if (hit?.type === "channel-scroll") {
			this.drag = { type: "channel-scroll", hit, start: point, offset: this.channelOffset };
		} else if (point.y < layout.waveform.height) {
			this.drag = { type: "seek", start: point };
			this.callbacks.onSeekStart?.();
			this.#seekAt(point.x);
		} else if (point.y < layout.scroll.y) {
			const channelIndex = Math.min(layout.visibleCount - 1,
				Math.floor((point.y - layout.channels.y) / layout.channelHeight));
			const channel = this.#visibleChannels(project)[channelIndex];
			if (!channel || channel.active === false) return;
			if (event.shiftKey) {
				if (playing) return;
				const beat = this.timing.secondsToSnappedBeat(this.#xToSeconds(point.x, layout.channels.width), project.editor.subdivision);
				this.callbacks.onRangeSelect?.(beat.toJSON(), channel?.id, event.altKey ? "remove" : event.ctrlKey ? "add" : "replace");
				return;
			} else {
				this.drag = { type: "box", start: point, channelId: channel?.id,
					mode: event.altKey ? "remove" : event.ctrlKey ? "add" : "replace", playing };
			}
		}
		if (!this.drag) return;
		document.addEventListener("pointermove", this.boundMove);
		document.addEventListener("pointerup", this.boundUp, { once: true });
		document.addEventListener("pointercancel", this.boundUp, { once: true });
	}

	#pointerMove(event) {
		if (!this.drag) return;
		const point = this.surface.toLocal(event);
		if (Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 3) this.pointerMoved = true;
		const project = projectState(this.state);
		const layout = this.#layout(this.surface.width, this.surface.height);
		switch (this.drag.type) {
			case "seek":
				this.#seekAt(point.x);
				break;
			case "event": {
				const beginning = this.timing.secondsToSnappedBeat(this.#xToSeconds(this.drag.start.x, layout.channels.width), project.editor.subdivision);
				const ending = this.timing.secondsToSnappedBeat(this.#xToSeconds(point.x, layout.channels.width), project.editor.subdivision);
				const channelDelta = Math.round((point.y - this.drag.start.y) / layout.channelHeight);
				const delta = this.drag.absoluteBeatSnap ? ending.sub(this.drag.startBeat) : ending.sub(beginning);
				this.callbacks.onPreviewMoveEvents?.(delta.toJSON(), channelDelta, this.drag.copy);
				break;
			}
			case "duration": {
				const changes = this.#durationChanges(this.drag, point.x, layout, project);
				if (changes) this.callbacks.onPreviewDurations?.(changes);
				break;
			}
			case "box": {
				if (!this.pointerMoved) break;
				this.selectionBox ||= { x1: this.drag.start.x, y1: this.drag.start.y, x2: point.x, y2: point.y };
				this.selectionBox.x2 = point.x;
				this.selectionBox.y2 = point.y;
				const x1 = Math.min(this.selectionBox.x1, point.x);
				const x2 = Math.max(this.selectionBox.x1, point.x);
				const y1 = Math.min(this.selectionBox.y1, point.y);
				const y2 = Math.max(this.selectionBox.y1, point.y);
				const ids = this.eventCenters.filter(center => center.x >= x1 && center.x <= x2 && center.y >= y1 && center.y <= y2)
					.map(center => center.event.id);
				this.callbacks.onPreviewBoxSelect?.(ids, this.drag.mode);
				this.requestRender();
				break;
			}
			case "scroll-current":
				this.#scrollSeek(point.x, this.drag.hit);
				break;
			case "scroll-begin":
			case "scroll-end":
			case "scroll-range":
				this.#moveVisibleRange(point.x);
				break;
			case "channel-scroll": {
				const available = this.drag.hit.height - this.drag.hit.thumbHeight;
				this.channelOffset = Math.round(Math.max(0, Math.min(1,
					(point.y - layout.channels.y - this.drag.hit.thumbHeight / 2) / Math.max(1, available))) * this.drag.hit.maxOffset);
				this.requestRender();
				break;
			}
		}
	}

	#pointerUp(event) {
		if (!this.drag) return;
		const drag = this.drag;
		const point = this.surface.toLocal(event);
		const project = projectState(this.state);
		const layout = this.#layout(this.surface.width, this.surface.height);
		if (drag.type === "event" && this.pointerMoved) {
			const beginning = this.timing.secondsToSnappedBeat(this.#xToSeconds(drag.start.x, layout.channels.width), project.editor.subdivision);
			const ending = this.timing.secondsToSnappedBeat(this.#xToSeconds(point.x, layout.channels.width), project.editor.subdivision);
			const channelDelta = Math.round((point.y - drag.start.y) / layout.channelHeight);
			const delta = drag.absoluteBeatSnap ? ending.sub(drag.startBeat) : ending.sub(beginning);
			this.callbacks.onMoveEvents?.(delta.toJSON(), channelDelta, drag.copy);
		} else if (drag.type === "event" && drag.collapseSelectionOnClick) {
			this.callbacks.onSelectEvents?.([drag.event.id], "replace");
		} else if (drag.type === "duration" && this.pointerMoved) {
			const changes = this.#durationChanges(drag, point.x, layout, project);
			if (changes) this.callbacks.onResizeEvents?.(changes);
		} else if (drag.type === "box") {
			if (this.pointerMoved) {
				const x1 = Math.min(drag.start.x, point.x);
				const x2 = Math.max(drag.start.x, point.x);
				const y1 = Math.min(drag.start.y, point.y);
				const y2 = Math.max(drag.start.y, point.y);
				this.callbacks.onBoxSelect?.(this.eventCenters.filter(center => center.x >= x1 && center.x <= x2 && center.y >= y1 && center.y <= y2)
					.map(center => center.event.id), drag.mode);
			} else if (!drag.playing) {
				const beat = this.timing.secondsToSnappedBeat(this.#xToSeconds(point.x, layout.channels.width), project.editor.subdivision);
				this.callbacks.onSeekBeat?.(beat.toJSON(), drag.channelId, true);
			}
		}
		this.callbacks.onEndPreview?.();
		if (drag.type === "seek" || drag.type === "scroll-current") this.callbacks.onSeekEnd?.();
		this.selectionBox = null;
		this.drag = null;
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		this.requestRender();
	}

	#doubleClick(event) {
		if (this.callbacks.isPlaying?.()) return;
		const hit = this.#hitTest(this.surface.toLocal(event));
		if (hit?.type === "bpm") this.callbacks.onEditBpm?.(hit.index);
	}

	#seekAt(x) {
		const project = projectState(this.state);
		const beat = this.timing.secondsToSnappedBeat(this.#xToSeconds(x, this.surface.width), project.editor.subdivision);
		(this.callbacks.onPreviewSeekBeat || this.callbacks.onSeekBeat)?.(beat.toJSON(), null, false);
	}

	#scrollSeek(x, hit) {
		const progress = Math.max(0, Math.min(1, (x - hit.rectangle.x) / hit.rectangle.width));
		const seconds = hit.bounds[0] + progress * (hit.bounds[1] - hit.bounds[0]);
		const project = projectState(this.state);
		const beat = this.timing.secondsToSnappedBeat(seconds, project.editor.subdivision);
		(this.callbacks.onPreviewSeekBeat || this.callbacks.onSeekBeat)?.(beat.toJSON(), null, false);
	}

	#durationChanges(drag, x, layout, project) {
		const pointerBeat = this.timing.secondsToSnappedBeat(
			this.#xToSeconds(x, layout.channels.width), project.editor.subdivision);
		const delta = pointerBeat.sub(drag.pointerStartBeat);
		const changes = [];
		for (const record of drag.records) {
			const end = drag.aligned ? pointerBeat : record.end.add(delta);
			const duration = end.sub(record.start);
			const comparison = duration.compare(0);
			if (comparison < 0 || (comparison === 0 && !ZERO_DURATION_TYPES.has(record.event.type))) return null;
			changes.push({ id: record.event.id, duration: duration.toJSON() });
		}
		return changes;
	}

	#moveVisibleRange(x) {
		const drag = this.drag;
		const hit = drag.hit;
		const progress = Math.max(0, Math.min(1, (x - hit.rectangle.x) / hit.rectangle.width));
		const seconds = hit.bounds[0] + progress * (hit.bounds[1] - hit.bounds[0]);
		if (drag.type === "scroll-begin") {
			this.callbacks.onVisibleRange?.(Math.min(seconds, drag.ending - 0.01), drag.ending);
		} else if (drag.type === "scroll-end") {
			this.callbacks.onVisibleRange?.(drag.beginning, Math.max(seconds, drag.beginning + 0.01));
		} else {
			const startSeconds = hit.bounds[0] + (drag.start.x - hit.rectangle.x) / hit.rectangle.width * (hit.bounds[1] - hit.bounds[0]);
			const delta = seconds - startSeconds;
			const span = drag.ending - drag.beginning;
			let beginning = drag.beginning + delta;
			beginning = Math.max(hit.bounds[0], Math.min(hit.bounds[1] - span, beginning));
			this.callbacks.onVisibleRange?.(beginning, beginning + span);
		}
	}

	#wheel(event) {
		event.preventDefault();
		const project = projectState(this.state);
		if (project.channels.length > 3 && event.shiftKey) {
			this.channelOffset = Math.max(0, Math.min(project.channels.length - 3,
				this.channelOffset + Math.sign(event.deltaY)));
			this.requestRender();
			return;
		}
		this.callbacks.onWheel?.(event);
	}

	destroy() {
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		cancelAnimationFrame(this.renderAnimationFrame);
		cancelAnimationFrame(this.pointerMoveAnimationFrame);
		this.surface.destroy();
	}
}

export { BEAT_LINE_COLORS };
