// Playhead seeking driven by pointer gestures on the timeline, the waveform and the scroll
// view. Split out of app-view-controls.js so the snapping/drag-state rules for moving the
// current time live in one place, separate from view refreshing and timeline marks.

export const withTimeSeeking = Base =>
	class extends Base {
		// Re-centres the visible range when a drag asked the view to follow the pointer.
		_followVisibleRange(target, drag) {
			if (!drag.followRange || !Number.isFinite(drag.beginning) || !Number.isFinite(drag.end)) {
				return;
			}
			const span = drag.end - drag.beginning;
			const ratio = (Number(drag.startSeconds) - drag.beginning) / Math.max(0.001, span);
			this.setVisibleRange(target - ratio * span, target + (1 - ratio) * span, true);
		}

		// Snapped seeks land on the current subdivision; unsnapped seeks keep raw seconds so
		// that a drag (or playback) can move the playhead continuously.
		_seekSnapped(target) {
			const editor = this.model.editor;
			editor.timeSnapped = true;
			editor.currentTime = this.timing().secondsToSnappedBeat(target, editor.subdivision).toJSON();
			this.audio.seek(this.currentSeconds());
		}

		_seekUnsnapped(target) {
			const editor = this.model.editor;
			editor.timeSnapped = false;
			editor.currentTime = target;
			this.audio.seek(target);
		}

		seekProgress(payload = {}) {
			const target = Number(payload.seconds);
			if (!Number.isFinite(target)) {
				return;
			}
			this._followVisibleRange(target, payload);
			if (this.audio.playing) {
				this._seekUnsnapped(target);
			} else {
				this._seekSnapped(target);
			}
			this.refreshInteractionPreview?.({ rebuildIndex: false });
		}

		seekScrollbar(seconds) {
			const editor = this.model.editor;
			const current = this.currentSeconds();
			const beginning = Number(editor.visibleRangeBeginning);
			const end = Number(editor.visibleRangeEnd);
			if (current >= beginning && current <= end) {
				this.seekProgress({ seconds, followRange: true, beginning, end, startSeconds: current });
				return;
			}
			const span = Math.max(0.001, end - beginning);
			this.setVisibleRange(seconds - span / 2, seconds + span / 2, true);
		}

		// v17: the waveform drag leaves the current time unsnapped until the mouse is
		// released. While `timeDragActive` is true every command that needs a snapped
		// current time is disabled.
		seekWaveform(seconds, final) {
			const target = Number(seconds);
			if (!Number.isFinite(target)) {
				return;
			}
			this.timeDragging = !final;
			if (final && !this.audio.playing) {
				this._seekSnapped(target);
			} else {
				this._seekUnsnapped(target);
			}
			this.refreshInteractionPreview?.({ rebuildIndex: false });
			if (final) {
				this.registry.notifyAll();
			}
		}

		timeDragActive() {
			return Boolean(this.timeDragging) || Boolean(this.scrollViewDragging);
		}

		panScrollView(seconds, final, drag = {}) {
			const target = Number(seconds);
			if (!Number.isFinite(target)) {
				return;
			}
			this._followVisibleRange(target, drag);
			if (final && !this.audio.playing) {
				this._seekSnapped(target);
			} else {
				this._seekUnsnapped(target);
			}
			this.scrollViewDragging = !final;
			this.refreshInteractionPreview?.({ rebuildIndex: false });
			if (final) {
				this.registry.notifyAll();
			}
		}
	};
