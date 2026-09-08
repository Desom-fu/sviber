// The "Quantization..." dialog of the Transform menu (PROMPT-v25): rounds the times and
// end times of all selected events to the nearest subdivision, with an explicit tie-break
// mode for values that sit exactly between two subdivisions.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { quantizeEventTimes, QUANTIZE_TIE_MODES } from "../core/quantize.js";
import { selected } from "./app-helpers.js";

class QuantizationTrait {
	showQuantizationDialog() {
		return this.showQuantizationDialogInternal();
	}

	canQuantizeSelection() {
		return selected(this.model).length > 0;
	}

	async showQuantizationDialogInternal() {
		const targets = selected(this.model);
		if (!targets.length) {
			return false;
		}
		const values = await this.dialogs.form({
			titleKey: "dialog.quantization",
			values: { denominator: String(this.model.editor.subdivision ?? 4), tie: "even" },
			fields: [
				{
					id: "denominator",
					type: "integer",
					labelKey: "field.quantizationDenominator",
					min: 1,
					step: 1,
					required: true,
				},
				{
					id: "tie",
					type: "select",
					labelKey: "field.quantizationTie",
					options: QUANTIZE_TIE_MODES.map(mode => ({
						value: mode,
						label: i18n.t(`field.quantizationTie.${mode}`),
					})),
				},
			],
		});
		if (!values) {
			return false;
		}
		const denominator = Math.max(1, Math.round(Number(values.denominator) || 1));
		const tie = QUANTIZE_TIE_MODES.includes(values.tie) ? values.tie : "even";
		this.commit(i18n.t("history.quantization"), model => {
			for (const event of selected(model)) {
				const changes = quantizeEventTimes(event, denominator, tie);
				event.time = changes.time;
				if (changes.duration != null && event.duration != null) {
					event.duration = changes.duration;
				}
			}
		});
		return true;
	}
}

export const withQuantization = composeTraits("QuantizationLayer", QuantizationTrait);
