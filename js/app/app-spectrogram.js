import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import {
	DEFAULT_SPECTROGRAM,
	SPECTROGRAM_WINDOW_SHAPES,
	normalizeSpectrogram,
} from "../core/spectrogram.js";

class SpectrogramTrait {
	async showSpectrogramDialog() {
		const current = normalizeSpectrogram(this.model.editor.spectrogram);
		const values = await this.dialogs.form({
			titleKey: "dialog.spectrogram",
			values: {
				show: current.show,
				blackAsHigh: current.blackAsHigh,
				windowWidthMs: current.windowWidth * 1000,
				windowShape: current.windowShape,
				frequencyMin: current.frequencyRange[0],
				frequencyMax: current.frequencyRange[1],
				dynamicRange: current.dynamicRange,
			},
			fields: [
				{ id: "show", type: "checkbox", labelKey: "field.spectrogramShow" },
				{ id: "blackAsHigh", type: "checkbox", labelKey: "field.spectrogramBlackAsHigh" },
				{
					id: "windowWidthMs",
					type: "number",
					labelKey: "field.spectrogramWindowWidth",
					min: 0.1,
					step: "any",
					positive: true,
				},
				{
					id: "windowShape",
					type: "select",
					labelKey: "field.spectrogramWindowShape",
					options: SPECTROGRAM_WINDOW_SHAPES.map(value => ({
						value,
						labelKey: `field.spectrogramWindow.${value}`,
					})),
				},
				{ id: "frequencyMin", type: "number", labelKey: "field.spectrogramFrequencyMin", min: 0, step: "any" },
				{ id: "frequencyMax", type: "number", labelKey: "field.spectrogramFrequencyMax", min: 0, step: "any" },
				{
					id: "dynamicRange",
					type: "number",
					labelKey: "field.spectrogramDynamicRange",
					min: 1,
					step: "any",
					positive: true,
				},
			],
		});
		if (!values) {
			return;
		}
		this.commit(i18n.t("history.spectrogram"), model => {
			model.editor.spectrogram = normalizeSpectrogram({
				show: values.show,
				blackAsHigh: values.blackAsHigh,
				windowWidth: Number(values.windowWidthMs) / 1000,
				windowShape: values.windowShape,
				frequencyRange: [values.frequencyMin, values.frequencyMax],
				dynamicRange: values.dynamicRange,
			});
		});
	}
}

export { DEFAULT_SPECTROGRAM };
export const withSpectrogram = composeTraits("SpectrogramLayer", SpectrogramTrait);
