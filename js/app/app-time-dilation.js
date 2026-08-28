// The time-dilation tool: scales the times (and optionally the durations) of the selected
// events around the earliest selected event. Split out of app-view-controls.js because it is
// a chart edit driven by a dialog, not a view control.

import { i18n } from "../ui/i18n.js";
import { Rational } from "../core/rational.js";

// Groups are dilated through their members, so a selected group contributes its
// non-group descendants instead of itself.
function dilationTargets(model, event) {
	if (event.type !== "group") {
		return [event];
	}
	return model.groupDescendants(event.id).filter(item => item.type !== "group");
}

function earliestTime(events) {
	return events.reduce((min, event) => {
		const time = Rational.from(event.time);
		return !min || time.compare(min) < 0 ? time : min;
	}, null);
}

export const withTimeDilation = Base =>
	class extends Base {
		async showTimeDilationDialog() {
			this.exitModes();
			const values = await this.dialogs.form({
				titleKey: "dialog.timeDilation",
				values: { factor: [1, 1], preserveDuration: false },
				fields: [
					{ id: "factor", type: "rational", style: "fraction", labelKey: "field.factor", required: true },
					{ id: "preserveDuration", type: "checkbox", labelKey: "field.preserveDuration" },
				],
			});
			if (!values) {
				return;
			}
			const factor = Rational.from(values.factor);
			this.commit(i18n.t("history.timeDilation"), model => {
				this._dilateSelection(model, factor, values.preserveDuration);
			});
		}

		_dilateSelection(model, factor, preserveDuration) {
			const roots = model.allEvents().filter(event => event.selected);
			const events = [...new Set(roots.flatMap(event => dilationTargets(model, event)))];
			if (!events.length) {
				return;
			}
			const origin = earliestTime(events);
			for (const event of events) {
				const time = Rational.from(event.time);
				const next = factor.mul(time.sub(origin)).add(origin);
				if (event.duration && !preserveDuration) {
					const end = factor.mul(time.add(event.duration).sub(origin)).add(origin);
					event.duration = end.sub(next).toJSON();
				}
				event.time = next.toJSON();
			}
		}
	};
