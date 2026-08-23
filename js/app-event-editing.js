import { i18n } from "./i18n.js"; import { ChartModel, connectSelectedTipPointChain, createEvent } from "./core/chart-model.js";
import { fillInheritedTipPointParams } from "./core/tip-point.js"; import { Rational } from "./core/rational.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, isPointWithinChartBounds, multiplyTransforms, resolveAttachedPosition, sampleSnappee, transformAngle } from "./core/geometry.js";
import { MOVABLE_TYPES, DURATION_TYPES, deepClone, selected, allowsOutOfBounds, pointAllowed, attachedMoveAllowed, mutateSnappeeWithinBounds, constrainSnappeeTranslation, eventTypeLabel } from "./app-helpers.js";
import { eventUsesChannel, findEvent } from "./core/grouping.js"; import { snapshotsEqual, captureHistoryView } from "./core/history.js"; import { withFreeTransform } from "./app-free-transform.js"; import { withViewControls } from "./app-view-controls.js";
const TIP_POINTABLE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
function applyFlickAngles(model, id, angle, changes) {
	for (const [eventId, nextAngle] of changes instanceof Map ? changes : [[id, angle]]) { const event = model.findEvent(eventId); if (event) event.angle = nextAngle; }
}
const withEventEditingBase = Base => class extends Base {
	exitCreationModes() {
		if (!this.creationMode && !this.curveDraft) return false;
		this.creationMode = null; this.curveDraft = null;
		this.cancelPreview();
		this.refresh();
		return true;
	}
	_timelineCallbacks() {
		return {
			getWaveform: () => this.audio.waveform,
			getTimeBounds: () => this.timeBounds(true),
			onTimelineResize: () => this.scrollView?.requestRender(), onChannelOffset: offset => { this.model.editor.timelineChannelOffset = offset; },
			isPlaying: () => this.audio.playing,
			onSeekStart: () => { this.resumePlaybackAfterSeek = this.audio.playing ? this.audio.direction : false; if (this.audio.playing) this.audio.pause(); },
			onSeekEnd: () => { const resume = this.resumePlaybackAfterSeek; this.resumePlaybackAfterSeek = false; if (resume === -1) void this.audio.playReverse(); else if (resume === 1) void this.audio.play(); },
			onSelectEvents: (ids, mode) => this.selectEvents(ids, mode),
			onEnterGroupSelection: id => this.enterGroupSelection(id),
			onRangeSelect: (beat, channel, mode) => this.rangeSelect(beat, channel, mode),
			onSeekBeat: (beat, channel, clearSelection) => {
				this.seekBeat(beat, channel, clearSelection);
			},
			onPreviewSeekBeat: beat => this.seekBeat(beat, null, false, { lightweight: true }),
			onPreviewMoveEvents: (delta, channelDelta, copy) => this.previewMoveEvents(delta, channelDelta, copy),
			onMoveEvents: (delta, channelDelta, copy) => this.moveEvents(delta, channelDelta, copy),
			onPreviewDurations: changes => this.preview("Resize events", model => {
				const durations = new Map(changes.map(change => [change.id, change.duration]));
				for (const event of model.allEvents()) {
					if (durations.has(event.id)) event.duration = deepClone(durations.get(event.id));
				}
			}, { scheduleDirty: true, lightweight: true }),
			onResizeEvents: changes => {
				const ids = new Set(changes.map(change => change.id));
				const durations = new Map(changes.map(change => [change.id, change.duration]));
				this.commit(i18n.t("history.editEvent", { type: "" }), model => {
					for (const event of model.allEvents()) {
						if (durations.has(event.id)) event.duration = deepClone(durations.get(event.id));
					}
				});
				this.rememberCreationDefaults(this.model.allEvents().filter(event => ids.has(event.id)));
			},
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
			onPenNode: (index, point, dragged) => dragged ? this.setPenNodeDrag(index, point, true) : this.recordPenNode(index),
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
			onPreviewFlickAngle: (id, angle, changes) => this.preview("Change flick direction", model => applyFlickAngles(model, id, angle, changes), { lightweight: true, incremental: true, rebuildIndex: false }),
			onFlickAngle: (id, angle, changes) => {
				this.lastFlickAngle = Number(angle);
				this.commit(i18n.t("history.editEvent", { type: eventTypeLabel("flick") }), model => applyFlickAngles(model, id, angle, changes));
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
				const activeChannels = this.renderIndex?.activeChannelIds
					|| new Set(this.model.channels.filter(channel => channel.active !== false).map(channel => channel.id));
				this.selectEvents(this.model.allEvents().filter(event => event.attached && event.snappee === id
					&& eventUsesChannel(event, activeChannels)).map(event => event.id), mode);
			},
			onPreviewFreeTransform: matrix => this.previewFreeTransform(matrix),
			onPreviewFreeTransformAnchor: anchor => this.previewFreeTransformAnchor(anchor),
			onMainFieldPan: (x, y) => this.setMainFieldPan(x, y), onMainFieldZoom: factor => this.setMainFieldZoom(factor), onProgressSeek: payload => this.seekProgress(payload),
			onHudPause: () => void this.registry.execute("music.playPause", this),
		};
	}
	selectEvents(ids, mode = "replace") {
		this.cancelSelectionPreview();
		const indexIsCurrent = this.renderIndex?.eventSource === this.model.events
			&& this.renderIndex.eventById.size === this.model.allEvents().length;
		const activeChannels = indexIsCurrent ? this.renderIndex.activeChannelIds
			: new Set(this.model.channels.filter(channel => channel.active !== false).map(channel => channel.id));
		const eventById = indexIsCurrent ? this.renderIndex.eventById
			: new Map(this.model.allEvents().map(event => [event.id, event]));
		const targets = new Set([...ids].filter(id => mode === "remove"
			|| eventUsesChannel(eventById.get(id), activeChannels)));
		if (mode === "replace" && indexIsCurrent && this.renderIndex.selectedEventIds?.size === targets.size
			&& [...targets].every(id => this.renderIndex.selectedEventIds.has(id))) return;
		this.commit(i18n.t("history.selection"), model => {
			for (const event of model.allEvents()) {
				if (mode === "replace") event.selected = targets.has(event.id);
				else if (mode === "add" && targets.has(event.id)) event.selected = true;
				else if (mode === "remove" && targets.has(event.id)) event.selected = false;
			}
		}, { dirty: false, allowPlaying: true, allowReadOnly: true, scheduleDirty: false, lightweight: true, selectionOnly: true, rebuildIndex: false });
	}
	enterGroupSelection(id) {
		const event = this.model.findEvent(id);
		const ancestors = event ? this.model.ancestorsOf(id) : [];
		if (!event || !ancestors.length) return false;
		const scopeIndex = this.groupSelectionScope == null ? -1 : ancestors.findIndex(group => group.id === this.groupSelectionScope);
		if (this.groupSelectionScope != null && scopeIndex < 0) return false;
		const nextGroup = scopeIndex < 0 ? ancestors[0] : ancestors[scopeIndex + 1]; const target = nextGroup ? (ancestors[ancestors.indexOf(nextGroup) + 1] || event) : event;
		this.groupSelectionScope = nextGroup?.id ?? this.groupSelectionScope;
		this.commit(i18n.t("history.selection"), model => {
			for (const candidate of model.allEvents()) candidate.selected = candidate.id === target.id;
		}, { dirty: false, allowReadOnly: true, scheduleDirty: false, lightweight: true, selectionOnly: true, rebuildIndex: true });
		return true;
	}
	_reconcileStageMoveAttachmentException(selectionBefore) {
		const exception = this.stageMoveAttachmentException;
		if (!exception) return;
		const sameSet = (left, right) => left.size === right.size && [...left].every(id => right.has(id));
		if (!sameSet(selectionBefore, exception.selectionIds)) {
			this.stageMoveAttachmentException = null;
			return;
		}
		const selectionAfter = new Set(this.model.allEvents().filter(event => event.selected).map(event => event.id));
		if (sameSet(selectionBefore, selectionAfter)) return;
		const onlyAdded = [...selectionBefore].every(id => selectionAfter.has(id));
		const addedAreUnattached = [...selectionAfter]
			.filter(id => !selectionBefore.has(id))
			.every(id => !this.model.findEvent(id)?.attached);
		if (onlyAdded && addedAreUnattached) exception.selectionIds = selectionAfter;
		else this.stageMoveAttachmentException = null;
	}
	_canUseStageMoveAttachmentException(model) {
		const exception = this.stageMoveAttachmentException;
		if (!exception) return false;
		const selectedIds = new Set(model.allEvents().filter(event => event.selected).map(event => event.id));
		if (selectedIds.size !== exception.selectionIds.size
			|| [...selectedIds].some(id => !exception.selectionIds.has(id))) return false;
		const movable = model.allEvents().filter(event => event.selected && MOVABLE_TYPES.has(event.type));
		const attached = movable.filter(event => event.attached);
		return attached.length === 1 && attached[0].id === exception.attachedEventId;
	}
	_captureStageMoveAttachmentException(primaryId) {
		const movable = this.model.allEvents().filter(event => event.selected && MOVABLE_TYPES.has(event.type));
		const attached = movable.filter(event => event.attached);
		this.stageMoveAttachmentException = attached.length === 1 && attached[0].id === primaryId
			? {
				attachedEventId: primaryId,
				selectionIds: new Set(this.model.allEvents().filter(event => event.selected).map(event => event.id)),
			}
			: null;
	}
	_setPreviewSelection(event, selected) {
		if (!event) return;
		const value = Boolean(selected);
		if (event.selected === value) return;
		event.selected = value;
		this.renderIndex?.setEventSelected(event, value);
	}
	_startSelectionPreview(mode) {
		if (this.selectionPreview?.mode === mode) return this.selectionPreview;
		this.cancelSelectionPreview();
		const indexIsCurrent = this.renderIndex?.eventSource === this.model.events
			&& this.renderIndex.eventById.size === this.model.allEvents().length;
		const eventById = indexIsCurrent ? this.renderIndex.eventById
			: new Map(this.model.allEvents().map(event => [event.id, event]));
		const baseSelected = indexIsCurrent && this.renderIndex.selectedEventIds
			? new Set(this.renderIndex.selectedEventIds)
			: new Set(this.model.allEvents().filter(event => event.selected).map(event => event.id));
		this.selectionPreview = { mode, eventById, baseSelected, targets: new Set() };
		if (mode === "replace") {
			for (const id of baseSelected) this._setPreviewSelection(eventById.get(id), false);
		}
		return this.selectionPreview;
	}
	previewSelection(ids, mode = "replace") {
		const preview = this._startSelectionPreview(mode);
		const targets = new Set(ids);
		for (const id of preview.targets) {
			if (targets.has(id)) continue;
			const event = preview.eventById.get(id);
			if (event) this._setPreviewSelection(event, mode === "replace" ? false : preview.baseSelected.has(id));
		}
		for (const id of targets) {
			if (preview.targets.has(id)) continue;
			const event = preview.eventById.get(id);
			if (event) this._setPreviewSelection(event, mode !== "remove");
		}
		preview.targets = targets;
		this.timeline.requestRender();
		this.stage.requestRender();
		this.scrollView?.requestRender();
	}
	finishSelectionPreview(ids, mode = "replace") {
		this.previewSelection(ids, mode);
		const preview = this.selectionPreview;
		if (!preview) return;
		const changed = mode === "replace"
			? preview.targets.size !== preview.baseSelected.size
				|| [...preview.targets].some(id => !preview.baseSelected.has(id))
			: mode === "add"
				? [...preview.targets].some(id => !preview.baseSelected.has(id))
				: [...preview.targets].some(id => preview.baseSelected.has(id));
		this.selectionPreview = null;
		this._normalizeGroupSelectionScope();
		if (!changed) return;
		this.history.recordView(captureHistoryView(this.model), i18n.t("history.selection"));
		this._refreshLightweight({ selectionOnly: true, rebuildIndex: false });
	}
	cancelSelectionPreview() {
		const preview = this.selectionPreview;
		if (!preview) return false;
		const affected = new Set([...preview.baseSelected, ...preview.targets]);
		for (const id of affected) {
			const event = preview.eventById.get(id);
			if (event) this._setPreviewSelection(event, preview.baseSelected.has(id));
		}
		this.selectionPreview = null;
		this.timeline.requestRender();
		this.stage.requestRender();
		this.scrollView?.requestRender();
		return true;
	}
	endInteractionPreview() {
		this.cancelSelectionPreview();
		this.cancelPreview();
	}
	rangeSelect(targetBeat, targetChannel, mode) {
		const beginningBeat = this.currentBeat();
		const endingBeat = Rational.from(targetBeat);
		const beginningChannel = this.model.channels.findIndex(channel => channel.id === this.model.editor.currentChannel);
		const endingChannel = this.model.channels.findIndex(channel => channel.id === targetChannel);
		const minimumBeat = beginningBeat.compare(endingBeat) <= 0 ? beginningBeat : endingBeat;
		const maximumBeat = beginningBeat.compare(endingBeat) <= 0 ? endingBeat : beginningBeat;
		const channelIds = new Set(this.model.channels
			.slice(Math.min(beginningChannel, endingChannel), Math.max(beginningChannel, endingChannel) + 1)
			.filter(channel => channel.active !== false)
			.map(channel => channel.id));
		const ids = this.model.allEvents({ includeGroups: false }).filter(event => channelIds.has(event.channel)
			&& Rational.from(event.time).compare(minimumBeat) >= 0
			&& Rational.from(event.time).compare(maximumBeat) < 0)
			.map(event => this.renderIndex?.selectionTarget(event)?.id || event.id)
			.filter((id, index, values) => values.indexOf(id) === index);
		this.commit(i18n.t("history.selection"), model => {
			model.editor.currentTime = endingBeat.toJSON();
			model.editor.currentChannel = targetChannel;
			const targets = new Set(ids);
			for (const event of model.allEvents()) {
				if (mode === "replace") event.selected = targets.has(event.id);
				else if (mode === "add" && targets.has(event.id)) event.selected = true;
				else if (mode === "remove" && targets.has(event.id)) event.selected = false;
			}
		}, { dirty: false, allowReadOnly: true, scheduleDirty: false, lightweight: true, selectionOnly: true, rebuildIndex: false });
	}
	seekBeat(beat, channel = null, clearSelection = false, options = {}) {
		if (this.audio.playing) this.audio.pause();
		this.model.editor.timeSnapped = true;
		this.model.editor.currentTime = Rational.from(beat).toJSON();
		if (channel != null && this.model.channels.some(candidate => candidate.id === channel && candidate.active !== false)) {
			this.model.editor.currentChannel = channel;
		}
		if (clearSelection) {
			for (const event of this.model.allEvents()) event.selected = false;
			this.stageMoveAttachmentException = null;
		}
		this.audio.seek(this.currentSeconds());
		if (options.lightweight && !clearSelection && channel == null) {
			this.timeline.requestRender();
			this.stage.requestRender();
			this.scrollView?.requestRender();
			this.requestStatusUpdate();
		} else {
			this.refresh();
		}
	}
	setVisibleRange(beginning, end, includeCurrent = false) {
		const bounds = this.timeBounds(includeCurrent);
		const span = Math.max(0.05, end - beginning);
		let start = Math.max(bounds[0], Math.min(bounds[1] - span, beginning));
		if (bounds[1] - bounds[0] < span) start = bounds[0];
		this.model.editor.visibleRangeBeginning = start;
		this.model.editor.visibleRangeEnd = Math.min(bounds[1], start + span);
		this.timeline.requestRender();
		this.scrollView?.requestRender();
	}
	pageVisibleRange(direction) {
		const sign = Math.sign(Number(direction));
		if (!sign) return;
		const editor = this.model.editor;
		const span = editor.visibleRangeEnd - editor.visibleRangeBeginning;
		const current = this.currentSeconds();
		const currentWasVisible = current >= editor.visibleRangeBeginning && current <= editor.visibleRangeEnd;
		const previousBeginning = editor.visibleRangeBeginning;
		this.setVisibleRange(editor.visibleRangeBeginning + sign * span, editor.visibleRangeEnd + sign * span);
		const actualDelta = editor.visibleRangeBeginning - previousBeginning;
		if (currentWasVisible && Math.abs(actualDelta) > 1e-10) {
			const target = current + actualDelta;
			if (this.audio.playing) {
				editor.timeSnapped = false;
				editor.currentTime = target;
				this.audio.seek(target);
			}
			else {
				editor.timeSnapped = true;
				editor.currentTime = this.timing().secondsToSnappedBeat(target, editor.subdivision).toJSON();
				this.audio.seek(this.currentSeconds());
			}
			this.stage.requestRender();
			this.scrollView?.requestRender();
			this.requestStatusUpdate();
		}
	}
	changeCurrentChannel(direction) {
		const step = Math.sign(Number(direction));
		if (!step) return false;
		const channels = this.model.channels;
		const current = channels.findIndex(channel => channel.id === this.model.editor.currentChannel);
		for (let index = current + step; index >= 0 && index < channels.length; index += step) {
			if (channels[index].active === false) continue;
			this.model.editor.currentChannel = channels[index].id;
			this.timeline.revealChannel(channels[index].id);
			this.refresh();
			return true;
		}
		return false;
	}
	navigateWheel(deltaY, zoom = false, allowLockedRangeChange = false) {
		if (zoom) {
			if (this.model.editor.lockVisibleRange && !allowLockedRangeChange) return;
			const editor = this.model.editor;
			const center = (editor.visibleRangeBeginning + editor.visibleRangeEnd) / 2;
			const factor = deltaY < 0 ? 0.82 : 1.22;
			const span = Math.max(0.02, (editor.visibleRangeEnd - editor.visibleRangeBeginning) * factor);
			this.setVisibleRange(center - span / 2, center + span / 2);
			return;
		}
		const direction = Math.sign(deltaY);
		if (!direction) return;
		const editor = this.model.editor;
		const oldSeconds = this.currentSeconds();
		const center = (editor.visibleRangeBeginning + editor.visibleRangeEnd) / 2;
		const inside = oldSeconds >= editor.visibleRangeBeginning && oldSeconds <= editor.visibleRangeEnd;
		const moveVisibleRange = !this.model.editor.lockVisibleRange || allowLockedRangeChange
			? inside && (direction > 0 ? oldSeconds >= center : oldSeconds <= center)
			: false;
		const nextBeat = this.currentBeat().add(new Rational(direction, this.model.editor.subdivision));
		const nextSeconds = this.timing().beatToSeconds(nextBeat);
		const bounds = this.timeBounds();
		if (nextSeconds < bounds[0] - 1e-8 || nextSeconds > bounds[1] + 1e-8) return;
		const delta = nextSeconds - oldSeconds;
		this.model.editor.currentTime = nextBeat.toJSON();
		this.model.editor.timeSnapped = true;
		if (!moveVisibleRange) {
			this.timeline.requestRender();
			this.stage.requestRender();
			this.scrollView?.requestRender();
			this.requestStatusUpdate();
			this.audio.seek(nextSeconds);
			return;
		}
		this.model.editor.visibleRangeBeginning += delta;
		this.model.editor.visibleRangeEnd += delta;
		const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
		if (this.model.editor.visibleRangeBeginning < bounds[0]) this.setVisibleRange(bounds[0], bounds[0] + span);
		else if (this.model.editor.visibleRangeEnd > bounds[1]) this.setVisibleRange(bounds[1] - span, bounds[1]);
		else this.timeline.requestRender();
		this.stage.requestRender();
		this.scrollView?.requestRender();
		this.requestStatusUpdate();
		this.audio.seek(nextSeconds);
	}
	previewMoveEvents(deltaBeat, channelDelta, copy) { const label = i18n.t("history.moveEvents"), state = this.previewBase && this.previewLabel === label ? this.previewMoveState : (this.previewMoveState = { beat: new Rational(0), channel: 0, copied: false });
		const totalBeat = Rational.from(deltaBeat), totalChannel = Math.round(Number(channelDelta) || 0), beatDelta = totalBeat.sub(state.beat);
		const channelDeltaStep = totalChannel - state.channel, copyStep = Boolean(copy) && !state.copied;
		this.preview(label, model => this._applyEventMove(model, beatDelta.toJSON(), channelDeltaStep, copyStep), { scheduleDirty: true, lightweight: true, incremental: true }); state.beat = totalBeat; state.channel = totalChannel; state.copied ||= copyStep;
	}
	moveEvents(deltaBeat, channelDelta, copy) {
		this.commit(i18n.t("history.moveEvents"), model => this._applyEventMove(model, deltaBeat, channelDelta, copy));
	}
	_applyEventMove(model, deltaBeat, channelDelta, copy) {
		let events = model.allEvents().filter(event => event.selected
			&& !model.ancestorsOf(event.id).some(ancestor => ancestor.selected));
		if (!events.length) return;
		const movedEvents = [...new Set(events.flatMap(event => event.type === "group"
			? model.groupDescendants(event.id).filter(item => item.type !== "group") : [event]))];
		const channelIndices = movedEvents
			.map(event => model.channels.findIndex(channel => channel.id === event.channel))
			.filter(index => index >= 0);
		if (!channelIndices.length) return;
		const requestedChannelDelta = Math.round(Number(channelDelta) || 0);
		let boundedChannelDelta = Math.max(
			-Math.min(...channelIndices),
			Math.min(model.channels.length - 1 - Math.max(...channelIndices), requestedChannelDelta),
		);
		if (boundedChannelDelta && channelIndices.some(index =>
			model.channels[index + boundedChannelDelta]?.active === false)) boundedChannelDelta = 0;
		if (copy) {
			for (const event of events) event.selected = false;
			events = events.map(event => model.addEvent({ ...deepClone(event), id: null, selected: true }));
		}
		const delta = Rational.from(deltaBeat);
		const moved = [...new Set(events.flatMap(event => event.type === "group"
			? model.groupDescendants(event.id).filter(item => item.type !== "group") : [event]))];
		for (const event of moved) {
			event.time = Rational.from(event.time).add(delta).toJSON();
			const index = model.channels.findIndex(channel => channel.id === event.channel);
			if (index >= 0) event.channel = model.channels[index + boundedChannelDelta].id;
		}
	}
	previewPosition(primaryId, point) {
		this.preview(i18n.t("history.moveEvents"), model => this._applyPositionMove(model, primaryId, point), { lightweight: true, incremental: true });
	}
	movePosition(primaryId, point) {
		const base = this.previewBase || this.model.snapshot();
		const primaryWasAttached = Boolean(findEvent(base.events, primaryId)?.attached);
		this.commit(i18n.t("history.moveEvents"), model => this._applyPositionMove(model, primaryId, point));
		if (!snapshotsEqual(this.model.snapshot(), base)) {
			const primaryIsAttached = Boolean(this.model.findEvent(primaryId)?.attached);
			if (!primaryWasAttached && primaryIsAttached) this._captureStageMoveAttachmentException(primaryId);
			else if (!this._canUseStageMoveAttachmentException(this.model)) this.stageMoveAttachmentException = null;
		}
	}
	previewGroupAnchor(primaryId, point) {
		this.preview(i18n.t("history.moveEvents"), model => this._applyGroupAnchorMove(model, primaryId, point), { lightweight: true, incremental: true });
	}
	moveGroupAnchor(primaryId, point) {
		this.commit(i18n.t("history.moveEvents"), model => this._applyGroupAnchorMove(model, primaryId, point));
	}
	_applyGroupAnchorMove(model, primaryId, point) {
		const primary = model.findEvent(primaryId);
		if (primary?.type !== "group") return;
		const groups = model.allEvents().filter(event => event.type === "group" && event.selected);
		if (!groups.length || !groups.includes(primary)) return;
		if (groups.length > 1 && groups.some(group => group.attached)) return;
		const original = resolveAttachedPosition(primary, model.snappees) || primary;
		const target = point;
		const requestedX = Number(target.x) - Number(original.x);
		const requestedY = Number(target.y) - Number(original.y);
		const positions = groups.map(group => resolveAttachedPosition(group, model.snappees) || group);
		const deltaX = allowsOutOfBounds(model) ? requestedX : Math.max(CHART_BOUNDS.minX - Math.min(...positions.map(position => Number(position.x))),
			Math.min(CHART_BOUNDS.maxX - Math.max(...positions.map(position => Number(position.x))), requestedX));
		const deltaY = allowsOutOfBounds(model) ? requestedY : Math.max(CHART_BOUNDS.minY - Math.min(...positions.map(position => Number(position.y))),
			Math.min(CHART_BOUNDS.maxY - Math.max(...positions.map(position => Number(position.y))), requestedY));
		for (const group of groups) {
			const position = resolveAttachedPosition(group, model.snappees) || group;
			group.attached = false;
			group.x = Number(position.x) + deltaX;
			group.y = Number(position.y) + deltaY;
			delete group.snappee;
			delete group.snapPoint;
		}
		if (point.snappeeId != null && pointAllowed(model, point)) {
			primary.attached = true;
			primary.snappee = point.snappeeId;
			primary.snapPoint = deepClone(point.snapPoint);
			delete primary.x;
			delete primary.y;
		}
	}
	_applyPositionMove(model, primaryId, point) {
		const primary = model.findEvent(primaryId);
		if (!primary) return;
		const roots = model.allEvents().filter(event => event.selected && MOVABLE_TYPES.has(event.type));
		const movable = [...new Set(roots.flatMap(event => event.type === "group"
			? [event, ...model.groupDescendants(event.id)] : [event]))];
		const attached = movable.filter(event => event.attached);
		const sharedSnappeeId = attached.length === movable.length && new Set(attached.map(event => event.snappee)).size === 1
			? attached[0]?.snappee : null;
		const sharedSnappee = model.snappees.find(snappee => snappee.id === sharedSnappeeId);
		if (movable.length > 1 && sharedSnappee && primary.attached && primary.snappee === sharedSnappee.id) {
			let points;
			try { points = sampleSnappee(sharedSnappee); } catch { return; }
			if (!allowsOutOfBounds(model)) points = points.filter(isPointWithinChartBounds);
			if (!points.length) return;
			const nearest = points.reduce((best, candidate) => {
				const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
				return !best || distance < best.distance ? { candidate, distance } : best;
			}, null)?.candidate;
			if (!nearest) return;
			if (sharedSnappee.type === "rectangularMesh") {
				const [fromI, fromJ] = primary.snapPoint;
				const [toI, toJ] = nearest.snapPoint;
				const maximumI = Math.max(1, Number(sharedSnappee.horizontalTiles) || 1);
				const maximumJ = Math.max(1, Number(sharedSnappee.verticalTiles) || 1);
				const indices = movable.map(event => event.snapPoint);
				const requestedI = toI - fromI;
				const requestedJ = toJ - fromJ;
				const deltaI = Math.max(-Math.min(...indices.map(([i]) => i)),
					Math.min(maximumI - Math.max(...indices.map(([i]) => i)), requestedI));
				const deltaJ = Math.max(-Math.min(...indices.map(([, j]) => j)),
					Math.min(maximumJ - Math.max(...indices.map(([, j]) => j)), requestedJ));
				const snapPoints = movable.map(event => [event.snapPoint[0] + deltaI, event.snapPoint[1] + deltaJ]);
				if (!attachedMoveAllowed(model, sharedSnappee, movable, snapPoints)) return;
				movable.forEach((event, index) => { event.snapPoint = snapPoints[index]; });
				return;
			}
			if (sharedSnappee.type === "radialMesh") {
				const count = Math.max(1, Number(sharedSnappee.azimuthalTiles) || 1);
				let localPoint;
				try { localPoint = applyTransform(point, invertTransform(sharedSnappee.transformation)); } catch { return; }
				const angle = Math.atan2(localPoint.y - sharedSnappee.centerY, localPoint.x - sharedSnappee.centerX);
				const targetIndex = Math.round((angle - Number(sharedSnappee.startingAngle || 0)) * count / (Math.PI * 2));
				const delta = targetIndex - Number(primary.snapPoint[0] || 0);
				const snapPoints = movable.map(event => [
					((event.snapPoint[0] + delta) % count + count) % count,
					event.snapPoint[1],
				]);
				if (!attachedMoveAllowed(model, sharedSnappee, movable, snapPoints)) return;
				movable.forEach((event, index) => { event.snapPoint = snapPoints[index]; });
				return;
			}
			if (sharedSnappee.type.endsWith("Curve")) {
				const key = value => JSON.stringify(value);
				const indices = new Map(points.map((candidate, index) => [key(candidate.snapPoint), index]));
				const fromIndex = indices.get(key(primary.snapPoint));
				const toIndex = indices.get(key(nearest.snapPoint));
				if (fromIndex == null || toIndex == null) return;
				const delta = toIndex - fromIndex;
				const closed = Boolean(sharedSnappee.closed);
				const selectedIndices = movable.map(event => indices.get(key(event.snapPoint))).filter(Number.isInteger);
				const constrainedDelta = closed ? delta : Math.max(-Math.min(...selectedIndices),
					Math.min(points.length - 1 - Math.max(...selectedIndices), delta));
				const snapPoints = movable.map(event => {
					const index = indices.get(key(event.snapPoint));
					if (index == null) return event.snapPoint;
					const moved = closed
						? ((index + constrainedDelta) % points.length + points.length) % points.length
						: index + constrainedDelta;
					return deepClone(points[moved].snapPoint);
				});
				if (!attachedMoveAllowed(model, sharedSnappee, movable, snapPoints)) return;
				movable.forEach((event, index) => { event.snapPoint = snapPoints[index]; });
				return;
			}
			return;
		}
		if (movable.length > 1 && attached.length === movable.length) return;
		const selectedGroupRoot = roots.length === 1 && roots[0].type === "group" && roots[0].id === primary.id;
		if (movable.length > 1 && attached.length && !selectedGroupRoot && !this._canUseStageMoveAttachmentException(model)) return;
		const original = resolveAttachedPosition(primary, model.snappees) || primary;
		const target = { x: Number(point.x), y: Number(point.y) };
		const positions = movable.map(event => resolveAttachedPosition(event, model.snappees) || event);
		const requestedX = target.x - original.x;
		const requestedY = target.y - original.y;
		const deltaX = allowsOutOfBounds(model) ? requestedX : Math.max(CHART_BOUNDS.minX - Math.min(...positions.map(position => Number(position.x))),
			Math.min(CHART_BOUNDS.maxX - Math.max(...positions.map(position => Number(position.x))), requestedX));
		const deltaY = allowsOutOfBounds(model) ? requestedY : Math.max(CHART_BOUNDS.minY - Math.min(...positions.map(position => Number(position.y))),
			Math.min(CHART_BOUNDS.maxY - Math.max(...positions.map(position => Number(position.y))), requestedY));
		for (const event of movable) {
			const position = resolveAttachedPosition(event, model.snappees) || event;
			event.attached = false;
			event.x = position.x + deltaX;
			event.y = position.y + deltaY;
			delete event.snappee;
			delete event.snapPoint;
		}
		if (point.snappeeId != null && pointAllowed(model, point)) {
			primary.attached = true;
			primary.snappee = point.snappeeId;
			primary.snapPoint = deepClone(point.snapPoint);
			delete primary.x;
			delete primary.y;
		}
	}
	previewTipSpawn(id, point) {
		this.preview(i18n.t("history.editEvent", { type: "" }), model => this._applyTipSpawn(model, id, point), { lightweight: true, incremental: true });
	}
	setTipSpawn(id, point) {
		this.commit(i18n.t("history.editEvent", { type: "" }), model => this._applyTipSpawn(model, id, point));
	}
	_applyTipSpawn(model, id, point) {
		const event = model.findEvent(id);
		if (!event) return;
		const position = resolveAttachedPosition(event, model.snappees) || event;
		if (event.tipPointSpawnAbsolutePosition) {
			const snap = findNearestSnapPoint(point, model.snappees, { activeOnly: true, maxDistance: 8 });
			if (snap) {
				event.tipPointSpawnAttached = true;
				event.tipPointSpawnSnappee = snap.snappeeId;
				event.tipPointSpawnSnapPoint = deepClone(snap.snapPoint);
				delete event.tipPointSpawnX;
				delete event.tipPointSpawnY;
			} else {
				event.tipPointSpawnAttached = false;
				event.tipPointSpawnX = point.x;
				event.tipPointSpawnY = point.y;
				delete event.tipPointSpawnSnappee;
				delete event.tipPointSpawnSnapPoint;
			}
		} else {
			const dx = point.x - position.x;
			const dy = point.y - position.y;
			event.tipPointSpawnDistance = Math.round(Math.hypot(dx, dy) / 12.5) * 12.5;
			event.tipPointSpawnAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI / 12;
		}
	}
	previewSnappeeHandle(id, index, point) {
		this.preview(i18n.t("history.editSnappee"), model => this._applySnappeeHandle(model, id, index, point), { lightweight: true, incremental: true });
	}
	setSnappeeHandle(id, index, point) {
		this.commit(i18n.t("history.editSnappee"), model => this._applySnappeeHandle(model, id, index, point));
	}
	previewSnappeeMove(id, delta) {
		this.preview(i18n.t("history.editSnappee"), model => {
			const movement = constrainSnappeeTranslation(model, id, delta);
			return this._applyTransformMutation(model, [1, 0, 0, 1, movement.x, movement.y], {
				snappeeId: id, onlySnappee: true,
			});
		}, { lightweight: true });
	}
	moveSnappee(id, delta) {
		this.commit(i18n.t("history.editSnappee"), model => {
			const movement = constrainSnappeeTranslation(model, id, delta);
			return this._applyTransformMutation(model, [1, 0, 0, 1, movement.x, movement.y], {
				snappeeId: id, onlySnappee: true,
			});
		});
	}
	_applySnappeeHandle(model, id, index, point) {
		return mutateSnappeeWithinBounds(model, id, snappee => {
			let localPoint;
			try { localPoint = applyTransform(point, invertTransform(snappee.transformation)); } catch { return false; }
			if (snappee.type === "rectangularMesh") {
				if (index === 0) { snappee.topLeftX = localPoint.x; snappee.topLeftY = localPoint.y; }
				else { snappee.bottomRightX = localPoint.x; snappee.bottomRightY = localPoint.y; }
			} else if (snappee.type === "radialMesh") {
				if (index === 0) { snappee.centerX = localPoint.x; snappee.centerY = localPoint.y; }
				else {
					snappee.radius = Math.hypot(localPoint.x - snappee.centerX, localPoint.y - snappee.centerY);
					snappee.startingAngle = Math.atan2(localPoint.y - snappee.centerY, localPoint.x - snappee.centerX);
				}
			} else if (snappee.type === "bezierCurve" && Number.isInteger(index)) {
				snappee.controlPoints[index] = { x: localPoint.x, y: localPoint.y };
			} else if (snappee.type === "circularArcCurve") {
				if (index === "center" || index === 0) { snappee.centerX = localPoint.x; snappee.centerY = localPoint.y; }
				else {
					const angle = Math.atan2(localPoint.y - snappee.centerY, localPoint.x - snappee.centerX);
					if (index === 1) snappee.beginningAngle = angle; else snappee.endAngle = angle;
				}
			} else if (snappee.type === "regularPolygonCurve") {
				if (index === 0) { snappee.centerX = localPoint.x; snappee.centerY = localPoint.y; }
				else {
					snappee.radius = Math.hypot(localPoint.x - snappee.centerX, localPoint.y - snappee.centerY);
					snappee.angle = Math.atan2(localPoint.y - snappee.centerY, localPoint.x - snappee.centerX);
				}
			} else if (snappee.type === "penCurve" && index && typeof index === "object") {
				const command = snappee.commands?.[index.command];
				if (!command) return false;
				command[index.x] = localPoint.x;
				command[index.y] = localPoint.y;
			}
			return true;
		});
	}
	attachedSnappeeIds(model = this.model) {
		const available = new Set(model.snappees.map(snappee => snappee.id));
		const selectedEvents = new Set(model.allEvents().filter(event => event.selected).flatMap(event =>
			event.type === "group" ? [event, ...model.groupDescendants(event.id)] : [event]));
		return new Set(model.allEvents()
			.filter(event => selectedEvents.has(event) && event.attached && available.has(event.snappee))
			.map(event => event.snappee));
	}
	transformationTargets(model = this.model, options = {}) {
		const explicitSnappeeId = options.snappeeId;
		const attachedIds = explicitSnappeeId == null
			? this.attachedSnappeeIds(model)
			: new Set([explicitSnappeeId]);
		if (explicitSnappeeId == null && !model.allEvents().some(event => event.selected)) {
			const selectedSnappee = model.snappees.find(snappee => snappee.selected && snappee.active !== false);
			if (selectedSnappee) attachedIds.add(selectedSnappee.id);
		}
		const allEvents = model.allEvents();
		const selectedGroups = allEvents.filter(event => event.selected && event.type === "group");
		const groupedDescendants = new Set(selectedGroups.flatMap(group => model.groupDescendants(group.id)));
		const directEvents = options.onlySnappee ? [] : allEvents.filter(event => {
			if (!MOVABLE_TYPES.has(event.type)) return false;
			if (event.selected && !event.attached) return true;
			return groupedDescendants.has(event) && !event.attached;
		});
		const affectedEvents = allEvents.filter(event => directEvents.includes(event)
			|| (event.attached && attachedIds.has(event.snappee) && MOVABLE_TYPES.has(event.type)));
		return { attachedIds, directEvents, affectedEvents };
	}
	transformationAvailable(model = this.model) {
		const { attachedIds, directEvents } = this.transformationTargets(model);
		return attachedIds.size > 0 || directEvents.length > 0;
	}
	transformSelectionBounds(model = this.model) {
		const { attachedIds, directEvents } = this.transformationTargets(model);
		const points = directEvents.map(event => resolveAttachedPosition(event, model.snappees)).filter(Boolean);
		for (const snappee of model.snappees) {
			if (!attachedIds.has(snappee.id)) continue;
			try { points.push(...sampleSnappee(snappee)); } catch {}
		}
		if (!points.length) return null;
		const xs = points.map(point => point.x);
		const ys = points.map(point => point.y);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;
		const halfWidth = Math.max((maxX - minX) / 2, 0.5);
		const halfHeight = Math.max((maxY - minY) / 2, 0.5);
		const bounds = {
			minX: centerX - halfWidth,
			maxX: centerX + halfWidth,
			minY: centerY - halfHeight,
			maxY: centerY + halfHeight,
		};
		return bounds;
	}
	_transformTipPointSpawn(event, model, matrix, transformedSnappeeIds) {
		if (!TIP_POINTABLE_TYPES.has(event.type) || !["chain", "drop"].includes(event.tipPointSpawnType)) return;
		if (!event.tipPointSpawnAbsolutePosition) {
			const distance = Math.max(0, Number(event.tipPointSpawnDistance) || 0);
			const angle = Number.isFinite(Number(event.tipPointSpawnAngle))
				? Number(event.tipPointSpawnAngle) : Math.PI / 2;
			const origin = applyTransform({ x: 0, y: 0 }, matrix);
			const endpoint = applyTransform({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance }, matrix);
			const dx = endpoint.x - origin.x;
			const dy = endpoint.y - origin.y;
			event.tipPointSpawnDistance = Math.hypot(dx, dy);
			if (event.tipPointSpawnDistance > 1e-12) event.tipPointSpawnAngle = Math.atan2(dy, dx);
			return;
		}
		if (event.tipPointSpawnAttached && transformedSnappeeIds.has(event.tipPointSpawnSnappee)) return;
		const position = event.tipPointSpawnAttached
			? resolveAttachedPosition(event, model.snappees, { prefix: "tipPointSpawn" })
			: { x: Number(event.tipPointSpawnX) || 0, y: Number(event.tipPointSpawnY) || 0 };
		const transformed = applyTransform(position || { x: 0, y: 100 }, matrix);
		event.tipPointSpawnAttached = false;
		event.tipPointSpawnX = transformed.x;
		event.tipPointSpawnY = transformed.y;
		delete event.tipPointSpawnSnappee;
		delete event.tipPointSpawnSnapPoint;
	}
	_applyTransformMutation(model, matrix, options = {}) {
		const { attachedIds, directEvents, affectedEvents } = this.transformationTargets(model, options);
		if (!directEvents.length && !attachedIds.size) return false;
		for (const snappee of model.snappees) {
			if (!attachedIds.has(snappee.id) || allowsOutOfBounds(model)) continue;
			let points;
			try { points = sampleSnappee(snappee); } catch { return false; }
			for (const point of points) {
				if (!pointAllowed(model, applyTransform(point, matrix))) return false;
			}
		}
		for (const event of affectedEvents) {
			const position = resolveAttachedPosition(event, model.snappees);
			if (!position) return false;
			const transformed = applyTransform(position, matrix);
			if (!pointAllowed(model, transformed)) return false;
		}
		for (const event of affectedEvents) this._transformTipPointSpawn(event, model, matrix, attachedIds);
		for (const snappee of model.snappees) {
			if (attachedIds.has(snappee.id)) snappee.transformation = multiplyTransforms(matrix, snappee.transformation);
		}
		for (const event of directEvents) {
			const transformed = applyTransform(event, matrix);
			event.x = transformed.x;
			event.y = transformed.y;
		}
		for (const event of affectedEvents) {
			if (event.type === "flick") event.angle = transformAngle(event.angle, matrix);
		}
		return true;
	}
	finishFreeTransform() {
		if (!this.freeTransform) return false;
		const changed = !snapshotsEqual(this.freeTransform.base, this.model.snapshot());
		this.freeTransform = null;
		if (changed) {
			this.history.record(this.model.snapshot(), i18n.t("history.transform"));
			this.updateDirty();
		}
		this.refresh();
		return changed;
	}
	cancelFreeTransform() {
		if (!this.freeTransform) return false;
		this.model.restore(this.freeTransform.base);
		this.freeTransform = null;
		this.refresh();
		return true;
	}
	setAttachedSnappeesActive(active) {
		const ids = this.attachedSnappeeIds();
		if (!ids.size) return;
		const commandKey = active ? "command.snappee.activate" : "command.snappee.deactivate";
		this.commit(i18n.t(commandKey), model => {
			for (const snappee of model.snappees) {
				if (!ids.has(snappee.id)) continue;
				snappee.active = Boolean(active);
				if (!active) snappee.selected = false;
			}
		}, { lightweight: true, viewOnly: true, snappeeOnly: true, rebuildIndex: false, skipInspector: true, scheduleDirty: false });
	}
	attachSelected() {
		if (!this.model.snappees.some(snappee => snappee.active !== false)) return;
		this.commit(i18n.t("command.snappee.attach"), model => {
			for (const event of model.allEvents()) {
				if (!event.selected || !MOVABLE_TYPES.has(event.type)) continue;
				const position = resolveAttachedPosition(event, model.snappees);
				if (!position) continue;
				const nearest = findNearestSnapPoint(position, model.snappees, {
					activeOnly: true,
					bounds: allowsOutOfBounds(model) ? undefined : CHART_BOUNDS,
				});
				if (!nearest) continue;
				event.attached = true;
				event.snappee = nearest.snappeeId;
				event.snapPoint = deepClone(nearest.snapPoint);
				delete event.x;
				delete event.y;
			}
		});
	}
	detachSelected() {
		this.commit(i18n.t("command.snappee.detach"), model => {
			for (const event of model.allEvents()) {
				if (!event.selected || !event.attached || !MOVABLE_TYPES.has(event.type)) continue;
				const position = resolveAttachedPosition(event, model.snappees);
				if (!position) continue;
				event.attached = false;
				event.x = position.x;
				event.y = position.y;
				delete event.snappee;
				delete event.snapPoint;
			}
		});
	}
	translateSelected(deltaX, deltaY) {
		return this.applyTransformToSelection([1, 0, 0, 1, Number(deltaX), Number(deltaY)]);
	}
	applyTransformToSelection(transform) {
		if (!Array.isArray(transform) || transform.length !== 6) return false;
		const matrix = transform.map(Number);
		if (matrix.some(value => !Number.isFinite(value))) return false;
		if (this.freeTransform) return this.previewFreeTransform(multiplyTransforms(matrix, this.freeTransform.matrix));
		let applied = false;
		this.commit(i18n.t("history.transform"), model => { applied = this._applyTransformMutation(model, matrix); });
		return applied;
	}
	moveSelectedInTime(direction) {
		const step = Math.sign(Number(direction));
		if (!step) return;
		const delta = new Rational(step, this.model.editor.subdivision);
		this.commit(i18n.t("history.moveEvents"), model => {
			const roots = model.allEvents().filter(event => event.selected
				&& !model.ancestorsOf(event.id).some(ancestor => ancestor.selected));
			const moved = [...new Set(roots.flatMap(event => event.type === "group"
				? model.groupDescendants(event.id).filter(item => item.type !== "group") : [event]))];
			for (const event of moved) {
				event.time = Rational.from(event.time).add(delta).toJSON();
			}
		});
	}
	async showTransformDialog() {
		this.exitModes();
		const values = await this.dialogs.form({
			titleKey: "dialog.transformMatrix",
			values: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
			fields: [
				{ id: "a", type: "number", labelKey: "field.matrixA", required: true, step: "any" },
				{ id: "b", type: "number", labelKey: "field.matrixB", required: true, step: "any" },
				{ id: "c", type: "number", labelKey: "field.matrixC", required: true, step: "any" },
				{ id: "d", type: "number", labelKey: "field.matrixD", required: true, step: "any" },
				{ id: "tx", type: "number", labelKey: "field.matrixTx", required: true, step: "any" },
				{ id: "ty", type: "number", labelKey: "field.matrixTy", required: true, step: "any" },
			],
		});
		if (!values) return;
		this.applyTransformToSelection([values.a, values.b, values.c, values.d, values.tx, values.ty]);
	}
	editSelectedProperty(property, value) {
		const historyLabel = i18n.t("history.editEvent", { type: "" });
		const commentProperties = new Set(["time", "channel", "duration", "endTime", "text"]);
		const allowReadOnly = this.model.editor.readOnly
			&& selected(this.model).length > 0
			&& selected(this.model).every(event => event.type === "comment")
			&& commentProperties.has(property);
		if (property === "tipPointSpawnType" && value === "chain"
			&& this.model.allEvents().filter(event => event.selected).length > 1) {
			const selectedEvent = this.model.allEvents().find(event => event.selected);
			const scopeGroup = this.groupSelectionScope && this.model.findEvent(this.groupSelectionScope)
				|| selectedEvent && this.model.ancestorsOf(selectedEvent.id).at(-1);
			const scope = scopeGroup?.events || this.model.events;
			const result = this.commit(historyLabel, model => connectSelectedTipPointChain(scope));
			if (!result?.ok) this.toast.error("toast.tipPointChainSelection");
			return result;
		}
		const result = this.commit(historyLabel, model => {
			const chosen = model.allEvents().filter(event => event.selected);
			if (property === "channel"
				&& !model.channels.some(channel => channel.id === Number(value) && channel.active !== false)) return;
			if (property === "endTime") {
				const end = Rational.from(value);
				const zeroAllowed = new Set(["bgNote", "comment"]);
				if (!chosen.every(event => {
					const comparison = end.compare(event.time);
					return DURATION_TYPES.has(event.type)
						&& (comparison > 0 || comparison === 0 && zeroAllowed.has(event.type));
				})) return;
				for (const event of chosen) event.duration = end.sub(event.time).toJSON();
				return;
			}
			if (property === "type") {
				for (const event of chosen) {
					const overrides = { ...event, id: event.id, selected: true };
					if (value === "hold" && event.duration == null) overrides.duration = this.lastHoldDuration;
					if (value === "bgNote" && event.duration == null) overrides.duration = this.lastBgNoteDuration;
					if (value === "flick" && event.angle == null) overrides.angle = this.lastFlickAngle;
					const replacement = createEvent(value, overrides);
					model.replaceEvent(event.id, replacement);
				}
				return;
			}
			for (const event of chosen) {
				if (property === "tipPointSpawnType" && (value === "chain" || value === "drop")
					&& (event.tipPointSpawnType || "inherit") === "inherit") {
					fillInheritedTipPointParams(event, model.allEvents());
					event.tipPointSpawnType = value;
					continue;
				}
				let nextValue = value;
				if ((property === "x" || property === "y") && event.type === "group") {
					if (event.attached) continue;
					const current = Number(event[property]) || 0;
					const delta = Number(nextValue) - current;
					if (!Number.isFinite(delta)) continue;
					for (const descendant of model.groupDescendants(event.id)) {
						if (!MOVABLE_TYPES.has(descendant.type)) continue;
						if (descendant.attached) {
							const resolved = resolveAttachedPosition(descendant, model.snappees);
							if (resolved) { descendant.attached = false; descendant.x = resolved.x; descendant.y = resolved.y; delete descendant.snappee; delete descendant.snapPoint; }
						}
						descendant[property] = (Number(descendant[property]) || 0) + delta;
					}
					event[property] = Number(nextValue);
					continue;
				}
				if ((property === "x" || property === "y") && event.attached) continue;
				if ((property === "x" || property === "y") && !allowsOutOfBounds(model)) {
					const point = clampPointToChartBounds({ x: property === "x" ? nextValue : event.x, y: property === "y" ? nextValue : event.y });
					nextValue = point[property];
				}
				if (property === "duration" || property.startsWith("tipPoint")) {
					const replacement = createEvent(event.type, { ...event, [property]: deepClone(nextValue), id: event.id, selected: true });
					model.replaceEvent(event.id, replacement);
				} else {
					event[property] = deepClone(nextValue);
				}
			}
		}, { allowReadOnly });
		if (property === "duration" || property === "endTime" || property === "angle" || property === "type") {
			this.rememberCreationDefaults(selected(this.model));
		}
		return result;
	}
};
export const withEventEditing = Base => withViewControls(withFreeTransform(withEventEditingBase(Base)));
