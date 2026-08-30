import { i18n } from "../ui/i18n.js";
import { deepClone, eventTypeLabel } from "./app-helpers.js";
import { eventUsesChannel } from "../core/grouping.js";
import { createEvent } from "../core/chart-events.js";

// The callback tables handed to the timeline and stage views when they are constructed.
// Split out of app-event-editing.js: these two objects are pure wiring — every entry
// forwards a view gesture to an editing method — so they live apart from the editing logic
// itself.

function applyFlickAngles(model, id, angle, changes) {
	const updates = changes instanceof Map ? changes : [[id, angle]];
	for (const [eventId, nextAngle] of updates) {
		const event = model.findEvent(eventId);
		if (event) {
			event.angle = nextAngle;
		}
	}
}

export class ViewCallbacksTrait {

	_timelineCallbacks() {
		return {
			getWaveform: () => this.audio.waveform,
			getTimeBounds: () => this.timeBounds(true),
			onTimelineResize: () => this.scrollView?.requestRender(),
			onChannelOffset: offset => {
				this.model.editor.timelineChannelOffset = offset;
			},
			isPlaying: () => this.audio.playing,
			onSeekStart: () => {
				this.resumePlaybackAfterSeek = this.audio.playing ? this.audio.direction : false;
				if (this.audio.playing) {
					this.audio.pause();
				}
			},
			onSeekEnd: () => {
				const resume = this.resumePlaybackAfterSeek;
				this.resumePlaybackAfterSeek = false;
				if (resume === -1) {
					void this.audio.playReverse();
				} else if (resume === 1) {
					void this.audio.play();
				}
			},
			onSelectEvents: (ids, mode) => this.selectEvents(ids, mode),
			onEnterGroupSelection: id => this.enterGroupSelection(id),
			onRangeSelect: (beat, channel, mode) => this.rangeSelect(beat, channel, mode),
			onSeekBeat: (beat, channel, clearSelection) => {
				this.seekBeat(beat, channel, clearSelection);
			},
			onPreviewSeekBeat: beat => this.seekBeat(beat, null, false, { lightweight: true }),
			onSeekSeconds: (seconds, final) => this.seekWaveform(seconds, final),
			onAbLoopMarks: (marks, final) => this.setAbLoopMarks(marks, final),
			onAdjustTiming: payload => this.previewOffsetAdjustment(payload),
			onPreviewMoveEvents: (delta, channelDelta, copy) => this.previewMoveEvents(delta, channelDelta, copy),
			onMoveEvents: (delta, channelDelta, copy) => this.moveEvents(delta, channelDelta, copy),
			onPreviewDurations: changes => this._previewDurations(changes),
			onResizeEvents: changes => this._resizeEvents(changes),
			onPreviewBoxSelect: (ids, mode) => this.previewSelection(ids, mode),
			onBoxSelect: (ids, mode) => this.finishSelectionPreview(ids, mode),
			onEndPreview: () => this.endInteractionPreview(),
			onVisibleRange: (beginning, end) => this.setVisibleRange(beginning, end),
			onPageVisibleRange: direction => this.pageVisibleRange(direction),
			onEditBpm: index => void this.showBpmDialog(index),
			onMainFieldZoom: factor => this.setMainFieldZoom(factor),
			onWheel: event => this.navigateWheel(event.deltaY, event.ctrlKey, event.ctrlKey),
		};
	}

	// v21: duration resizes mutate the live events and splice the render index
	// incrementally (`replaceEvents`), so dragging a hold tail neither rebuilds the whole
	// index per pointer move nor right when the drag is released. The refresh options
	// object doubles as the rebuild request channel: the mutation flips `rebuildIndex`
	// when the incremental splice is not possible.
	_applyDurationChanges(model, changes, refreshOptions) {
		const currentIndex = this.renderIndex?.eventSource === model.events ? this.renderIndex : null;
		const durations = new Map(changes.map(change => [change.id, change.duration]));
		const replacements = [];
		for (const event of model.allEvents()) {
			const duration = durations.get(event.id);
			if (duration === undefined) {
				continue;
			}
			// The model swaps to the replacement object (like chooseEventTool), so the
			// render index and the model keep referencing the same events across moves.
			const newEvent = createEvent(event.type, {
				...event,
				duration: deepClone(duration),
				id: event.id,
				selected: event.selected,
			});
			model.replaceEvent(event.id, newEvent);
			if (currentIndex) {
				replacements.push({ oldEvent: event, newEvent });
			}
		}
		if (!currentIndex?.replaceEvents?.(replacements)) {
			refreshOptions.rebuildIndex = true;
		}
	}

	_previewDurations(changes) {
		const previewOptions = {
			scheduleDirty: true,
			lightweight: true,
			incremental: true,
			rebuildIndex: false,
		};
		this.preview(
			"Resize events",
			model => this._applyDurationChanges(model, changes, previewOptions),
			previewOptions,
		);
	}

	_resizeEvents(changes) {
		const ids = new Set(changes.map(change => change.id));
		// v21: the incremental previews already mutate the live events and the final
		// mutation overwrites every previewed duration, so the commit skips the preview
		// restore and splices the index in place instead of rebuilding it.
		const commitOptions = { scheduleDirty: true, rebuildIndex: false, skipPreviewRestore: true };
		this.commit(
			i18n.t("history.editEvent", { type: "" }),
			model => this._applyDurationChanges(model, changes, commitOptions),
			commitOptions,
		);
		this.rememberCreationDefaults(this.model.allEvents().filter(event => ids.has(event.id)));
	}

	_stageCallbacks() {
		return {
			getCreationMode: () => this.creationMode,
			isPlaying: () => this.audio.playing,
			getDefaultFlickAngle: () => this.lastFlickAngle,
			getCurveDraft: () => this.curveDraft,
			getFreeTransform: () => this.freeTransform,
			getTimeBounds: () => this.timeBounds(true),
			onCreationPreview: () => this.requestStatusUpdate(),
			onCreateEvent: (type, preview) => this.createPositionedEvent(type, preview),
			onCurvePoint: (point, finish) => this.addCurvePoint(point, finish),
			onPenNodeStart: point => this.startPenNode(point),
			onPreviewPenNode: (index, point) => this.setPenNodeDrag(index, point, false),
			onPenNode: (index, point, dragged) =>
				dragged ? this.setPenNodeDrag(index, point, true) : this.recordPenNode(index),
			onPreviewPenHandle: (index, kind, point) => this.setPenNodeHandle(index, kind, point, false),
			onPenHandle: (index, kind, point) => this.setPenNodeHandle(index, kind, point, true),
			onCurvePointActivate: index => this.activateCurveDraftPoint(index),
			onCurveDoubleClick: () => this.finishCurveDraftFromDoubleClick(),
			onPreviewCurvePoint: (index, point) => this.moveCurveDraftPoint(index, point, false),
			onCurvePointMove: (index, point) => this.moveCurveDraftPoint(index, point, true),
			onSelectEvents: (ids, mode) => this.selectEvents(ids, mode),
			onEnterGroupSelection: id => this.enterGroupSelection(id),
			onPreviewPosition: (id, point) => this.previewPosition(id, point),
			onMovePosition: (id, point) => this.movePosition(id, point),
			onPreviewGroupAnchor: (id, point) => this.previewGroupAnchor(id, point),
			onMoveGroupAnchor: (id, point) => this.moveGroupAnchor(id, point),
			onPreviewFlickAngle: (id, angle, changes) =>
				this.preview("Change flick direction", model => applyFlickAngles(model, id, angle, changes), {
					lightweight: true,
					incremental: true,
					rebuildIndex: false,
				}),
			onFlickAngle: (id, angle, changes) => {
				this.lastFlickAngle = Number(angle);
				this.commit(i18n.t("history.editEvent", { type: eventTypeLabel("flick") }), model =>
					applyFlickAngles(model, id, angle, changes),
				);
			},
			onPreviewTipSpawn: (id, point) => this.previewTipSpawn(id, point),
			onTipSpawn: (id, point) => this.setTipSpawn(id, point),
			onPreviewSnappeeHandle: (id, index, point) => this.previewSnappeeHandle(id, index, point),
			onSnappeeHandle: (id, index, point) => this.setSnappeeHandle(id, index, point),
			onPreviewSnappeeMove: (id, delta) => this.previewSnappeeMove(id, delta),
			onSnappeeMove: (id, delta) => this.moveSnappee(id, delta),
			onPreviewBoxSelect: (ids, mode) => this.previewSelection(ids, mode),
			onBoxSelect: (ids, mode) => this.finishSelectionPreview(ids, mode),
			onEndPreview: () => this.endInteractionPreview(),
			onSelectAttachedEvents: (id, mode) => {
				const activeChannels =
					this.renderIndex?.activeChannelIds ||
					new Set(
						this.model.channels.filter(channel => channel.active !== false).map(channel => channel.id),
					);
				this.selectEvents(
					this.model
						.allEvents()
						.filter(
							event =>
								event.attached && event.snappee === id && eventUsesChannel(event, activeChannels),
						)
						.map(event => event.id),
					mode,
				);
			},
			onPreviewFreeTransform: matrix => this.previewFreeTransform(matrix),
			onPreviewFreeTransformAnchor: anchor => this.previewFreeTransformAnchor(anchor),
			onMainFieldPan: (x, y) => this.setMainFieldPan(x, y),
			onMainFieldZoom: factor => this.setMainFieldZoom(factor),
			onProgressSeek: payload => this.seekProgress(payload),
			onHudPause: () => void this.registry.execute("music.playPause", this),
		};
	}

}
