// Marks placed on the timeline: the A-B loop pair and manual bar lines. Split out of
// app-view-controls.js because both are edits to marker collections rather than viewport
// or seeking behaviour, and they share the same "preview live, commit on release" shape.

import { i18n } from "./i18n.js";
import { Rational } from "./core/rational.js";

export const withTimelineMarks = Base =>
	class extends Base {
		setAbLoopMarks(marks, final) {
			const next = Array.isArray(marks) ? marks : [];
			const mutate = model => {
				model.editor.abLoopMarks = next.map(mark => Rational.from(mark).toJSON());
			};
			if (final) {
				this.commit(i18n.t("history.abLoop"), mutate, { dirty: false, viewOnly: true, allowReadOnly: true });
				return;
			}
			mutate(this.model);
			this._syncAudioLoop?.();
			this.timeline.requestRender();
			this.scrollView?.requestRender();
			this.requestStatusUpdate();
		}

		toggleBarLine() {
			const beat = this.currentBeat();
			this.commit(i18n.t("history.barLine"), model => {
				if (!model.timing.removeBarLine(beat)) {
					model.timing.addBarLine(beat);
				}
			});
		}
	};
