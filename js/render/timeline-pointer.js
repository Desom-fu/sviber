import { Rational } from "../core/rational.js";
import { descendants, eventTime, flattenEvents } from "../core/grouping.js";
import { eventClickSelectionMode } from "./selection.js";
import {
	TIMELINE_DURATION_TYPES as DURATION_TYPES,
	ZERO_DURATION_TYPES, projectState,
	isBackgroundEvent,
} from "./timeline-helpers.js";
import { abLoopDragMarks, abLoopGrabIndex, bpmFromDrag, offsetFromDrag } from "./timeline-gestures.js";

// Pointer handling of the timeline: hit testing its widgets, the press, drag and release
// cycle that seeks, moves events, stretches durations, drags the scrollbars, marks an A-B
// loop and adjusts the timing offset, plus the wheel gestures that zoom and scroll.

// Alt removes from the selection, Ctrl adds to it, a plain gesture replaces it.
function rangeSelectMode(event) {
	if (event.altKey) {
		return "remove";
	}
	return event.ctrlKey ? "add" : "replace";
}

// One handler per drag kind of the timeline.
const TIMELINE_MOVE_HANDLERS = {
	"viewport-pan": "_movePan",
	seek: "_moveSeek",
	"ab-loop": "_moveAbLoop",
	"offset-adjust": "_moveOffsetAdjust",
	"bpm-adjust": "_moveBpmAdjust",
	event: "_moveEvents",
	duration: "_moveDurations",
	box: "_moveSelectionBox",
	"scroll-current": "_moveScrollCurrent",
	"scroll-ctrl": "_moveScrollCtrl",
	"scroll-begin": "_moveVisibleRangeDrag",
	"scroll-end": "_moveVisibleRangeDrag",
	"scroll-range": "_moveVisibleRangeDrag",
	"channel-scroll": "_moveChannelScroll",
};

export class TimelinePointerTrait {

	_hitTest(point) {
		const priorities = [
			"scroll-current",
			"scroll-begin",
			"scroll-end",
			"scroll-range",
			"scroll-track",
			"channel-scroll",
			"duration",
			"event",
			"bpm",
		];
		for (const type of priorities) {
			for (let index = this.hitRegions.length - 1; index >= 0; index -= 1) {
				const region = this.hitRegions[index];
				if (
					region.type === type &&
					point.x >= region.x &&
					point.x <= region.x + region.width &&
					point.y >= region.y &&
					point.y <= region.y + region.height
				) {
					return region;
				}
			}
		}
		return null;
	}

	_listenForDrag() {
		document.addEventListener("pointermove", this.boundMove);
		document.addEventListener("pointerup", this.boundUp, { once: true });
		document.addEventListener("pointercancel", this.boundUp, { once: true });
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
		const point = this.surface.toLocal(event);
		const hit = this._hitTest(point);
		const project = projectState(this.state);
		const layout = this._layout(this.surface.width, this.surface.height);
		this.pointerMoved = false;
		const playing = Boolean(this.callbacks.isPlaying?.());
		if (event.ctrlKey && this.spaceHeld) {
			this.drag = {
				type: "viewport-pan",
				start: point,
				beginning: project.editor.visibleRangeBeginning,
				ending: project.editor.visibleRangeEnd,
				width: this.surface.width,
			};
			this._listenForDrag();
			return;
		}
		if (playing && hit?.type === "bpm") {
			return;
		}
		this.drag = this._timelineDrag(event, { point, hit, project, layout, playing });
		if (this.drag) {
			this._listenForDrag();
		}
	}

	// Decides what a press on the timeline starts to drag, or returns null when the press only
	// changed the selection, seeked, or is not allowed during playback.
	_timelineDrag(event, context) {
		const { point, hit, project, layout, playing } = context;
		if (hit?.type === "bpm") {
			return { type: "bpm-click", hit, start: point };
		}
		if (hit?.type === "event") {
			return this._eventPressDrag(event, context);
		}
		if (hit?.type === "duration") {
			return this._durationPressDrag(context);
		}
		if (hit?.type?.startsWith("scroll-")) {
			return this._scrollbarPressDrag(event, context);
		}
		if (hit?.type === "channel-scroll") {
			return { type: "channel-scroll", hit, start: point, offset: this.channelOffset };
		}
		if (point.y < layout.waveform.height) {
			// v18 fix: the waveform press builds its own drag (seek, A-B loop or offset
			// adjustment). Returning it is what makes `_pointerDown` listen for the move and
			// release events, so the current time follows the pointer and snaps when let go.
			return this._waveformPointerDown(event, point, project, layout, playing);
		}
		if (point.y < layout.scroll.y) {
			return this._channelLanePressDrag(event, context);
		}
		return null;
	}

	// Selected leaf events, expanding a selected group into the events it contains.
	// Locked events (v19) behave as if they were not selected.
	_selectedLeafEvents(project) {
		const roots = flattenEvents(project.events || [], true).filter(
			candidate =>
				candidate.selected &&
				!candidate.locked &&
				!(this.renderIndex?.ancestorsById.get(candidate.id) || []).some(ancestor => ancestor.selected),
		);
		const leaves = roots.flatMap(candidate => {
			if (candidate.type !== "group") {
				return [candidate];
			}
			return descendants(candidate).filter(item => item.type !== "group" && !item.locked);
		});
		return [...new Set(leaves)];
	}

	// Shift range selects, Alt deselects, and a plain press starts a time drag. A selection
	// that sits entirely on one beat is dragged by absolute beat so that it stays aligned.
	_eventPressDrag(event, { point, hit, project, playing }) {
		const selectionEvent = this.renderIndex?.selectionTarget(hit.event) || hit.event;
		const selected = this.renderIndex?.isEventSelected(selectionEvent) ?? Boolean(selectionEvent.selected);
		if (event.shiftKey) {
			if (!playing) {
				this.callbacks.onRangeSelect?.(hit.event.time, hit.event.channel, rangeSelectMode(event));
			}
			return null;
		}
		const selectionMode = eventClickSelectionMode({ selected, ctrlKey: event.ctrlKey, altKey: event.altKey });
		if (selectionMode === "remove" && event.altKey) {
			this.callbacks.onSelectEvents?.([selectionEvent.id], "remove");
			return null;
		}
		if (!selected) {
			this.callbacks.onSelectEvents?.([selectionEvent.id], selectionMode);
		}
		// v20: a locked event behaves as if it were not selected, so a press may select it
		// but never starts a time drag.
		if (selectionEvent.locked) {
			return null;
		}
		const selectedEvents = this._selectedLeafEvents(project);
		const simultaneous =
			selectedEvents.length > 0 &&
			selectedEvents.every(candidate => Rational.from(eventTime(candidate)).equals(hit.event.time));
		return {
			type: "event",
			event: hit.event,
			selectionId: selectionEvent.id,
			start: point,
			startBeat: Rational.from(hit.event.time),
			copy: event.ctrlKey,
			absoluteBeatSnap: simultaneous,
			collapseSelectionOnClick: selectionMode === "remove",
		};
	}

	// Dragging one duration handle stretches every selected event with a duration; when they
	// all end on the same beat they keep ending together.
	_durationPressDrag({ point, hit, project, layout }) {
		const activeChannelIds = this._activeChannelIds(project);
		const events = flattenEvents(project.events || [], true).filter(
			candidate =>
				candidate.selected &&
				!candidate.locked &&
				DURATION_TYPES.has(candidate.type) &&
				activeChannelIds.has(candidate.channel),
		);
		const records = events.map(candidate => ({
			event: candidate,
			start: Rational.from(candidate.time),
			end: Rational.from(candidate.time).add(candidate.duration || 0),
		}));
		const aligned = records.length > 0 && records.every(record => record.end.equals(records[0].end));
		return {
			type: "duration",
			event: hit.event,
			start: point,
			records,
			aligned,
			pointerStartBeat: this.timing.secondsToSnappedBeat(
				this._xToSeconds(point.x, layout.channels.width),
				project.editor.subdivision,
			),
		};
	}

	// Pressing the empty part of the scrollbar track jumps there instead of paging. A
	// Ctrl press anywhere on the scrollbar (v19) sets the current time instead: it snaps
	// to subdivisions, and when the visible range contained the current time the range
	// slides along so the current time keeps its position inside the range.
	_scrollbarPressDrag(event, { point, hit, project }) {
		if (event.ctrlKey) {
			const beginning = Number(project.editor.visibleRangeBeginning);
			const ending = Number(project.editor.visibleRangeEnd);
			const editor = project.editor;
			let current = Number(editor.currentTime) || 0;
			if (editor.timeSnapped !== false) {
				current = this.timing.beatToSeconds(editor.currentTime || [0, 0, 1]);
			}
			const drag = {
				type: "scroll-ctrl",
				hit,
				start: point,
				beginning,
				ending,
				followRange: current >= beginning && current <= ending,
				offsetInside: current - beginning,
			};
			this.callbacks.onSeekStart?.();
			this._scrollCtrlSeek(point.x, drag, project);
			return drag;
		}
		if (hit.type === "scroll-track") {
			this._scrollSeek(point.x, hit, true);
			return null;
		}
		if (hit.type === "scroll-current") {
			this.callbacks.onSeekStart?.();
		}
		return {
			type: hit.type,
			hit,
			start: point,
			beginning: project.editor.visibleRangeBeginning,
			ending: project.editor.visibleRangeEnd,
		};
	}

	// Pressing a lane either range selects with Shift or rubber-bands a selection box.
	_channelLanePressDrag(event, { point, project, layout, playing }) {
		const channelIndex = Math.min(
			layout.visibleCount - 1,
			Math.floor((point.y - layout.channels.y) / layout.channelHeight),
		);
		const channel = this._visibleChannels(project)[channelIndex];
		if (!channel || channel.active === false) {
			return null;
		}
		if (event.shiftKey) {
			if (!playing) {
				const seconds = this._xToSeconds(point.x, layout.channels.width);
				const beat = this.timing.secondsToSnappedBeat(seconds, project.editor.subdivision);
				this.callbacks.onRangeSelect?.(beat.toJSON(), channel?.id, rangeSelectMode(event));
			}
			return null;
		}
		return {
			type: "box",
			start: point,
			// Content-space origin so edge-chase scrolling keeps the rubber-band corner fixed on the chart.
			startSeconds: this._xToSeconds(point.x, layout.channels.width),
			startChannelIndex:
				(point.y - layout.channels.y) / layout.channelHeight + this.channelOffset,
			channelId: channel?.id,
			mode: rangeSelectMode(event),
			playing,
		};
	}

	// Returns the drag the press starts so that `_timelineDrag` can hand it to `_pointerDown`.
	_waveformPointerDown(event, point, project, layout, playing) {
		const seconds = this._xToSeconds(point.x, layout.waveform.width);
		if (event.shiftKey && !playing) {
			return this._abLoopPointerDown(point, project, layout, seconds);
		}
		if (this.offsetAdjustment && !event.altKey && !playing) {
			return this._offsetAdjustPointerDown(event, point, project, seconds);
		}
		this.callbacks.onSeekStart?.();
		this._seekAt(point.x);
		return { type: "seek", start: point };
	}

	// v18: Shift-pressing the waveform either grabs the A-B loop mark under the pointer and
	// moves it, or starts a fresh pair at the pressed subdivision. Either way the mark that
	// follows the pointer is the one that is not the anchor, so the drag and the release share
	// one code path.
	_abLoopPointerDown(point, project, layout, seconds) {
		const existing = (Array.isArray(project.editor.abLoopMarks) ? project.editor.abLoopMarks : [])
			.slice(0, 2)
			.map(mark => Rational.from(mark));
		const grabbed = abLoopGrabIndex(
			existing.map(mark => this.timing.beatToSeconds(mark)),
			point.x,
			value => this._timeToX(value, layout.waveform.width),
		);
		const beat = this.timing.secondsToSnappedBeat(seconds, project.editor.subdivision);
		// Grabbing a mark keeps the other one as the anchor; pressing elsewhere throws away a
		// complete pair and makes the pressed subdivision the anchor of a new one.
		const anchor = grabbed == null ? beat : (existing.find((_, index) => index !== grabbed) ?? null);
		this.callbacks.onAbLoopMarks?.(abLoopDragMarks(anchor, beat), false);
		return { type: "ab-loop", start: point, anchorBeat: anchor, movingBeat: beat, grabbed: grabbed != null };
	}

	_offsetAdjustPointerDown(event, point, project, seconds) {
		const timing = this.timing;
		const beatNumber = timing.secondsToBeatNumber(seconds);
		if (!event.ctrlKey) {
			return { type: "offset-adjust", start: point, startSeconds: seconds, offset: timing.offset };
		}
		// v19: the dragged line can also be a subdivision beat line, and the BPM that
		// changes is the last BPM change strictly before it (or the initial BPM when
		// there is no BPM change before the closest beat line).
		const subdivision = Math.max(1, Math.floor(project.editor.subdivision || 1));
		const nearest = Math.round(beatNumber * subdivision) / subdivision;
		const changes = timing.bpmChanges.filter(change => change.time.toNumber() < nearest);
		const anchorBeat = changes.length ? changes.at(-1).time.toNumber() : 0;
		const distance = nearest - anchorBeat;
		this.callbacks.onSeekStart?.();
		return {
			type: "bpm-adjust",
			start: point,
			anchorSeconds: timing.beatToSeconds(anchorBeat),
			beatDistance: distance,
			bpm: timing.bpmAtBeat(anchorBeat),
			changeBeat: changes.length ? changes.at(-1).time.toJSON() : null,
		};
	}

	_pointerMove(event) {
		if (!this.drag) {
			return;
		}
		const point = this.surface.toLocal(event);
		if (Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 3) {
			this.pointerMoved = true;
		}
		const project = projectState(this.state);
		const layout = this._layout(this.surface.width, this.surface.height);
		const handler = TIMELINE_MOVE_HANDLERS[this.drag.type];
		if (handler) {
			this[handler]({ point, project, layout, drag: this.drag });
		}
	}

	_movePan({ point, drag }) {
		const span = drag.ending - drag.beginning;
		const delta = ((point.x - drag.start.x) / Math.max(1, drag.width)) * span;
		this.callbacks.onVisibleRange?.(drag.beginning - delta, drag.ending - delta);
	}

	_moveSeek({ point }) {
		this._seekAt(point.x);
	}

	// Dragging with Shift over the waveform moves one A-B loop mark; the view follows the
	// pointer when it reaches the edge of the visible range. v18: the moving mark may pass the
	// anchor, and the second mark only exists once the pointer reaches another subdivision.
	_moveAbLoop({ point, project, layout, drag }) {
		const seconds = this._xToSeconds(point.x, layout.waveform.width);
		const beat = this.timing.secondsToSnappedBeat(seconds, project.editor.subdivision);
		drag.movingBeat = beat;
		this.callbacks.onAbLoopMarks?.(abLoopDragMarks(drag.anchorBeat, beat), false);
		this._chaseVisibleRange(point.x, layout.waveform.width);
	}

	// Dragging the waveform while the offset adjustment is armed shifts the whole timing map.
	_moveOffsetAdjust({ point, layout, drag }) {
		const seconds = this._xToSeconds(point.x, layout.waveform.width);
		this.callbacks.onAdjustTiming?.({
			offset: offsetFromDrag(drag.offset, drag.startSeconds, seconds),
			final: false,
		});
	}

	// Dragging a later beat line stretches the tempo of the region it belongs to.
	_moveBpmAdjust({ point, layout, drag }) {
		const seconds = this._xToSeconds(point.x, layout.waveform.width);
		const bpm = bpmFromDrag(drag.anchorSeconds, drag.beatDistance, drag.bpm, seconds);
		this.callbacks.onAdjustTiming?.({ bpm, beat: drag.changeBeat, final: false });
	}

	// Events move by the snapped beat distance the pointer covered, or to the absolute snapped
	// beat under the pointer when the whole selection started on one beat.
	_moveEvents({ point, project, layout, drag }) {
		if (!this.pointerMoved) {
			return;
		}
		const snap = x =>
			this.timing.secondsToSnappedBeat(
				this._xToSeconds(x, layout.channels.width),
				project.editor.subdivision,
			);
		const ending = snap(point.x);
		const channelDelta = Math.round((point.y - drag.start.y) / layout.channelHeight);
		const delta = drag.absoluteBeatSnap ? ending.sub(drag.startBeat) : ending.sub(snap(drag.start.x));
		this.callbacks.onPreviewMoveEvents?.(delta.toJSON(), channelDelta, drag.copy);
	}

	_moveDurations({ point, project, layout, drag }) {
		const changes = this._durationChanges(drag, point.x, layout, project);
		if (changes) {
			this.callbacks.onPreviewDurations?.(changes);
		}
	}

	_moveSelectionBox({ point, layout, drag }) {
		if (!this.pointerMoved) {
			return;
		}
		this._chaseVisibleRange(point.x, layout.channels.width);
		this._chaseChannels(point.y, layout);
		const origin = this._selectionBoxOrigin(drag, layout);
		this.selectionBox = { x1: origin.x, y1: origin.y, x2: point.x, y2: point.y };
		this.callbacks.onPreviewBoxSelect?.(
			this._idsInSelectionBox(this.selectionBox, layout, projectState(this.state)),
			drag.mode,
		);
		this.requestRender();
	}

	// Map the press-time content origin back into the current viewport after chase scrolling.
	_selectionBoxOrigin(drag, layout) {
		const startSeconds =
			drag.startSeconds ?? this._xToSeconds(drag.start.x, layout.channels.width);
		const startChannelIndex =
			drag.startChannelIndex ??
			(drag.start.y - layout.channels.y) / layout.channelHeight + this.channelOffset;
		return {
			x: this._timeToX(startSeconds, layout.channels.width),
			y: layout.channels.y + (startChannelIndex - this.channelOffset) * layout.channelHeight,
		};
	}

	// Icon positions in the current viewport mapping, including events scrolled out of view.
	_boxSelectCenters(layout, project) {
		const activeChannelIds =
			this.renderIndex?.activeChannelIds ||
			new Set(project.channels.filter(channel => channel.active !== false).map(channel => channel.id));
		const hideBackground = project.editor?.showBgEventsInTimeline === false;
		const events = flattenEvents(project.events || [], false);
		const offsets = this.renderIndex?.eventLaneOffsets || this._eventLaneOffsets(events);
		const centers = [];
		for (const event of events) {
			if (event.type === "group" || !activeChannelIds.has(event.channel)) {
				continue;
			}
			if (hideBackground && isBackgroundEvent(event)) {
				continue;
			}
			const record = this.renderIndex?.recordFor(event);
			const position = this._contentLanePosition(event, layout, project, offsets, record);
			if (!position) {
				continue;
			}
			const selectionEvent = this.renderIndex?.selectionTarget(event) || event;
			centers.push({ event: selectionEvent, x: position.x, y: position.y });
		}
		return centers;
	}

	_idsInSelectionBox(box, layout, project) {
		const x1 = Math.min(box.x1, box.x2);
		const x2 = Math.max(box.x1, box.x2);
		const y1 = Math.min(box.y1, box.y2);
		const y2 = Math.max(box.y1, box.y2);
		const ids = [];
		const seen = new Set();
		for (const center of this._boxSelectCenters(layout, project)) {
			if (center.x < x1 || center.x > x2 || center.y < y1 || center.y > y2) {
				continue;
			}
			if (seen.has(center.event.id)) {
				continue;
			}
			seen.add(center.event.id);
			ids.push(center.event.id);
		}
		return ids;
	}

	_moveScrollCurrent({ point, drag }) {
		this._scrollSeek(point.x, drag.hit);
	}

	// v19 Ctrl scrollbar gesture: the current time follows the pointer (snapped), and
	// the visible range captured at the press slides by the same amount when it
	// originally contained the current time.
	_moveScrollCtrl({ point, project, drag }) {
		this._scrollCtrlSeek(point.x, drag, project);
	}

	_scrollCtrlSeek(x, drag, project) {
		const hit = drag.hit;
		const progress = Math.max(0, Math.min(1, (x - hit.rectangle.x) / Math.max(1, hit.rectangle.width)));
		const seconds = hit.bounds[0] + progress * (hit.bounds[1] - hit.bounds[0]);
		const beat = this.timing.secondsToSnappedBeat(seconds, project.editor.subdivision);
		(this.callbacks.onPreviewSeekBeat || this.callbacks.onSeekBeat)?.(beat.toJSON(), null, false);
		if (drag.followRange) {
			const span = drag.ending - drag.beginning;
			const snapped = this.timing.beatToSeconds(beat);
			this.callbacks.onVisibleRange?.(snapped - drag.offsetInside, snapped - drag.offsetInside + span);
		}
	}

	_moveVisibleRangeDrag({ point }) {
		this._moveVisibleRange(point.x);
	}

	_moveChannelScroll({ point, layout, drag }) {
		const available = drag.hit.height - drag.hit.thumbHeight;
		const travelled = point.y - layout.channels.y - drag.hit.thumbHeight / 2;
		const progress = Math.max(0, Math.min(1, travelled / Math.max(1, available)));
		const nextOffset = Math.round(progress * drag.hit.maxOffset);
		if (nextOffset !== this.channelOffset) {
			this.channelOffset = nextOffset;
			this.callbacks.onChannelOffset?.(nextOffset);
		}
		this.requestRender();
	}

	_pointerUp(event) {
		if (!this.drag) {
			return;
		}
		const drag = this.drag;
		const point = this.surface.toLocal(event);
		const project = projectState(this.state);
		const layout = this._layout(this.surface.width, this.surface.height);
		if (drag.type === "event" && this.pointerMoved) {
			const beginning = this.timing.secondsToSnappedBeat(
				this._xToSeconds(drag.start.x, layout.channels.width),
				project.editor.subdivision,
			);
			const ending = this.timing.secondsToSnappedBeat(
				this._xToSeconds(point.x, layout.channels.width),
				project.editor.subdivision,
			);
			const channelDelta = Math.round((point.y - drag.start.y) / layout.channelHeight);
			const delta = drag.absoluteBeatSnap ? ending.sub(drag.startBeat) : ending.sub(beginning);
			this.callbacks.onMoveEvents?.(delta.toJSON(), channelDelta, drag.copy);
		} else if (drag.type === "event" && drag.collapseSelectionOnClick) {
			this.callbacks.onSelectEvents?.([drag.selectionId || drag.event.id], "remove");
		} else if (drag.type === "duration" && this.pointerMoved) {
			const changes = this._durationChanges(drag, point.x, layout, project);
			if (changes) {
				this.callbacks.onResizeEvents?.(changes);
			}
		} else if (drag.type === "box") {
			if (this.pointerMoved) {
				const origin = this._selectionBoxOrigin(drag, layout);
				const corner = this.selectionBox? { x: this.selectionBox.x2, y: this.selectionBox.y2 }: point;
				this.callbacks.onBoxSelect?.(
					this._idsInSelectionBox(
						{ x1: origin.x, y1: origin.y, x2: corner.x, y2: corner.y },
						layout,
						project,
					),
					drag.mode,
				);
			} else if (!drag.playing) {
				const beat = this.timing.secondsToSnappedBeat(
					this._xToSeconds(point.x, layout.channels.width),
					project.editor.subdivision,
				);
				this.callbacks.onSeekBeat?.(beat.toJSON(), drag.channelId, true);
			}
		} else if (drag.type === "ab-loop") {
			const seconds = this._xToSeconds(point.x, layout.waveform.width);
			const movingBeat = this.timing.secondsToSnappedBeat(seconds, project.editor.subdivision);
			// v18: when the moved mark ends up on the other mark, only one mark remains.
			this.callbacks.onAbLoopMarks?.(abLoopDragMarks(drag.anchorBeat, movingBeat), true);
		} else if (drag.type === "offset-adjust") {
			const seconds = this._xToSeconds(point.x, layout.waveform.width);
			this.callbacks.onAdjustTiming?.({
				offset: offsetFromDrag(drag.offset, drag.startSeconds, seconds),
				final: true,
			});
			if (!this.pointerMoved) {
				this._seekAt(point.x, true);
			}
		} else if (drag.type === "bpm-adjust") {
			const seconds = this._xToSeconds(point.x, layout.waveform.width);
			const bpm = bpmFromDrag(drag.anchorSeconds, drag.beatDistance, drag.bpm, seconds);
			this.callbacks.onAdjustTiming?.({ bpm, beat: drag.changeBeat, final: true });
			if (!this.pointerMoved) {
				this._seekAt(point.x, true);
			}
		} else if (drag.type === "seek") {
			this._seekAt(point.x, true);
		} else if (drag.type === "scroll-ctrl") {
			this._scrollCtrlSeek(point.x, drag, project);
		}
		this.callbacks.onEndPreview?.();
		if (drag.type === "seek" || drag.type === "scroll-current" || drag.type === "scroll-ctrl") {
			this.callbacks.onSeekEnd?.();
		}
		this.selectionBox = null;
		this.drag = null;
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		this.requestRender();
	}

	_doubleClick(event) {
		if (this.callbacks.isPlaying?.()) {
			return;
		}
		const hit = this._hitTest(this.surface.toLocal(event));
		if (hit?.type === "bpm") {
			this.callbacks.onEditBpm?.(hit.index);
		} else if (hit?.type === "event" && hit.event.type !== "group") {
			this.callbacks.onEnterGroupSelection?.(hit.event.id);
		}
	}

	_seekAt(x, final = false) {
		const seconds = this._xToSeconds(x, this.surface.width);
		// v17: the current time follows the pointer unsnapped while dragging on the
		// waveform, and snaps once the mouse is released (unless the music is playing).
		this.callbacks.onSeekSeconds?.(seconds, final);
	}

	_scrollSeek(x, hit, jumpRange = false) {
		const progress = Math.max(0, Math.min(1, (x - hit.rectangle.x) / Math.max(1, hit.rectangle.width)));
		const seconds = hit.bounds[0] + progress * (hit.bounds[1] - hit.bounds[0]);
		if (jumpRange) {
			this.callbacks.onScrollbarJump?.(seconds);
			return;
		}
		const project = projectState(this.state);
		const beat = this.timing.secondsToSnappedBeat(seconds, project.editor.subdivision);
		(this.callbacks.onPreviewSeekBeat || this.callbacks.onSeekBeat)?.(beat.toJSON(), null, false);
	}

	_durationChanges(drag, x, layout, project) {
		const pointerBeat = this.timing.secondsToSnappedBeat(
			this._xToSeconds(x, layout.channels.width),
			project.editor.subdivision,
		);
		const delta = pointerBeat.sub(drag.pointerStartBeat);
		const changes = [];
		for (const record of drag.records) {
			const end = drag.aligned ? pointerBeat : record.end.add(delta);
			const duration = end.sub(record.start);
			const comparison = duration.compare(0);
			if (comparison < 0 || (comparison === 0 && !ZERO_DURATION_TYPES.has(record.event.type))) {
				return null;
			}
			changes.push({ id: record.event.id, duration: duration.toJSON() });
		}
		return changes;
	}

	_moveVisibleRange(x) {
		const drag = this.drag;
		const hit = drag.hit;
		const progress = Math.max(0, Math.min(1, (x - hit.rectangle.x) / hit.rectangle.width));
		const seconds = hit.bounds[0] + progress * (hit.bounds[1] - hit.bounds[0]);
		if (drag.type === "scroll-begin") {
			this.callbacks.onVisibleRange?.(Math.min(seconds, drag.ending - 0.01), drag.ending);
		} else if (drag.type === "scroll-end") {
			this.callbacks.onVisibleRange?.(drag.beginning, Math.max(seconds, drag.beginning + 0.01));
		} else {
			const startSeconds =
				hit.bounds[0] +
				((drag.start.x - hit.rectangle.x) / hit.rectangle.width) * (hit.bounds[1] - hit.bounds[0]);
			const delta = seconds - startSeconds;
			const span = drag.ending - drag.beginning;
			let beginning = drag.beginning + delta;
			beginning = Math.max(hit.bounds[0], Math.min(hit.bounds[1] - span, beginning));
			this.callbacks.onVisibleRange?.(beginning, beginning + span);
		}
	}

	_wheel(event) {
		event.preventDefault();
		const project = projectState(this.state);
		if (event.ctrlKey && event.shiftKey) {
			this.callbacks.onMainFieldZoom?.(event.deltaY < 0 ? 1.12 : 1 / 1.12);
			return;
		}
		if (project.channels.length > 3 && event.shiftKey) {
			this.scrollChannelsBy(event.deltaY);
			return;
		}
		this.callbacks.onWheel?.(event);
	}

}
