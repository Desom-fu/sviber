import { Rational } from "../core/rational.js";
import { selected } from "./app-helpers.js";

// Moving the playhead and the visible range: clicking a beat, clamping and paging the
// visible range, stepping between channels, and the wheel gesture that either zooms the
// range or steps the playhead by one subdivision. Split out of app-event-editing.js.

export class TimelineNavigationTrait {

	seekBeat(beat, channel = null, clearSelection = false, options = {}) {
		if (this.audio.playing) {
			this.audio.pause();
		}
		this.model.editor.timeSnapped = true;
		this.model.editor.currentTime = Rational.from(beat).toJSON();
		if (
			channel != null &&
			this.model.channels.some(candidate => candidate.id === channel && candidate.active !== false)
		) {
			this.model.editor.currentChannel = channel;
		}
		if (clearSelection) {
			for (const event of this.model.allEvents()) {
				event.selected = false;
			}
			this.stageMoveAttachmentException = null;
		}
		this.audio.seek(this.currentSeconds());
		if (options.lightweight && !clearSelection && channel == null) {
			this.timeline.requestRender();
			this.stage.requestRender();
			this.scrollView?.requestRender();
			this.requestStatusUpdate();
		} else {
			this._refreshLightweight?.({
				rebuildIndex: false,
				selectionOnly: clearSelection,
				channelOnly: channel != null,
				skipHistory: true,
				skipCommands: true,
			});
		}
	}

	setVisibleRange(beginning, end, includeCurrent = false) {
		const bounds = this.timeBounds(includeCurrent);
		const span = Math.max(0.05, end - beginning);
		let start = Math.max(bounds[0], Math.min(bounds[1] - span, beginning));
		if (bounds[1] - bounds[0] < span) {
			start = bounds[0];
		}
		this.model.editor.visibleRangeBeginning = start;
		this.model.editor.visibleRangeEnd = Math.min(bounds[1], start + span);
		this.timeline.requestRender();
		this.scrollView?.requestRender();
	}

	pageVisibleRange(direction) {
		const sign = Math.sign(Number(direction));
		if (!sign) {
			return;
		}
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
			} else {
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
		if (!step) {
			return false;
		}
		const channels = this.model.channels;
		const current = channels.findIndex(channel => channel.id === this.model.editor.currentChannel);
		for (let index = current + step; index >= 0 && index < channels.length; index += step) {
			if (channels[index].active === false) {
				continue;
			}
			this.model.editor.currentChannel = channels[index].id;
			this.timeline.revealChannel(channels[index].id);
			this._refreshLightweight?.({
				rebuildIndex: false,
				channelOnly: true,
				skipInspector: true,
				skipHistory: true,
				skipCommands: true,
			});
			return true;
		}
		return false;
	}

	navigateWheel(deltaY, zoom = false, allowLockedRangeChange = false) {
		if (zoom) {
			if (this.model.editor.lockVisibleRange && !allowLockedRangeChange) {
				return;
			}
			const editor = this.model.editor;
			const beginning = editor.visibleRangeBeginning;
			const ending = editor.visibleRangeEnd;
			const oldSpan = Math.max(0.001, ending - beginning);
			const span = Math.max(0.02, oldSpan * (deltaY < 0 ? 0.82 : 1.22));
			const current = this.currentSeconds();
			// Zooming keeps the visual position of the current time when it is inside
			// the visible range, and the centre of the range otherwise.
			if (Number.isFinite(current) && current >= beginning && current <= ending) {
				const ratio = (current - beginning) / oldSpan;
				this.setVisibleRange(current - ratio * span, current + (1 - ratio) * span);
				return;
			}
			const center = (beginning + ending) / 2;
			this.setVisibleRange(center - span / 2, center + span / 2);
			return;
		}
		const direction = Math.sign(deltaY);
		if (!direction) {
			return;
		}
		const editor = this.model.editor;
		const oldSeconds = this.currentSeconds();
		const center = (editor.visibleRangeBeginning + editor.visibleRangeEnd) / 2;
		const inside = oldSeconds >= editor.visibleRangeBeginning && oldSeconds <= editor.visibleRangeEnd;
		let moveVisibleRange = false;
		if (!this.model.editor.lockVisibleRange || allowLockedRangeChange) {
			moveVisibleRange = inside && (direction > 0 ? oldSeconds >= center : oldSeconds <= center);
		}
		const nextBeat = this.currentBeat().add(new Rational(direction, this.model.editor.subdivision));
		const nextSeconds = this.timing().beatToSeconds(nextBeat);
		const bounds = this.timeBounds();
		if (nextSeconds < bounds[0] - 1e-8 || nextSeconds > bounds[1] + 1e-8) {
			return;
		}
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
		if (this.model.editor.visibleRangeBeginning < bounds[0]) {
			this.setVisibleRange(bounds[0], bounds[0] + span);
		} else if (this.model.editor.visibleRangeEnd > bounds[1]) {
			this.setVisibleRange(bounds[1] - span, bounds[1]);
		} else {
			this.timeline.requestRender();
		}
		this.stage.requestRender();
		this.scrollView?.requestRender();
		this.requestStatusUpdate();
		this.audio.seek(nextSeconds);
	}

}
