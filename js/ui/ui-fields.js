import { i18n as defaultI18n } from "./i18n.js";
import { nextControlId } from "./ui-shared.js";
import { AFFINE_MATRIX_GRID } from "../core/geometry.js";
import { Rational } from "../core/rational.js";

export const MIXED_VALUE = Symbol("mixed-value");

export function initialValue(field, suppliedValues = {}) {
	if (Object.hasOwn(suppliedValues, field.id)) {
		return suppliedValues[field.id];
	}
	if (Object.hasOwn(field, "value")) {
		return typeof field.value === "function" ? field.value(suppliedValues) : field.value;
	}
	if (Object.hasOwn(field, "default")) {
		return typeof field.default === "function" ? field.default(suppliedValues) : field.default;
	}
	return null;
}

function makeInput(documentRef, type, value, field = {}) {
	const input = documentRef.createElement("input");
	input.type = type;
	if (value !== null && value !== undefined && value !== MIXED_VALUE) {
		if (type === "checkbox") {
			input.checked = Boolean(value);
		} else {
			input.value = String(value);
		}
	}
	for (const attribute of ["min", "max", "step", "accept", "placeholder", "autocomplete"]) {
		if (field[attribute] !== undefined) {
			input.setAttribute(attribute, String(field[attribute]));
		}
	}
	return input;
}

function attachControlEvents(element, callback) {
	const listener = event => callback(event);
	element.addEventListener("input", listener);
	element.addEventListener("change", listener);
	return () => {
		element.removeEventListener("input", listener);
		element.removeEventListener("change", listener);
	};
}

function setInputsDisabled(element, disabled) {
	for (const input of element.matches?.("input, select, textarea, button") ? [element] : []) {
		input.disabled = disabled;
	}
	for (const input of element.querySelectorAll?.("input, select, textarea, button") || []) {
		input.disabled = disabled;
	}
}

function optionLabel(i18n, option) {
	if (typeof option !== "object" || option === null) {
		return String(option);
	}
	if (option.labelKey) {
		return i18n.t(option.labelKey);
	}
	return String(option.label ?? option.value ?? "");
}

function optionValue(option) {
	return typeof option === "object" && option !== null ? option.value : option;
}

// A label for a nested field, hooked up to the tooltip manager when there is one.
function createSubfieldLabel(subfield, environment) {
	const { document: documentRef, i18n, tooltip } = environment;
	const label = documentRef.createElement("label");
	label.textContent = subfield.labelKey ? i18n.t(subfield.labelKey) : String(subfield.label || subfield.id);
	const tooltipValue = subfield.tooltipKey || subfield.labelKey || subfield.tooltip || subfield.label || subfield.id;
	const tooltipRaw = !subfield.tooltipKey && !subfield.labelKey;
	if (tooltip) {
		tooltip.register(label, tooltipValue, { raw: tooltipRaw });
	} else {
		label.title = tooltipRaw ? String(tooltipValue) : i18n.t(tooltipValue);
	}
	return label;
}

// One entry of an array field. An array of records (`field.fields`) becomes a small form whose
// value is an object; anything else is a single control of `field.itemType`.
function createArrayItemControls(field, itemValue, environment) {
	const { document: documentRef, tooltip } = environment;
	if (!Array.isArray(field.fields)) {
		const itemField = {
			id: `${field.id}-item`,
			type: field.itemType || "text",
			...(field.item || {}),
		};
		return createFieldControl(itemField, itemValue, environment);
	}
	const content = documentRef.createElement("div");
	const controls = field.fields.map(subfield => {
		const wrapper = documentRef.createElement("div");
		wrapper.className = "dialog-field";
		const label = createSubfieldLabel(subfield, environment);
		const control = createFieldControl(subfield, itemValue?.[subfield.id], environment);
		wrapper.append(label, control.element);
		content.appendChild(wrapper);
		return { field: subfield, control, label };
	});
	return {
		element: content,
		read: () => Object.fromEntries(controls.map(({ field: subfield, control }) => [subfield.id, control.read()])),
		setDisabled: disabled => controls.forEach(({ control }) => control.setDisabled(disabled)),
		destroy: () =>
			controls.forEach(({ control, label }) => {
				control.destroy?.();
				tooltip?.unregister(label);
			}),
	};
}

// The reorder and remove buttons act on the row's position at click time, not at build time,
// because rows above it may have been removed in between.
function attachArrayRowActions(row, actions, context) {
	const { documentRef, i18n, editor, rows, updateButtons, onChange } = context;
	const action = (text, titleKey, handler) => {
		const button = documentRef.createElement("button");
		button.type = "button";
		button.className = "icon-button";
		button.textContent = text;
		button.title = i18n.t(titleKey);
		button.addEventListener("click", handler);
		actions.appendChild(button);
		return button;
	};
	row.up = action("\u2191", "dialog.moveUp", () => {
		const current = rows.indexOf(row);
		if (current <= 0) {
			return;
		}
		rows.splice(current, 1);
		rows.splice(current - 1, 0, row);
		editor.insertBefore(row.element, rows[current].element);
		updateButtons();
		onChange?.();
	});
	row.down = action("\u2193", "dialog.moveDown", () => {
		const current = rows.indexOf(row);
		if (current < 0 || current >= rows.length - 1) {
			return;
		}
		const next = rows[current + 1];
		rows.splice(current, 1);
		rows.splice(current + 1, 0, row);
		editor.insertBefore(next.element, row.element);
		updateButtons();
		onChange?.();
	});
	row.remove = action("\u00d7", "dialog.remove", () => {
		const current = rows.indexOf(row);
		if (current >= 0) {
			rows.splice(current, 1);
		}
		row.control.destroy?.();
		row.element.remove();
		updateButtons();
		onChange?.();
	});
}

function createArrayControl(field, value, environment) {
	const { document: documentRef, i18n, onChange } = environment;
	const root = documentRef.createElement("div");
	const editor = documentRef.createElement("div");
	editor.className = "array-editor";
	root.appendChild(editor);
	const addButton = documentRef.createElement("button");
	addButton.type = "button";
	addButton.className = "panel-button";
	addButton.textContent = i18n.t("dialog.add");
	root.appendChild(addButton);
	const rows = [];

	const updateButtons = () => {
		rows.forEach((row, index) => {
			row.up.disabled = index === 0;
			row.down.disabled = index === rows.length - 1;
		});
	};
	const rowContext = { documentRef, i18n, editor, rows, updateButtons, onChange };

	const addRow = (itemValue, index = rows.length) => {
		const rowElement = documentRef.createElement("div");
		rowElement.className = "array-row";
		const control = createArrayItemControls(field, itemValue, environment);
		rowElement.appendChild(control.element);
		const actions = documentRef.createElement("div");
		actions.className = "array-actions";
		const row = { element: rowElement, control };
		attachArrayRowActions(row, actions, rowContext);
		rowElement.appendChild(actions);
		rows.splice(index, 0, row);
		if (index >= editor.children.length) {
			editor.appendChild(rowElement);
		} else {
			editor.insertBefore(rowElement, editor.children[index]);
		}
		updateButtons();
	};

	for (const itemValue of Array.isArray(value) ? value : []) {
		addRow(itemValue);
	}
	addButton.addEventListener("click", () => {
		const valueFactory = field.newItem;
		addRow(typeof valueFactory === "function" ? valueFactory(rows.length) : (valueFactory ?? null));
		onChange?.();
	});
	return {
		element: root,
		read: () => rows.map(row => row.control.read()),
		setDisabled: disabled => {
			addButton.disabled = disabled;
			rows.forEach(row => {
				row.control.setDisabled(disabled);
				row.up.disabled = disabled;
				row.down.disabled = disabled;
				row.remove.disabled = disabled;
			});
			if (!disabled) {
				updateButtons();
			}
		},
		focus: () => addButton.focus(),
		destroy: () => rows.forEach(row => row.control.destroy?.()),
	};
}

// A nested field may declare `disabled` as a predicate over the group's current values, so the
// whole group is re-evaluated whenever anything inside it changes.
function nestedFieldDisabled(field, current) {
	if (typeof field.disabled === "function") {
		return Boolean(field.disabled(current));
	}
	return Boolean(field.disabled);
}

function createNestedFieldEntries(field, value, environment, root) {
	const { document: documentRef } = environment;
	return (field.fields || []).map(subfield => {
		const wrapper = documentRef.createElement("div");
		wrapper.className = "dialog-field";
		const label = createSubfieldLabel(subfield, environment);
		label.className = "field-label";
		const control = createFieldControl(
			subfield,
			value?.[subfield.id] ?? initialValue(subfield, value || {}),
			environment,
		);
		wrapper.append(label, control.element);
		root.appendChild(wrapper);
		return { field: subfield, control, label, wrapper };
	});
}

function bindNestedEntries(root, entries, environment) {
	const { onChange, tooltip } = environment;
	const read = () =>
		Object.fromEntries(entries.map(({ field: subfield, control }) => [subfield.id, control.read()]));
	const refresh = () => {
		const current = read();
		for (const entry of entries) {
			const disabled = nestedFieldDisabled(entry.field, current);
			entry.control.setDisabled(disabled);
			entry.wrapper.classList.toggle("is-disabled", disabled);
		}
	};
	root.addEventListener("input", () => {
		refresh();
		onChange?.({ target: root, type: "input" });
	});
	refresh();
	return {
		element: root,
		read,
		setDisabled: disabled => {
			if (disabled) {
				for (const entry of entries) {
					entry.control.setDisabled(true);
					entry.wrapper.classList.toggle("is-disabled", true);
				}
				return;
			}
			refresh();
		},
		focus: () => entries[0]?.control.focus?.(),
		destroy: () => {
			for (const entry of entries) {
				entry.control.destroy?.();
				tooltip?.unregister(entry.label);
			}
		},
	};
}

function createDetailsControl(field, value, environment) {
	const { document: documentRef, i18n } = environment;
	const details = documentRef.createElement("details");
	details.className = "dialog-details";
	const summary = documentRef.createElement("summary");
	summary.textContent = field.summaryKey ? i18n.t(field.summaryKey) : String(field.summary || field.id);
	details.appendChild(summary);
	if (field.open) {
		details.open = true;
	}
	return bindNestedEntries(details, createNestedFieldEntries(field, value, environment, details), environment);
}

function createGroupControl(field, value, environment) {
	const { document: documentRef } = environment;
	const group = documentRef.createElement("fieldset");
	group.className = "dialog-group";
	return bindNestedEntries(group, createNestedFieldEntries(field, value, environment, group), environment);
}

function buildTextareaControl({ documentRef, field, value }) {
	const textarea = documentRef.createElement("textarea");
	textarea.rows = field.rows || 3;
	textarea.value = value === MIXED_VALUE || value == null ? "" : String(value);
	if (field.placeholder) {
		textarea.placeholder = field.placeholder;
	}
	return { element: textarea, read: () => textarea.value, focus: () => textarea.focus() };
}

function buildNumberControl({ documentRef, i18n, field, value, type }) {
	const input = makeInput(documentRef, "number", value, field);
	if (type === "integer" && field.step === undefined) {
		input.step = "1";
	}
	const read = () => (input.value === "" ? null : Number(input.value));
	if (!field.unit && !field.action) {
		return { element: input, read, focus: () => input.focus() };
	}
	const wrap = documentRef.createElement("div");
	wrap.className = "field-control-row";
	wrap.append(input);
	if (field.unit) {
		const unit = documentRef.createElement("span");
		unit.className = "field-unit";
		unit.textContent = field.unit;
		wrap.append(unit);
	}
	if (field.action) {
		const button = documentRef.createElement("button");
		button.type = "button";
		button.className = "panel-button";
		button.textContent = field.action.labelKey ? i18n.t(field.action.labelKey) : String(field.action.label || "");
		button.addEventListener("click", event => {
			event.preventDefault();
			field.action.onClick?.(input, button);
		});
		wrap.append(button);
	}
	return { element: wrap, read, focus: () => input.focus() };
}

function buildTextControl({ documentRef, i18n, field, value }) {
	const input = makeInput(documentRef, "text", value, field);
	if (value === MIXED_VALUE) {
		input.placeholder = i18n.t("panel.mixed");
	}
	return { element: input, read: () => input.value, focus: () => input.focus() };
}

function buildColorControl({ documentRef, field, value }) {
	const input = makeInput(documentRef, "color", value || field.default || "#808080", field);
	return { element: input, read: () => input.value, focus: () => input.focus() };
}

function buildFileControl({ documentRef, field }) {
	const input = makeInput(documentRef, "file", null, field);
	if (field.multiple) {
		input.multiple = true;
	}
	return {
		element: input,
		read: () => (input.multiple ? [...input.files] : input.files[0] || null),
		focus: () => input.focus(),
	};
}

function buildSelectControl({ documentRef, i18n, field, value }) {
	const select = documentRef.createElement("select");
	for (const optionData of field.options || []) {
		const option = documentRef.createElement("option");
		option.value = String(optionValue(optionData));
		option.textContent = optionLabel(i18n, optionData);
		option.disabled = Boolean(optionData?.disabled);
		select.appendChild(option);
	}
	if (value !== MIXED_VALUE && value != null) {
		select.value = String(value);
	}
	return {
		element: select,
		read: () => (field.numeric ? Number(select.value) : select.value),
		focus: () => select.focus(),
	};
}

function sliderOutputText(field, number) {
	if (!Number.isFinite(number)) {
		return "";
	}
	return field.formatValue ? field.formatValue(number) : String(number);
}

// The slider is the one control that reports while it is being dragged, so it wires its own
// listeners and mirrors the live value into an <output> beside the track.
function buildSliderControl({ documentRef, field, value, notify }) {
	const group = documentRef.createElement("div");
	group.className = "slider-field";
	const input = documentRef.createElement("input");
	input.type = "range";
	if (field.min != null) {
		input.min = String(field.min);
	}
	if (field.max != null) {
		input.max = String(field.max);
	}
	if (field.step != null) {
		input.step = String(field.step);
	}
	input.value = value == null || value === MIXED_VALUE ? String(field.default ?? field.min ?? 0) : String(value);
	const output = documentRef.createElement("output");
	output.htmlFor = input.id = nextControlId("slider");
	const update = () => {
		output.value = sliderOutputText(field, Number(input.value));
		output.textContent = output.value;
	};
	input.addEventListener("input", () => {
		update();
		notify({ target: input, type: "input" });
	});
	input.addEventListener("change", () => notify({ target: input, type: "change" }));
	update();
	group.append(input, output);
	return { element: group, read: () => Number(input.value), focus: () => input.focus() };
}

function buildCheckboxControl({ documentRef, i18n, field, value }) {
	const line = documentRef.createElement("label");
	line.className = "checkbox-line";
	const input = makeInput(documentRef, "checkbox", value, field);
	input.indeterminate = value === MIXED_VALUE;
	const text = documentRef.createElement("span");
	text.textContent = field.choiceLabelKey ? i18n.t(field.choiceLabelKey) : String(field.choiceLabel || "");
	line.append(input, text);
	return { element: line, read: () => input.checked, focus: () => input.focus() };
}

function buildRadioControl({ documentRef, i18n, field, value }) {
	const grid = documentRef.createElement("div");
	grid.className = "choice-grid";
	const name = nextControlId("field-radio");
	const inputs = [];
	for (const optionData of field.options || []) {
		const line = documentRef.createElement("label");
		line.className = "radio-line";
		const input = makeInput(documentRef, "radio", null, field);
		input.name = name;
		input.value = String(optionValue(optionData));
		input.checked = value != null && String(value) === input.value;
		input.disabled = Boolean(optionData?.disabled);
		line.append(input, optionLabel(i18n, optionData));
		grid.appendChild(line);
		inputs.push(input);
	}
	return {
		element: grid,
		read: () => {
			const selected = inputs.find(input => input.checked);
			if (!selected) {
				return null;
			}
			return field.numeric ? Number(selected.value) : selected.value;
		},
		focus: () => (inputs.find(input => input.checked) || inputs[0])?.focus(),
	};
}

// A rational is either three integer inputs (whole + numerator / denominator) or, when
// field.style === "fraction", two inputs (numerator / denominator). Leaving the group
// rewrites them in canonical form so the user sees the value the chart will actually store;
// a half-typed tuple is left alone.
function buildRationalControl({ documentRef, field, value }) {
	const fraction = field?.style === "fraction";
	const tuple = Array.isArray(value) ? value : fraction ? [0, 1] : [0, 0, 1];
	const group = documentRef.createElement("div");
	group.className = fraction ? "rational-input rational-input-fraction" : "rational-input";
	const numerator = makeInput(
		documentRef,
		"number",
		fraction ? (tuple[0] ?? 0) : (tuple[1] ?? 0),
		{ step: 1 },
	);
	const denominator = makeInput(
		documentRef,
		"number",
		fraction ? (tuple[1] ?? 1) : (tuple[2] ?? 1),
		{ step: 1, min: 1 },
	);
	let integer = null;
	if (fraction) {
		group.append(numerator, "/", denominator);
	} else {
		integer = makeInput(documentRef, "number", tuple[0] ?? 0, { step: 1 });
		group.append(integer, "+", numerator, "/", denominator);
	}
	const rawTuple = () => {
		if (fraction) {
			return [Number(numerator.value), Number(denominator.value)];
		}
		return [Number(integer.value), Number(numerator.value), Number(denominator.value)];
	};
	const usableTuple = () => {
		const raw = rawTuple();
		const den = fraction ? raw[1] : raw[2];
		return raw.every(Number.isSafeInteger) && den > 0 ? raw : null;
	};
	group.addEventListener("focusout", event => {
		if (group.contains(event.relatedTarget)) {
			return;
		}
		const raw = usableTuple();
		if (!raw) {
			return;
		}
		const canonical = canonicalizeRationalTuple(raw);
		if (fraction) {
			numerator.value = String(canonical[0]);
			denominator.value = String(canonical[1]);
		} else {
			integer.value = String(canonical[0]);
			numerator.value = String(canonical[1]);
			denominator.value = String(canonical[2]);
		}
	});
	return {
		element: group,
		read: () => {
			const raw = usableTuple();
			return raw ? canonicalizeRationalTuple(raw) : rawTuple();
		},
		focus: () => (fraction ? numerator : integer).focus(),
	};
}

function buildPairControl({ documentRef, field, value }) {
	const pair = Array.isArray(value) ? value : ["", ""];
	const group = documentRef.createElement("div");
	group.className = "pair-input";
	const inputType = field.numeric ? "number" : "text";
	const first = makeInput(documentRef, inputType, pair[0] ?? "", field);
	const second = makeInput(documentRef, inputType, pair[1] ?? "", field);
	group.append(first, second);
	const numberOrNull = input => (input.value === "" ? null : Number(input.value));
	return {
		element: group,
		read: () => {
			if (field.numeric) {
				return [numberOrNull(first), numberOrNull(second)];
			}
			return [first.value, second.value];
		},
		focus: () => first.focus(),
	};
}

function buildAngleControl({ documentRef, i18n, field, value }) {
	const angle = typeof value === "object" && value !== null ? value : { value: value ?? "", radians: false };
	const group = documentRef.createElement("div");
	const input = makeInput(documentRef, "text", angle.value ?? angle.expression ?? "", field);
	const line = documentRef.createElement("label");
	line.className = "checkbox-line";
	const radians = makeInput(documentRef, "checkbox", angle.radians, field);
	line.append(radians, i18n.t("field.radians"));
	group.append(input, line);
	return {
		element: group,
		read: () => ({ value: input.value, radians: radians.checked }),
		focus: () => input.focus(),
	};
}

// A range value may arrive as a `[min, max]` pair or as an object with an `exclusive` flag.
function rangeFromValue(field, value) {
	if (Array.isArray(value)) {
		return { min: value[0], max: value[1], exclusive: field.exclusive ?? true };
	}
	return value || { min: 0, max: 1, exclusive: field.exclusive ?? true };
}

function buildRangeControl({ documentRef, i18n, field, value }) {
	const range = rangeFromValue(field, value);
	const group = documentRef.createElement("div");
	const pair = documentRef.createElement("div");
	pair.className = "pair-input";
	const min = makeInput(documentRef, "number", range.min, { step: 1 });
	const max = makeInput(documentRef, "number", range.max, { step: 1 });
	pair.append(min, max);
	const line = documentRef.createElement("label");
	line.className = "checkbox-line";
	const exclusive = makeInput(documentRef, "checkbox", range.exclusive, field);
	line.append(exclusive, i18n.t("field.exclusiveUpper"));
	group.append(pair, line);
	return {
		element: group,
		read: () => ({ min: Number(min.value), max: Number(max.value), exclusive: exclusive.checked }),
		focus: () => min.focus(),
	};
}

// An affine transform is six numbers laid out as two rows of three, which is the order
// AFFINE_MATRIX_GRID describes.
function buildMatrixControl({ documentRef, field, value }) {
	const matrix = Array.isArray(value) ? value : [1, 0, 0, 1, 0, 0];
	const group = documentRef.createElement("div");
	group.className = "matrix-input";
	const inputType = field.numeric ? "number" : "text";
	const inputs = matrix.slice(0, 6).map(itemValue => makeInput(documentRef, inputType, itemValue, field));
	while (inputs.length < 6) {
		inputs.push(makeInput(documentRef, inputType, 0, field));
	}
	for (const index of AFFINE_MATRIX_GRID) {
		group.append(inputs[index]);
	}
	return {
		element: group,
		read: () => inputs.map(input => (field.numeric ? Number(input.value) : input.value)),
		focus: () => inputs[0].focus(),
	};
}

// One builder per leaf field type. The composite types (`custom`, `array`, `details` and `group`)
// are handled by createFieldControl itself because they nest other fields.
const LEAF_CONTROL_BUILDERS = {
	textarea: buildTextareaControl,
	number: buildNumberControl,
	integer: buildNumberControl,
	text: buildTextControl,
	expression: buildTextControl,
	color: buildColorControl,
	file: buildFileControl,
	select: buildSelectControl,
	slider: buildSliderControl,
	checkbox: buildCheckboxControl,
	radio: buildRadioControl,
	rational: buildRationalControl,
	pair: buildPairControl,
	angle: buildAngleControl,
	range: buildRangeControl,
	matrix: buildMatrixControl,
};

// A `custom` field renders itself; it may return either a control object or a bare element.
function createCustomControl(field, value, { documentRef, i18n, notify }) {
	const custom = field.render({ document: documentRef, i18n, value, onChange: notify, field });
	if (custom?.element) {
		return {
			...custom,
			setDisabled: custom.setDisabled || (disabled => setInputsDisabled(custom.element, disabled)),
			read: custom.read || (() => null),
		};
	}
	return {
		element: custom,
		read: () => null,
		setDisabled: disabled => setInputsDisabled(custom, disabled),
	};
}

export function createFieldControl(field, value, environment = {}) {
	const documentRef = environment.document || globalThis.document;
	const i18n = environment.i18n || defaultI18n;
	const notify = event => environment.onChange?.(event);
	const type = field.type || "text";

	if (type === "custom" && typeof field.render === "function") {
		return createCustomControl(field, value, { documentRef, i18n, notify });
	}
	if (type === "array") {
		return createArrayControl(field, value, { ...environment, document: documentRef, i18n, onChange: notify });
	}
	if (type === "details") {
		return createDetailsControl(field, value, { ...environment, document: documentRef, i18n, onChange: notify });
	}
	if (type === "group") {
		return createGroupControl(field, value, { ...environment, document: documentRef, i18n, onChange: notify });
	}

	const build = LEAF_CONTROL_BUILDERS[type];
	if (!build) {
		throw new Error(`Unknown field type: ${type}`);
	}
	const { element, read, focus } = build({ documentRef, i18n, field, value, type, notify });
	const cleanups = [];
	// The three parts of a rational only mean anything together, so it reports when focus leaves
	// the whole group rather than on every keystroke in one of its inputs.
	if (type === "rational") {
		const listener = event => {
			if (!element.contains(event.relatedTarget)) {
				notify(event);
			}
		};
		element.addEventListener("focusout", listener);
		cleanups.push(() => element.removeEventListener("focusout", listener));
	} else {
		cleanups.push(attachControlEvents(element, notify));
	}
	return {
		element,
		read,
		focus,
		setDisabled: disabled => setInputsDisabled(element, disabled),
		destroy: () => cleanups.forEach(cleanup => cleanup()),
	};
}

function validationText(result, i18n) {
	if (!result) {
		return "";
	}
	if (typeof result === "object") {
		return i18n.t(result.key, result.params || {});
	}
	return i18n.t(String(result));
}

function isFiniteExpression(value) {
	try {
		const evaluated = globalThis.math?.evaluate?.(String(value));
		return Number.isFinite(Number(evaluated ?? value));
	} catch {
		return Number.isFinite(Number(value));
	}
}

export function canonicalizeRationalTuple(value) {
	if (!Array.isArray(value) || !value.every(Number.isSafeInteger)) {
		return value;
	}
	if (value.length === 2) {
		if (value[1] <= 0) {
			return value;
		}
		try {
			const rational = Rational.from(value);
			return [Number(rational.numerator), Number(rational.denominator)];
		} catch {
			return value;
		}
	}
	if (value.length !== 3 || value[2] <= 0) {
		return value;
	}
	try {
		return Rational.from(value).toJSON();
	} catch {
		return value;
	}
}

function rationalTupleIsCanonical(value) {
	if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isSafeInteger)) {
		return false;
	}
	try {
		const canonical = Rational.from(value).toJSON();
		return canonical.every((item, index) => item === value[index]);
	} catch {
		return false;
	}
}

function validateNumberField(field, value, i18n) {
	if (!Number.isFinite(value)) {
		return i18n.t("validation.number");
	}
	if (field.min != null && value < Number(field.min)) {
		return i18n.t(field.min >= 0 ? "validation.nonnegative" : "validation.number");
	}
	if (field.max != null && value > Number(field.max)) {
		return i18n.t("validation.number");
	}
	return "";
}

function validateIntegerField(field, value, i18n) {
	if (!Number.isInteger(value)) {
		return i18n.t("validation.integer");
	}
	if (field.min != null && value < Number(field.min)) {
		return i18n.t(field.min > 0 ? "validation.positive" : "validation.nonnegative");
	}
	return "";
}

function validateRationalField(field, value, i18n) {
	if (!Array.isArray(value) || !value.every(Number.isInteger)) {
		return i18n.t("validation.integer");
	}
	const fraction = field.style === "fraction";
	if (fraction) {
		if (value.length !== 2 || value[1] <= 0) {
			return i18n.t("validation.denominator");
		}
	} else if (value.length !== 3 || value[2] <= 0) {
		return i18n.t("validation.denominator");
	}
	if (field.positive && Rational.from(value).compare(0) <= 0) {
		return i18n.t("validation.positive");
	}
	if (field.nonnegative && Rational.from(value).compare(0) < 0) {
		return i18n.t("validation.nonnegative");
	}
	return "";
}

function validatePairField(field, value, i18n) {
	if (field.numeric && value.some(item => !Number.isFinite(item))) {
		return i18n.t("validation.number");
	}
	if (field.integer && value.some(item => !Number.isInteger(item))) {
		return i18n.t("validation.integer");
	}
	if (field.expression && value.some(item => !isFiniteExpression(item))) {
		return i18n.t("validation.number");
	}
	if (field.required && value.some(item => item == null || item === "")) {
		return i18n.t("validation.required");
	}
	return "";
}

function validateExpressionField(field, value, i18n) {
	return isFiniteExpression(value) ? "" : i18n.t("validation.number");
}

function validateAngleField(field, value, i18n) {
	if (field.required && !value.value.trim()) {
		return i18n.t("validation.required");
	}
	if (value.value !== "" && !isFiniteExpression(value.value)) {
		return i18n.t("validation.number");
	}
	return "";
}

function validateRangeField(field, value, i18n) {
	if (!Number.isInteger(value.min) || !Number.isInteger(value.max)) {
		return i18n.t("validation.integer");
	}
	if (value.min > value.max) {
		return i18n.t("validation.range");
	}
	return "";
}

function validateMatrixField(field, value, i18n) {
	if (field.numeric && value.some(item => !Number.isFinite(item))) {
		return i18n.t("validation.number");
	}
	if (field.required && value.some(item => item === "")) {
		return i18n.t("validation.required");
	}
	return "";
}

// An array is valid when it is long enough and every entry passes the field (or fields) that
// describe an entry, so this recurses back into validateField.
function validateArrayField(field, value, i18n) {
	if (field.minItems && value.length < field.minItems) {
		return i18n.t("validation.minItems", { count: field.minItems });
	}
	for (const item of value) {
		if (Array.isArray(field.fields)) {
			for (const subfield of field.fields) {
				const error = validateField(subfield, item?.[subfield.id], item || {}, i18n);
				if (error) {
					return error;
				}
			}
		} else {
			const itemField = { type: field.itemType || "text", ...(field.item || {}) };
			const error = validateField(itemField, item, item, i18n);
			if (error) {
				return error;
			}
		}
	}
	return "";
}

function validateNestedFields(field, value, i18n) {
	const current = value && typeof value === "object" && !Array.isArray(value) ? value : {};
	for (const subfield of field.fields || []) {
		if (nestedFieldDisabled(subfield, current)) {
			continue;
		}
		const error = validateField(subfield, current[subfield.id], current, i18n);
		if (error) {
			return error;
		}
	}
	return "";
}

// One validator per field type that has constraints of its own; types not listed here are only
// subject to `required` and the field's own `validate` callback.
const FIELD_VALIDATORS = {
	number: validateNumberField,
	integer: validateIntegerField,
	rational: validateRationalField,
	pair: validatePairField,
	expression: validateExpressionField,
	angle: validateAngleField,
	range: validateRangeField,
	matrix: validateMatrixField,
	array: validateArrayField,
	details: validateNestedFields,
	group: validateNestedFields,
};

export function validateField(field, value, values, i18n = defaultI18n) {
	if (field.required) {
		const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
		if (empty) {
			return i18n.t("validation.required");
		}
	}
	if (value == null || value === "") {
		return "";
	}
	const error = FIELD_VALIDATORS[field.type]?.(field, value, i18n);
	if (error) {
		return error;
	}
	if (typeof field.validate === "function") {
		return validationText(field.validate(value, values, field), i18n);
	}
	return "";
}
