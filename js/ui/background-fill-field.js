import { normalizeRenderFill } from "../core/render-defaults.js";

function renderFillControl({ document: documentRef, i18n: labels, value, onChange, field }) {
	const row = documentRef.createElement("div");
	row.className = "render-fill-row";
	const input = documentRef.createElement("input");
	input.type = "text";
	input.value = value;
	input.spellcheck = false;
	input.setAttribute("aria-label", labels.t(field.labelKey));
	const presets = [["black", "#000000"], ["white", "#ffffff"]];
	const buttons = presets.map(([name, hex]) => {
		const button = documentRef.createElement("button");
		button.type = "button";
		button.className = "dialog-button";
		button.textContent = labels.t(`field.renderBackgroundFill.${name}`);
		button.addEventListener("click", () => {
			input.value = hex;
			update();
		});
		return button;
	});
	function updatePresets() {
		const color = normalizeRenderFill(input.value);
		buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(color === presets[index][1])));
	}

	function update() {
		updatePresets();
		onChange?.({ id: field.id, value: input.value });
	}
	updatePresets();
	row.append(input, ...buttons);
	input.addEventListener("input", update);
	return { element: row, read: () => input.value, focus: () => input.focus() };
}

export const backgroundFillField = {
	id: "backgroundFill",
	type: "custom",
	labelKey: "field.renderBackgroundFill",
	required: true,
	validate: value => normalizeRenderFill(value) ? "" : "validation.renderBackgroundFill",
	render: renderFillControl,
};
