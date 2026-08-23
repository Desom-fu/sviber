import {i18n as defaultI18n} from './i18n.js';
import {nextControlId} from './ui-shared.js';
import {AFFINE_MATRIX_GRID} from './core/geometry.js';
import {Rational} from './core/rational.js';

export const MIXED_VALUE = Symbol('mixed-value');

export function initialValue(field, suppliedValues = {}) {
	if (Object.hasOwn(suppliedValues, field.id)) {
		return suppliedValues[field.id];
	}
	if (Object.hasOwn(field, 'value')) {
		return typeof field.value === 'function' ? field.value(suppliedValues) : field.value;
	}
	if (Object.hasOwn(field, 'default')) {
		return typeof field.default === 'function' ? field.default(suppliedValues) : field.default;
	}
	return null;
}

function makeInput(documentRef, type, value, field = {}) {
	const input = documentRef.createElement('input');
	input.type = type;
	if (value !== null && value !== undefined && value !== MIXED_VALUE) {
		if (type === 'checkbox') {
			input.checked = Boolean(value);
		} else {
			input.value = String(value);
		}
	}
	for (const attribute of ['min', 'max', 'step', 'accept', 'placeholder', 'autocomplete']) {
		if (field[attribute] !== undefined) {
			input.setAttribute(attribute, String(field[attribute]));
		}
	}
	return input;
}

function attachControlEvents(element, callback) {
	const listener = event => callback(event);
	element.addEventListener('input', listener);
	element.addEventListener('change', listener);
	return () => {
		element.removeEventListener('input', listener);
		element.removeEventListener('change', listener);
	};
}

function setInputsDisabled(element, disabled) {
	for (const input of element.matches?.('input, select, textarea, button') ? [element] : []) {
		input.disabled = disabled;
	}
	for (const input of element.querySelectorAll?.('input, select, textarea, button') || []) {
		input.disabled = disabled;
	}
}

function optionLabel(i18n, option) {
	if (typeof option !== 'object' || option === null) {
		return String(option);
	}
	if (option.labelKey) {
		return i18n.t(option.labelKey);
	}
	return String(option.label ?? option.value ?? '');
}

function optionValue(option) {
	return typeof option === 'object' && option !== null ? option.value : option;
}

function createArrayControl(field, value, environment) {
	const {document: documentRef, i18n, onChange, tooltip} = environment;
	const root = documentRef.createElement('div');
	const editor = documentRef.createElement('div');
	editor.className = 'array-editor';
	root.appendChild(editor);
	const addButton = documentRef.createElement('button');
	addButton.type = 'button';
	addButton.className = 'panel-button';
	addButton.textContent = i18n.t('dialog.add');
	root.appendChild(addButton);
	const rows = [];

	const createItemControls = itemValue => {
		if (Array.isArray(field.fields)) {
			const content = documentRef.createElement('div');
			const controls = field.fields.map(subfield => {
				const wrapper = documentRef.createElement('div');
				wrapper.className = 'dialog-field';
				const label = documentRef.createElement('label');
				label.textContent = subfield.labelKey ? i18n.t(subfield.labelKey) : String(subfield.label || subfield.id);
				const tooltipValue = subfield.tooltipKey || subfield.labelKey || subfield.tooltip || subfield.label || subfield.id;
				const tooltipRaw = !subfield.tooltipKey && !subfield.labelKey;
				if (tooltip) tooltip.register(label, tooltipValue, {raw: tooltipRaw});
				else label.title = tooltipRaw ? String(tooltipValue) : i18n.t(tooltipValue);
				const control = createFieldControl(subfield, itemValue?.[subfield.id], environment);
				wrapper.append(label, control.element);
				content.appendChild(wrapper);
				return {field: subfield, control, label};
			});
			return {
				element: content,
				read: () => Object.fromEntries(controls.map(({field: subfield, control}) => [subfield.id, control.read()])),
				setDisabled: disabled => controls.forEach(({control}) => control.setDisabled(disabled)),
				destroy: () => controls.forEach(({control, label}) => {
					control.destroy?.();
					tooltip?.unregister(label);
				})
			};
		}
		const itemField = {
			id: `${field.id}-item`,
			type: field.itemType || 'text',
			...(field.item || {})
		};
		return createFieldControl(itemField, itemValue, environment);
	};

	const updateButtons = () => {
		rows.forEach((row, index) => {
			row.up.disabled = index === 0;
			row.down.disabled = index === rows.length - 1;
		});
	};

	const addRow = (itemValue, index = rows.length) => {
		const rowElement = documentRef.createElement('div');
		rowElement.className = 'array-row';
		const control = createItemControls(itemValue);
		rowElement.appendChild(control.element);
		const actions = documentRef.createElement('div');
		actions.className = 'array-actions';
		const action = (text, titleKey, handler) => {
			const button = documentRef.createElement('button');
			button.type = 'button';
			button.className = 'icon-button';
			button.textContent = text;
			button.title = i18n.t(titleKey);
			button.addEventListener('click', handler);
			actions.appendChild(button);
			return button;
		};
		const row = {element: rowElement, control};
		row.up = action('\u2191', 'dialog.moveUp', () => {
			const current = rows.indexOf(row);
			if (current <= 0) return;
			rows.splice(current, 1);
			rows.splice(current - 1, 0, row);
			editor.insertBefore(row.element, rows[current].element);
			updateButtons();
			onChange?.();
		});
		row.down = action('\u2193', 'dialog.moveDown', () => {
			const current = rows.indexOf(row);
			if (current < 0 || current >= rows.length - 1) return;
			const next = rows[current + 1];
			rows.splice(current, 1);
			rows.splice(current + 1, 0, row);
			editor.insertBefore(next.element, row.element);
			updateButtons();
			onChange?.();
		});
		row.remove = action('\u00d7', 'dialog.remove', () => {
			const current = rows.indexOf(row);
			if (current >= 0) rows.splice(current, 1);
			row.control.destroy?.();
			row.element.remove();
			updateButtons();
			onChange?.();
		});
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
	addButton.addEventListener('click', () => {
		const valueFactory = field.newItem;
		addRow(typeof valueFactory === 'function' ? valueFactory(rows.length) : valueFactory ?? null);
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
		destroy: () => rows.forEach(row => row.control.destroy?.())
	};
}

export function createFieldControl(field, value, environment = {}) {
	const documentRef = environment.document || globalThis.document;
	const i18n = environment.i18n || defaultI18n;
	const notify = event => environment.onChange?.(event);
	const cleanups = [];
	let element;
	let read;
	let focus;
	const type = field.type || 'text';

	if (type === 'custom' && typeof field.render === 'function') {
		const custom = field.render({document: documentRef, i18n, value, onChange: notify, field});
		if (custom?.element) {
			return {
				...custom,
				setDisabled: custom.setDisabled || (disabled => setInputsDisabled(custom.element, disabled)),
				read: custom.read || (() => null)
			};
		}
		return {
			element: custom,
			read: () => null,
			setDisabled: disabled => setInputsDisabled(custom, disabled)
		};
	}

	if (type === 'array') {
		return createArrayControl(field, value, {...environment, document: documentRef, i18n, onChange: notify});
	}

	switch (type) {
		case 'textarea': {
			const textarea = documentRef.createElement('textarea');
			textarea.rows = field.rows || 3;
			textarea.value = value === MIXED_VALUE || value == null ? '' : String(value);
			if (field.placeholder) textarea.placeholder = field.placeholder;
			element = textarea;
			read = () => textarea.value;
			focus = () => textarea.focus();
			break;
		}
		case 'number':
		case 'integer': {
			const input = makeInput(documentRef, 'number', value, field);
			if (type === 'integer' && field.step === undefined) input.step = '1';
			element = input;
			read = () => input.value === '' ? null : Number(input.value);
			focus = () => input.focus();
			break;
		}
		case 'expression':
		case 'text': {
			const input = makeInput(documentRef, 'text', value, field);
			if (value === MIXED_VALUE) input.placeholder = i18n.t('panel.mixed');
			element = input;
			read = () => input.value;
			focus = () => input.focus();
			break;
		}
		case 'color': {
			const input = makeInput(documentRef, 'color', value || field.default || '#808080', field);
			element = input;
			read = () => input.value;
			focus = () => input.focus();
			break;
		}
		case 'file': {
			const input = makeInput(documentRef, 'file', null, field);
			if (field.multiple) input.multiple = true;
			element = input;
			read = () => input.multiple ? [...input.files] : input.files[0] || null;
			focus = () => input.focus();
			break;
		}
		case 'select': {
			const select = documentRef.createElement('select');
			for (const optionData of field.options || []) {
				const option = documentRef.createElement('option');
				option.value = String(optionValue(optionData));
				option.textContent = optionLabel(i18n, optionData);
				option.disabled = Boolean(optionData?.disabled);
				select.appendChild(option);
			}
			if (value !== MIXED_VALUE && value != null) select.value = String(value);
			element = select;
			read = () => field.numeric ? Number(select.value) : select.value;
			focus = () => select.focus();
			break;
		}
		case 'slider': {
			const group = documentRef.createElement('div');
			group.className = 'slider-field';
			const input = documentRef.createElement('input');
			input.type = 'range';
			if (field.min != null) input.min = String(field.min);
			if (field.max != null) input.max = String(field.max);
			if (field.step != null) input.step = String(field.step);
			input.value = value == null || value === MIXED_VALUE ? String(field.default ?? field.min ?? 0) : String(value);
			const output = documentRef.createElement('output');
			output.htmlFor = input.id = nextControlId('slider');
			const update = () => {
				const number = Number(input.value);
				output.value = Number.isFinite(number) ? (field.formatValue ? field.formatValue(number) : String(number)) : '';
				output.textContent = output.value;
			};
			input.addEventListener('input', () => { update(); notify({ target: input, type: 'input' }); });
			input.addEventListener('change', () => notify({ target: input, type: 'change' }));
			update();
			group.append(input, output);
			element = group;
			read = () => Number(input.value);
			focus = () => input.focus();
			break;
		}
		case 'checkbox': {
			const line = documentRef.createElement('label');
			line.className = 'checkbox-line';
			const input = makeInput(documentRef, 'checkbox', value, field);
			input.indeterminate = value === MIXED_VALUE;
			const text = documentRef.createElement('span');
			text.textContent = field.choiceLabelKey ? i18n.t(field.choiceLabelKey) : String(field.choiceLabel || '');
			line.append(input, text);
			element = line;
			read = () => input.checked;
			focus = () => input.focus();
			break;
		}
		case 'radio': {
			const grid = documentRef.createElement('div');
			grid.className = 'choice-grid';
			const name = nextControlId('field-radio');
			const inputs = [];
			for (const optionData of field.options || []) {
				const line = documentRef.createElement('label');
				line.className = 'radio-line';
				const input = makeInput(documentRef, 'radio', null, field);
				input.name = name;
				input.value = String(optionValue(optionData));
				input.checked = value != null && String(value) === input.value;
				input.disabled = Boolean(optionData?.disabled);
				line.append(input, optionLabel(i18n, optionData));
				grid.appendChild(line);
				inputs.push(input);
			}
			element = grid;
			read = () => {
				const selected = inputs.find(input => input.checked);
				if (!selected) return null;
				return field.numeric ? Number(selected.value) : selected.value;
			};
			focus = () => (inputs.find(input => input.checked) || inputs[0])?.focus();
			break;
		}
		case 'rational': {
			const tuple = Array.isArray(value) ? value : [0, 0, 1];
			const group = documentRef.createElement('div');
			group.className = 'rational-input';
			const integer = makeInput(documentRef, 'number', tuple[0] ?? 0, {step: 1});
			const numerator = makeInput(documentRef, 'number', tuple[1] ?? 0, {step: 1});
			const denominator = makeInput(documentRef, 'number', tuple[2] ?? 1, {step: 1, min: 1});
			group.append(integer, '+', numerator, '/', denominator);
			element = group;
			const writeCanonical = () => {
				const raw = [Number(integer.value), Number(numerator.value), Number(denominator.value)];
				if (!raw.every(Number.isSafeInteger) || raw[2] <= 0) return raw;
				const canonical = canonicalizeRationalTuple(raw);
				integer.value = String(canonical[0]);
				numerator.value = String(canonical[1]);
				denominator.value = String(canonical[2]);
				return canonical;
			};
			group.addEventListener('focusout', event => {
				if (!group.contains(event.relatedTarget)) writeCanonical();
			});
			read = () => {
				const raw = [Number(integer.value), Number(numerator.value), Number(denominator.value)];
				if (!raw.every(Number.isSafeInteger) || raw[2] <= 0) return raw;
				return canonicalizeRationalTuple(raw);
			};
			focus = () => integer.focus();
			break;
		}
		case 'pair': {
			const pair = Array.isArray(value) ? value : ['', ''];
			const group = documentRef.createElement('div');
			group.className = 'pair-input';
			const inputType = field.numeric ? 'number' : 'text';
			const first = makeInput(documentRef, inputType, pair[0] ?? '', field);
			const second = makeInput(documentRef, inputType, pair[1] ?? '', field);
			group.append(first, second);
			element = group;
			read = () => field.numeric
				? [first.value === '' ? null : Number(first.value), second.value === '' ? null : Number(second.value)]
				: [first.value, second.value];
			focus = () => first.focus();
			break;
		}
		case 'angle': {
			const angle = typeof value === 'object' && value !== null ? value : {value: value ?? '', radians: false};
			const group = documentRef.createElement('div');
			const input = makeInput(documentRef, 'text', angle.value ?? angle.expression ?? '', field);
			const line = documentRef.createElement('label');
			line.className = 'checkbox-line';
			const radians = makeInput(documentRef, 'checkbox', angle.radians, field);
			line.append(radians, i18n.t('field.radians'));
			group.append(input, line);
			element = group;
			read = () => ({value: input.value, radians: radians.checked});
			focus = () => input.focus();
			break;
		}
		case 'range': {
			const range = Array.isArray(value)
				? {min: value[0], max: value[1], exclusive: field.exclusive ?? true}
				: value || {min: 0, max: 1, exclusive: field.exclusive ?? true};
			const group = documentRef.createElement('div');
			const pair = documentRef.createElement('div');
			pair.className = 'pair-input';
			const min = makeInput(documentRef, 'number', range.min, {step: 1});
			const max = makeInput(documentRef, 'number', range.max, {step: 1});
			pair.append(min, max);
			const line = documentRef.createElement('label');
			line.className = 'checkbox-line';
			const exclusive = makeInput(documentRef, 'checkbox', range.exclusive, field);
			line.append(exclusive, i18n.t('field.exclusiveUpper'));
			group.append(pair, line);
			element = group;
			read = () => ({min: Number(min.value), max: Number(max.value), exclusive: exclusive.checked});
			focus = () => min.focus();
			break;
		}
		case 'matrix': {
			const matrix = Array.isArray(value) ? value : [1, 0, 0, 1, 0, 0];
			const group = documentRef.createElement('div');
			group.className = 'matrix-input';
			const inputs = matrix.slice(0, 6).map(itemValue => makeInput(documentRef, field.numeric ? 'number' : 'text', itemValue, field));
			while (inputs.length < 6) inputs.push(makeInput(documentRef, field.numeric ? 'number' : 'text', 0, field));
			for (const index of AFFINE_MATRIX_GRID) group.append(inputs[index]);
			element = group;
			read = () => inputs.map(input => field.numeric ? Number(input.value) : input.value);
			focus = () => inputs[0].focus();
			break;
		}
		default:
			throw new Error(`Unknown field type: ${type}`);
	}

	if (type === 'rational') {
		const listener = event => {
			if (!element.contains(event.relatedTarget)) notify(event);
		};
		element.addEventListener('focusout', listener);
		cleanups.push(() => element.removeEventListener('focusout', listener));
	} else {
		cleanups.push(attachControlEvents(element, notify));
	}
	return {
		element,
		read,
		focus,
		setDisabled: disabled => setInputsDisabled(element, disabled),
		destroy: () => cleanups.forEach(cleanup => cleanup())
	};
}

function validationText(result, i18n) {
	if (!result) {
		return '';
	}
	if (typeof result === 'object') {
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
	if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isSafeInteger) || value[2] <= 0) return value;
	try { return Rational.from(value).toJSON(); } catch { return value; }
}

function rationalTupleIsCanonical(value) {
	if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isSafeInteger)) return false;
	try {
		const canonical = Rational.from(value).toJSON();
		return canonical.every((item, index) => item === value[index]);
	} catch {
		return false;
	}
}

export function validateField(field, value, values, i18n = defaultI18n) {
	if (field.required) {
		const empty = value == null || value === '' || Array.isArray(value) && value.length === 0;
		if (empty) return i18n.t('validation.required');
	}
	if (value == null || value === '') {
		return '';
	}
	switch (field.type) {
		case 'number':
			if (!Number.isFinite(value)) return i18n.t('validation.number');
			if (field.min != null && value < Number(field.min)) return i18n.t(field.min >= 0 ? 'validation.nonnegative' : 'validation.number');
			if (field.max != null && value > Number(field.max)) return i18n.t('validation.number');
			break;
		case 'integer':
			if (!Number.isInteger(value)) return i18n.t('validation.integer');
			if (field.min != null && value < Number(field.min)) return i18n.t(field.min > 0 ? 'validation.positive' : 'validation.nonnegative');
			break;
		case 'rational':
			if (!value.every(Number.isInteger)) return i18n.t('validation.integer');
			if (value[2] <= 0) return i18n.t('validation.denominator');
			if (field.positive && Rational.from(value).compare(0) <= 0) return i18n.t('validation.positive');
			if (field.nonnegative && Rational.from(value).compare(0) < 0) return i18n.t('validation.nonnegative');
			break;
		case 'pair':
			if (field.numeric && value.some(item => !Number.isFinite(item))) return i18n.t('validation.number');
			if (field.integer && value.some(item => !Number.isInteger(item))) return i18n.t('validation.integer');
			if (field.expression && value.some(item => !isFiniteExpression(item))) return i18n.t('validation.number');
			if (field.required && value.some(item => item == null || item === '')) return i18n.t('validation.required');
			break;
		case 'expression':
			if (!isFiniteExpression(value)) return i18n.t('validation.number');
			break;
		case 'angle':
			if (field.required && !value.value.trim()) return i18n.t('validation.required');
			if (value.value !== '' && !isFiniteExpression(value.value)) return i18n.t('validation.number');
			break;
		case 'range':
			if (!Number.isInteger(value.min) || !Number.isInteger(value.max)) return i18n.t('validation.integer');
			if (value.min > value.max) return i18n.t('validation.range');
			break;
		case 'matrix':
			if (field.numeric && value.some(item => !Number.isFinite(item))) return i18n.t('validation.number');
			if (field.required && value.some(item => item === '')) return i18n.t('validation.required');
			break;
		case 'array':
			if (field.minItems && value.length < field.minItems) {
				return i18n.t('validation.minItems', {count: field.minItems});
			}
			for (const item of value) {
				if (Array.isArray(field.fields)) {
					for (const subfield of field.fields) {
						const error = validateField(subfield, item?.[subfield.id], item || {}, i18n);
						if (error) return error;
					}
				} else {
					const itemField = {type: field.itemType || 'text', ...(field.item || {})};
					const error = validateField(itemField, item, item, i18n);
					if (error) return error;
				}
			}
			break;
	}
	if (typeof field.validate === 'function') {
		return validationText(field.validate(value, values, field), i18n);
	}
	return '';
}
