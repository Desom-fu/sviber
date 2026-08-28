// The form controls the side panels are built out of.
//
// Every inspector row is one of a small set of controls: a rational beat triple, a plain
// input, a maths expression, an angle with a radians toggle, a radio group or a select. They
// share three conventions that make the inspector work on a multi-item selection:
//
//   * `MIXED` marks a value the selected items disagree on; a control renders it as a blank
//     with a placeholder and reports nothing until the user types something.
//   * a value is committed on `change` and on Enter, never on every keystroke, so typing a
//     partial number never rewrites the chart.
//   * a control that does not apply is hidden rather than removed (`setControlHidden`), so the
//     inspector keeps a stable row order as the selection changes.
//
// Split out of js/panels.js.

import { Rational } from "../core/rational.js";

export const MIXED = Symbol("mixed");

// The value the selected items agree on, or MIXED when they disagree.
export function commonValue(items, getter) {
	if (!items.length) {
		return undefined;
	}
	const first = getter(items[0]);
	const serialized = JSON.stringify(first);
	return items.every(item => JSON.stringify(getter(item)) === serialized) ? first : MIXED;
}

export function clear(element) {
	element.replaceChildren();
}

// A beat is edited as the integer triple `whole + numerator / denominator`, committed only
// once all three parts form a valid rational.
export function makeRationalControl(documentRef, value, onChange) {
	const wrapper = documentRef.createElement("div");
	wrapper.className = "rational-input";
	let tuple = [0, 0, 1];
	if (value !== MIXED) {
		try {
			tuple = Rational.from(value ?? 0).toJSON();
		} catch {
			/* Keep default. */
		}
	}
	const controls = [0, 1, 2].map(index => {
		const input = documentRef.createElement("input");
		input.type = "number";
		input.step = "1";
		input.value = value === MIXED ? "" : tuple[index];
		input.placeholder = value === MIXED ? "-" : "";
		if (index === 2) {
			input.min = "1";
		}
		return input;
	});
	wrapper.append(controls[0], "+", controls[1], "/", controls[2]);
	const emit = () => {
		const values = controls.map(input => Number(input.value));
		if (values.every(Number.isSafeInteger) && values[2] > 0) {
			onChange(Rational.from(values).toJSON());
		}
	};
	for (const input of controls) {
		input.addEventListener("keydown", event => {
			if (event.key === "Enter") {
				event.preventDefault();
				emit();
			}
		});
	}
	wrapper.addEventListener("focusout", event => {
		if (!wrapper.contains(event.relatedTarget)) {
			emit();
		}
	});
	return wrapper;
}

export function makeInput(documentRef, type, value, onChange, options = {}) {
	const input = documentRef.createElement("input");
	input.type = type;
	if (value === MIXED) {
		input.value = "";
		input.placeholder = options.mixed || "-";
	} else if (type === "checkbox") {
		input.checked = Boolean(value);
	} else {
		input.value = value ?? "";
	}
	if (options.step) {
		input.step = options.step;
	}
	if (options.min != null) {
		input.min = options.min;
	}
	const emit = () => {
		if (type === "checkbox") {
			onChange(input.checked);
		} else if (type === "number") {
			const number = Number(input.value);
			if (Number.isFinite(number)) {
				onChange(number);
			}
		} else {
			onChange(input.value);
		}
	};
	input.addEventListener("change", emit);
	if (type !== "checkbox") {
		input.addEventListener("keydown", event => {
			if (event.key === "Enter") {
				event.preventDefault();
				emit();
			}
		});
	}
	return input;
}

// Numeric fields accept a maths expression (`100/3`, `2*pi`) evaluated through mathjs when it
// is loaded, falling back to a plain number.
export function evaluateExpression(value) {
	try {
		const result = globalThis.math?.evaluate?.(String(value));
		const number = Number(result ?? value);
		return Number.isFinite(number) ? number : null;
	} catch {
		const number = Number(value);
		return Number.isFinite(number) ? number : null;
	}
}

export function makeExpressionControl(documentRef, value, onChange, options = {}) {
	const input = documentRef.createElement("input");
	input.type = "text";
	input.inputMode = "decimal";
	input.value = value === MIXED ? "" : String(value ?? "");
	input.placeholder = value === MIXED ? options.mixed || "-" : "";
	const emit = () => {
		const number = evaluateExpression(input.value);
		if (number != null) {
			onChange(number);
		}
	};
	input.addEventListener("change", emit);
	input.addEventListener("keydown", event => {
		if (event.key === "Enter") {
			event.preventDefault();
			emit();
		}
	});
	return input;
}

// Angles are stored in radians but shown in degrees by default; ticking "radians" converts
// what is already typed rather than reinterpreting it.
export function makeAngleControl(documentRef, value, onChange, i18n) {
	const wrapper = documentRef.createElement("div");
	wrapper.className = "angle-input";
	const input = documentRef.createElement("input");
	input.type = "text";
	input.inputMode = "decimal";
	input.value = value === MIXED ? "" : String(((Number(value) || 0) * 180) / Math.PI);
	input.placeholder = value === MIXED ? "-" : "";
	const radiansLine = documentRef.createElement("label");
	radiansLine.className = "checkbox-line";
	const radians = documentRef.createElement("input");
	radians.type = "checkbox";
	const text = documentRef.createElement("span");
	text.textContent = i18n.t("field.radians");
	radiansLine.append(radians, text);
	const emit = () => {
		const number = evaluateExpression(input.value);
		if (number != null) {
			onChange(radians.checked ? number : (number * Math.PI) / 180);
		}
	};
	input.addEventListener("change", emit);
	input.addEventListener("keydown", event => {
		if (event.key === "Enter") {
			event.preventDefault();
			emit();
		}
	});
	radians.addEventListener("change", () => {
		const number = evaluateExpression(input.value);
		if (number == null) {
			return;
		}
		input.value = String(radians.checked ? (number * Math.PI) / 180 : (number * 180) / Math.PI);
	});
	wrapper.append(input, radiansLine);
	return wrapper;
}

export function makeRadioControl(documentRef, options, value, onChange) {
	const wrapper = documentRef.createElement("div");
	wrapper.className = "choice-grid compact-choice-grid";
	const name = `inspector-choice-${Math.random().toString(36).slice(2)}`;
	for (const option of options) {
		const line = documentRef.createElement("label");
		line.className = "radio-line";
		const input = documentRef.createElement("input");
		input.type = "radio";
		input.name = name;
		input.value = String(option.value);
		input.checked = value !== MIXED && String(value) === input.value;
		input.addEventListener("change", () => {
			if (input.checked) {
				onChange(option.value);
			}
		});
		line.append(input, option.label);
		wrapper.append(line);
	}
	return wrapper;
}

export function makeSelect(documentRef, options, value, onChange) {
	const select = documentRef.createElement("select");
	if (value === MIXED) {
		const option = documentRef.createElement("option");
		option.value = "";
		option.textContent = "-";
		option.disabled = true;
		option.selected = true;
		select.append(option);
	}
	for (const item of options) {
		const option = documentRef.createElement("option");
		option.value = String(item.value);
		option.textContent = item.label;
		option.selected = value !== MIXED && String(value) === option.value;
		select.append(option);
	}
	select.addEventListener("change", () => onChange(select.value));
	return select;
}

// v17: Esc in an inspection panel input unfocuses it and restores the value it had
// when the panel was rendered.
export function rememberInitialValues(root) {
	for (const input of root?.querySelectorAll?.("input, select, textarea") || []) {
		input.dataset.initialValue =
			input.type === "checkbox" || input.type === "radio" ? String(input.checked) : String(input.value);
	}
}

export function bindEscapeRestore(root) {
	const listener = event => {
		if (event.key !== "Escape") {
			return;
		}
		const input = event.target;
		if (!input?.matches?.("input, select, textarea")) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const initial = input.dataset.initialValue;
		if (initial !== undefined) {
			if (input.type === "checkbox" || input.type === "radio") {
				input.checked = initial === "true";
			} else {
				input.value = initial;
			}
		}
		input.blur();
	};
	root?.addEventListener?.("keydown", listener);
	return () => root?.removeEventListener?.("keydown", listener);
}

export function setControlDisabled(control, disabled) {
	for (const input of control.matches?.("input,select,textarea,button") ? [control] : []) {
		input.disabled = disabled;
	}
	for (const input of control.querySelectorAll?.("input,select,textarea,button") || []) {
		input.disabled = disabled;
	}
	return control;
}

// The row that owns the control reads this flag when it is appended, so a control that does
// not apply to the current selection leaves its row in place but hidden.
export function setControlHidden(control, hidden) {
	if (control) {
		control.dataset.hidden = hidden ? "true" : "false";
	}
	return control;
}
