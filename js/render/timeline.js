import { Rational } from "../core/rational.js";
import { resolveAttachedPosition } from "../core/geometry.js";
import { descendants, eventTime, flattenEvents } from "../core/grouping.js";
import { eventClickSelectionMode } from "./selection.js";
import { PixiCanvasSurface } from "./pixi-surface.js";
import { ChartRenderIndex } from "./chart-index.js";
import {
	buildTipPointGuides,
	drawTipPointTrail,
	tipPointPathBetween,
	tipPointSpawnPosition,
	tipPointVisualState,
} from "./stage.js";
import {
	BEAT_LINE_COLORS,
	TIMELINE_COMMENT_TEXT_COLOR,
	TIMELINE_DURATION_TYPES as DURATION_TYPES,
	TIMELINE_EVENT_COLORS as NOTE_COLORS,
	currentSeconds,
	drawTimelineEventIcon,
	eventDrawLayer,
	isBackgroundEvent,
	projectState,
	relativeBeatColor,
	timelineTipSegments,
	tipSpawnDirectionSegment,
	timelineTipCheckpointSignature,
	timingFor,
} from "./timeline-helpers.js";
export { timelineTipConnector } from "./timeline-helpers.js";
import { installTraitMembers } from "../core/mixin.js";
import { TimelineDrawingTrait } from "./timeline-drawing.js";
import { TimelinePointerTrait } from "./timeline-pointer.js";
import { TimelineMarkersTrait } from "./timeline-markers.js";
import { visibleTimelineChannels } from "./timeline-helpers.js";
import {
	abLoopMarks,
	bpmFromDrag,
	chaseChannelDelta,
	chaseFraction,
	CHASE_SPEED,
	offsetFromDrag,
} from "./timeline-gestures.js";


export class TimelineView {
	constructor(host, callbacks = {}) {
		this.host = host;
		this.callbacks = callbacks;
		this.surface = new PixiCanvasSurface(host, {
			background: "#090a0c",
			onResize: () => {
				this.render();
				this.callbacks.onTimelineResize?.();
			},
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
		this.spaceHeld = false;
		this.offsetAdjustment = false;
		this.spaceKeyDown = event => {
			if (event.code === "Space" || event.key === " ") {
				this.spaceHeld = true;
			}
		};
		this.spaceKeyUp = event => {
			if (event.code === "Space" || event.key === " ") {
				this.spaceHeld = false;
			}
		};
		document.addEventListener("keydown", this.spaceKeyDown, true);
		document.addEventListener("keyup", this.spaceKeyUp, true);
		// v21: holding Ctrl+Alt enlarges the duration tail handles, so the modifier pair is
		// tracked here and a change asks for a repaint to resize them live.
		this.ctrlAltHeld = false;
		this.ctrlAltListener = event => {
			const held = event.type === "keydown" && Boolean(event.ctrlKey && event.altKey);
			if (held !== this.ctrlAltHeld) {
				this.ctrlAltHeld = held;
				this.requestRender();
			}
		};
		document.addEventListener("keydown", this.ctrlAltListener, true);
		document.addEventListener("keyup", this.ctrlAltListener, true);
		this.boundMove = event => this._queuePointerMove(event);
		this.boundUp = event => {
			this._flushPointerMove();
			this._pointerUp(event);
		};
		this.surface.ready.then(() => {
			this.surface.canvas.addEventListener("pointerdown", event => this._pointerDown(event));
			this.surface.canvas.addEventListener("dblclick", event => this._doubleClick(event));
			this.surface.canvas.addEventListener("wheel", event => this._wheel(event), { passive: false });
			this.render();
		});
	}

	setState(state, options = {}) {
		this.state = state;
		const project = projectState(state);
		const maxOffset = Math.max(0, visibleTimelineChannels(project).length - 3);
		const savedOffset = Number(project.editor?.timelineChannelOffset);
		this.channelOffset = Number.isFinite(savedOffset)? Math.max(0, Math.min(maxOffset, Math.round(savedOffset))): 0;
		this.renderIndex =
			state?.renderIndex ||
			new ChartRenderIndex(project, timingFor(state), {
				noteSpeed: state?.preferences?.noteSpeed,
			});
		this.timing = this.renderIndex.timing;
		if (options.render !== false) {
			this.render();
		}
	}

	render() {
		if (this.renderAnimationFrame) {
			cancelAnimationFrame(this.renderAnimationFrame);
			this.renderAnimationFrame = 0;
		}
		if (!this.state || !this.surface.context) {
			return;
		}
		this.surface.resize();
		this.surface.render((context, width, height) => this._draw(context, width, height));
	}

	requestRender() {
		if (this.renderAnimationFrame) {
			return;
		}
		this.renderAnimationFrame = requestAnimationFrame(() => {
			this.renderAnimationFrame = 0;
			this.render();
		});
	}

	revealChannel(channelId) {
		const project = projectState(this.state);
		const channels = visibleTimelineChannels(project);
		const index = channels.findIndex(channel => channel.id === channelId);
		if (index < 0) {
			return;
		}
		const nextOffset =
			index < this.channelOffset ? index : index >= this.channelOffset + 3 ? index - 2 : this.channelOffset;
		if (nextOffset !== this.channelOffset) {
			this.channelOffset = nextOffset;
			this.callbacks.onChannelOffset?.(nextOffset);
		}
		this.requestRender();
	}

	scrollChannelsBy(delta) {
		const project = projectState(this.state);
		const maxOffset = Math.max(0, visibleTimelineChannels(project).length - 3);
		const nextOffset = Math.max(0, Math.min(maxOffset, this.channelOffset + Math.sign(Number(delta) || 0)));
		if (nextOffset === this.channelOffset) {
			return nextOffset;
		}
		this.channelOffset = nextOffset;
		this.callbacks.onChannelOffset?.(nextOffset);
		this.requestRender();
		return nextOffset;
	}

	setOffsetAdjustment(active) {
		this.offsetAdjustment = Boolean(active);
		this.requestRender();
		return this.offsetAdjustment;
	}

	// Shifts the visible range towards a pointer that left the timeline horizontally.
	_chaseVisibleRange(x, width) {
		const fraction = chaseFraction(x, width);
		if (!fraction) {
			return;
		}
		const editor = projectState(this.state).editor;
		const span = Math.max(0.001, editor.visibleRangeEnd - editor.visibleRangeBeginning);
		const delta = fraction * span * CHASE_SPEED;
		this.callbacks.onVisibleRange?.(editor.visibleRangeBeginning + delta, editor.visibleRangeEnd + delta);
	}

	_chaseChannels(y, layout) {
		const delta = chaseChannelDelta(y, layout.channels.y, layout.channels.height);
		if (delta) {
			this.scrollChannelsBy(delta);
		}
	}

	_queuePointerMove(event) {
		this.pendingPointerMove = {
			clientX: event.clientX,
			clientY: event.clientY,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
		};
		if (this.pointerMoveAnimationFrame) {
			return;
		}
		this.pointerMoveAnimationFrame = requestAnimationFrame(() => this._flushPointerMove());
	}

	_flushPointerMove() {
		if (this.pointerMoveAnimationFrame) {
			cancelAnimationFrame(this.pointerMoveAnimationFrame);
		}
		this.pointerMoveAnimationFrame = 0;
		const event = this.pendingPointerMove;
		this.pendingPointerMove = null;
		if (event) {
			this._pointerMove(event);
		}
	}

	_layout(width, height) {
		const scrollHeight = 25;
		const project = projectState(this.state);
		const shown = Math.max(1, visibleTimelineChannels(project).length);
		const visibleLimit = Math.max(1, Number(project.preferences?.visibleChannels) || 3);
		const visibleCount = Math.max(1, Math.min(visibleLimit, shown));
		const remaining = Math.max(visibleCount + 1, height - scrollHeight);
		const channelHeight = remaining / (visibleCount + 1);
		const waveformHeight = channelHeight;
		const channelsHeight = channelHeight * visibleCount;
		return {
			waveform: { x: 0, y: 0, width, height: waveformHeight },
			channels: { x: 0, y: waveformHeight, width, height: channelsHeight },
			scroll: { x: 0, y: waveformHeight + channelsHeight, width, height: scrollHeight },
			channelHeight,
			visibleCount,
		};
	}

	_timeToX(seconds, width) {
		const editor = projectState(this.state).editor;
		const span = Math.max(0.001, editor.visibleRangeEnd - editor.visibleRangeBeginning);
		return ((seconds - editor.visibleRangeBeginning) / span) * width;
	}

	_xToSeconds(x, width) {
		const editor = projectState(this.state).editor;
		return (
			editor.visibleRangeBeginning +
			(x / Math.max(1, width)) * (editor.visibleRangeEnd - editor.visibleRangeBeginning)
		);
	}

	_draw(context, width, height) {
		const project = projectState(this.state);
		const layout = this._layout(width, height);
		const editor = project.editor;
		const current = currentSeconds(this.state, this.timing);
		this.hitRegions = [];
		this.eventCenters = [];

		context.fillStyle = "#090a0c";
		context.fillRect(0, 0, width, height);
		this._drawWaveform(context, layout.waveform, editor);
		this._drawLoopWaveformRange(context, layout.waveform, editor);
		this._drawChannels(context, layout, project);
		this._drawBeatLines(context, layout, editor);
		this._drawLoopBeatLines(context, layout, editor);
		this._drawTipPointSwitches(context, layout, project);
		this._drawTipPointLines(context, layout, project, current);
		this._drawEvents(context, layout, project);
		this._drawSelectedEventMarkers(context, layout, project);
		this._drawBpmChanges(context, layout.waveform, project);
		this._drawCurrentLines(context, layout, project, current);
		this._drawScrollbar(context, layout.scroll, project, current);
		this._drawChannelScrollbar(context, layout, project);
		if (this.selectionBox) {
			this._drawSelectionBox(context, this.selectionBox);
		}
	}

	// v22: hidden channels collapse out of the timeline, so the lanes only ever show the
	// non-hidden channels; the channel offset scrolls over that collapsed list.
	_visibleChannels(project) {
		const channels = visibleTimelineChannels(project);
		const visibleLimit = Math.max(1, Number(project.preferences?.visibleChannels) || 3);
		const maxOffset = Math.max(0, channels.length - visibleLimit);
		this.channelOffset = Math.max(0, Math.min(this.channelOffset, maxOffset));
		return channels.slice(this.channelOffset, this.channelOffset + visibleLimit);
	}

	_eventLaneOffsets(events) {
		if (this.renderIndex) {
			return this.renderIndex.eventLaneOffsets;
		}
		const groups = new Map();
		for (const event of events) {
			const key = `${event.channel}:${Rational.from(event.time).toString()}`;
			if (!groups.has(key)) {
				groups.set(key, []);
			}
			groups.get(key).push(event);
		}
		const offsets = new Map();
		for (const simultaneous of groups.values()) {
			simultaneous.forEach((event, index) => offsets.set(event.id, (index - (simultaneous.length - 1) / 2) * 7));
		}
		return offsets;
	}

	_eventPosition(event, layout, project, offsets, record = null) {
		const visibleChannels = this._visibleChannels(project);
		const channelIndex = visibleChannels.findIndex(channel => channel.id === event.channel);
		if (channelIndex < 0) {
			return null;
		}
		const time =
			record?.start ?? this.renderIndex?.recordFor(event)?.start ?? this.timing.beatToSeconds(event.time);
		const x = this._timeToX(time, layout.channels.width);
		const y = layout.channels.y + (channelIndex + 0.5) * layout.channelHeight + (offsets.get(event.id) || 0);
		return { x, y, time, channelIndex };
	}

	// Same mapping as _eventPosition, but for every channel/time — even ones currently
	// scrolled out of the timeline viewport. Rubber-band hit testing uses this so the
	// selection region is content-space, not "what the last paint happened to draw".
	_contentLanePosition(event, layout, project, offsets, record = null) {
		const channelIndex = visibleTimelineChannels(project).findIndex(channel => channel.id === event.channel);
		if (channelIndex < 0) {
			return null;
		}
		const time =
			record?.start ?? this.renderIndex?.recordFor(event)?.start ?? this.timing.beatToSeconds(event.time);
		const x = this._timeToX(time, layout.channels.width);
		const y =
			layout.channels.y +
			(channelIndex - this.channelOffset + 0.5) * layout.channelHeight +
			(offsets.get(event.id) || 0);
		return { x, y, time, channelIndex };
	}

	_timeBounds(project) {
		const provided = this.callbacks.getTimeBounds?.();
		if (provided) {
			return provided;
		}
		if (this.renderIndex) {
			return [Math.min(0, this.timing.beatToSeconds([0, 0, 1])), this.renderIndex.maximumTime];
		}
		let maximum = 10;
		for (const event of flattenEvents(project.events || [], false)) {
			let endBeat = Rational.from(event.time);
			if (DURATION_TYPES.has(event.type)) {
				endBeat = endBeat.add(event.duration || [0, 1, 1]);
			}
			maximum = Math.max(maximum, this.timing.beatToSeconds(endBeat) + 10);
		}
		return [Math.min(0, this.timing.beatToSeconds([0, 0, 1])), maximum];
	}

	_scrollX(seconds, rectangle, bounds) {
		return rectangle.x + ((seconds - bounds[0]) / Math.max(0.001, bounds[1] - bounds[0])) * rectangle.width;
	}

	destroy() {
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		cancelAnimationFrame(this.renderAnimationFrame);
		cancelAnimationFrame(this.pointerMoveAnimationFrame);
		this.surface.destroy();
		document.removeEventListener("keydown", this.spaceKeyDown, true);
		document.removeEventListener("keyup", this.spaceKeyUp, true);
		document.removeEventListener("keydown", this.ctrlAltListener, true);
		document.removeEventListener("keyup", this.ctrlAltListener, true);
	}
}

// The painting and the pointer handling are large enough to live in their own modules; their
// methods are installed onto the prototype so that callers keep seeing one class.
installTraitMembers(TimelineView.prototype, TimelineDrawingTrait.prototype);
installTraitMembers(TimelineView.prototype, TimelinePointerTrait.prototype);
installTraitMembers(TimelineView.prototype, TimelineMarkersTrait.prototype);

export { BEAT_LINE_COLORS };
