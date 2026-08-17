import {i18n as defaultI18n} from './i18n.js';
import {
	COMMAND_DEFINITIONS,
	MENU_DEFINITION,
	TOOLBAR_ITEMS
} from './commands.js';

let controlSequence = 0;

function resolveElement(element, fallbackId, documentRef = globalThis.document) {
	if (typeof element === 'string') {
		return documentRef?.querySelector(element) || null;
	}
	return element || (fallbackId ? documentRef?.getElementById(fallbackId) : null);
}

function clearElement(element) {
	while (element?.firstChild) {
		element.firstChild.remove();
	}
}

function translated(i18n, keyOrText, params, raw = false) {
	if (typeof keyOrText === 'function') {
		return String(keyOrText(i18n, params) ?? '');
	}
	if (keyOrText == null) {
		return '';
	}
	return raw ? String(keyOrText) : i18n.t(String(keyOrText), params);
}

function appendMnemonic(documentRef, element, label, mnemonic) {
	clearElement(element);
	const lowerLabel = label.toLocaleLowerCase();
	const lowerMnemonic = mnemonic.toLocaleLowerCase();
	const index = lowerLabel.indexOf(lowerMnemonic);
	if (index >= 0) {
		element.append(label.slice(0, index));
		const underline = documentRef.createElement('u');
		underline.textContent = label.slice(index, index + mnemonic.length);
		element.append(underline, label.slice(index + mnemonic.length));
		return;
	}
	element.append(`${label} (`);
	const underline = documentRef.createElement('u');
	underline.textContent = mnemonic.toUpperCase();
	element.append(underline, ')');
}

export class TooltipManager {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.element = resolveElement(options.element, 'tooltip-text', this.document);
		this.defaultKey = options.defaultKey || 'tooltip.ready';
		this.entries = new Map();
		this.activeElement = null;
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.refresh());
	}

	register(element, tooltip, options = {}) {
		if (!element) {
			return () => {};
		}
		this.unregister(element);
		const entry = {
			tooltip,
			title: options.title ?? tooltip,
			params: options.params || {},
			raw: Boolean(options.raw),
			titleRaw: Boolean(options.titleRaw ?? options.raw)
		};
		entry.enter = () => {
			this.activeElement = element;
			this.show(entry.tooltip, entry.params, entry.raw);
		};
		entry.leave = event => {
			if (event.type === 'focusout' && element.contains(event.relatedTarget)) {
				return;
			}
			if (this.activeElement === element) {
				this.activeElement = null;
				this.reset();
			}
		};
		element.addEventListener('pointerenter', entry.enter);
		element.addEventListener('pointerleave', entry.leave);
		element.addEventListener('focusin', entry.enter);
		element.addEventListener('focusout', entry.leave);
		this.entries.set(element, entry);
		this.updateTitle(element, entry);
		return () => this.unregister(element);
	}

	bind(root = this.document) {
		const elements = [];
		if (root?.matches?.('[data-tooltip-key]')) {
			elements.push(root);
		}
		elements.push(...(root?.querySelectorAll?.('[data-tooltip-key]') || []));
		for (const element of elements) {
			this.register(element, element.dataset.tooltipKey);
		}
	}

	unregister(element) {
		const entry = this.entries.get(element);
		if (!entry) {
			return;
		}
		element.removeEventListener('pointerenter', entry.enter);
		element.removeEventListener('pointerleave', entry.leave);
		element.removeEventListener('focusin', entry.enter);
		element.removeEventListener('focusout', entry.leave);
		this.entries.delete(element);
		if (this.activeElement === element) {
			this.activeElement = null;
			this.reset();
		}
	}

	updateTitle(element, entry) {
		element.title = translated(this.i18n, entry.title, entry.params, entry.titleRaw);
	}

	show(keyOrText, params = {}, raw = false) {
		if (this.element) {
			this.element.textContent = translated(this.i18n, keyOrText, params, raw);
		}
	}

	reset() {
		this.show(this.defaultKey);
	}

	refresh() {
		for (const [element, entry] of this.entries) {
			this.updateTitle(element, entry);
		}
		if (this.activeElement && this.entries.has(this.activeElement)) {
			const entry = this.entries.get(this.activeElement);
			this.show(entry.tooltip, entry.params, entry.raw);
		} else {
			this.reset();
		}
	}

	destroy() {
		for (const element of [...this.entries.keys()]) {
			this.unregister(element);
		}
		this.unsubscribeLanguage?.();
	}
}

export class MenuBar {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.element = resolveElement(options.element, 'menu-bar', this.document);
		this.registry = options.registry;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.definition = options.definition || MENU_DEFINITION;
		this.contextProvider = options.contextProvider || (() => undefined);
		this.roots = [];
		this.commandButtons = new Map();
		this.openIndex = -1;
		this.suppressNextClick = false;
		if (!this.element || !this.registry) {
			throw new Error('MenuBar requires an element and a CommandRegistry');
		}
		this.render();
		this.onDocumentKeyDown = event => this.handleKeyDown(event);
		this.onDocumentPointerDown = event => this.handleOutsidePointerDown(event);
		this.onDocumentClick = event => this.handleSuppressedClick(event);
		this.document.addEventListener('keydown', this.onDocumentKeyDown, true);
		this.document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
		this.document.addEventListener('click', this.onDocumentClick, true);
		this.unsubscribeRegistry = this.registry.subscribe(change => this.updateState(change.id));
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.updateLabels());
	}

	render() {
		for (const buttons of this.commandButtons.values()) {
			for (const button of buttons) {
				this.tooltip?.unregister(button);
			}
		}
		clearElement(this.element);
		this.element.setAttribute('role', 'menubar');
		this.roots = [];
		this.commandButtons.clear();
		this.definition.forEach((menu, index) => {
			const root = this.document.createElement('div');
			root.className = 'menu-root';
			root.dataset.menuId = menu.id;

			const rootButton = this.document.createElement('button');
			rootButton.type = 'button';
			rootButton.className = 'menu-root-button';
			rootButton.setAttribute('role', 'menuitem');
			rootButton.setAttribute('aria-haspopup', 'true');
			rootButton.setAttribute('aria-expanded', 'false');
			rootButton.addEventListener('click', event => {
				event.stopPropagation();
				this.openIndex === index ? this.close() : this.open(index);
			});
			rootButton.addEventListener('pointerenter', () => {
				if (this.openIndex >= 0 && this.openIndex !== index) {
					this.open(index);
				}
			});
			rootButton.addEventListener('keydown', event => {
				if (this.openIndex >= 0) {
					return;
				}
				if (['ArrowDown', 'Enter', ' '].includes(event.key)) {
					event.preventDefault();
					this.open(index, {focusFirst: true});
				} else if (event.key === 'ArrowUp') {
					event.preventDefault();
					this.open(index, {focusLast: true});
				}
			});
			root.appendChild(rootButton);

			const popup = this.document.createElement('div');
			popup.className = 'menu-popup';
			popup.setAttribute('role', 'menu');
			for (const entry of menu.items) {
				if (entry.type === 'separator') {
					const line = this.document.createElement('div');
					line.className = 'menu-separator';
					line.setAttribute('role', 'separator');
					popup.appendChild(line);
					continue;
				}
				popup.appendChild(this.createCommandButton(entry.command));
			}
			root.appendChild(popup);
			this.element.appendChild(root);
			this.roots.push({definition: menu, root, rootButton, popup});
		});
		this.updateLabels();
		this.updateState(null);
	}

	createCommandButton(id) {
		const definition = COMMAND_DEFINITIONS[id] || this.registry.get(id).definition;
		const button = this.document.createElement('button');
		button.type = 'button';
		button.className = 'menu-command';
		button.dataset.command = id;
		button.setAttribute('role', definition.checkable ? 'menuitemcheckbox' : 'menuitem');

		const iconBox = this.document.createElement('span');
		iconBox.className = 'menu-command-icon';
		if (definition.icon) {
			const image = this.document.createElement('img');
			image.src = definition.icon;
			image.alt = '';
			image.draggable = false;
			iconBox.appendChild(image);
		}
		button.appendChild(iconBox);

		const label = this.document.createElement('span');
		label.className = 'menu-command-label';
		button.appendChild(label);
		const shortcut = this.document.createElement('span');
		shortcut.className = 'menu-shortcut';
		button.appendChild(shortcut);
		button.addEventListener('click', event => {
			if (button.disabled) {
				return;
			}
			this.close();
			void this.registry.execute(id, this.contextProvider(), event);
		});
		if (!this.commandButtons.has(id)) {
			this.commandButtons.set(id, new Set());
		}
		this.commandButtons.get(id).add(button);
		return button;
	}

	updateLabels() {
		for (const {definition, rootButton} of this.roots) {
			appendMnemonic(
				this.document,
				rootButton,
				this.i18n.t(definition.labelKey),
				definition.mnemonic
			);
		}
		for (const [id, buttons] of this.commandButtons) {
			const definition = this.registry.get(id).definition;
			for (const button of buttons) {
				button.querySelector('.menu-command-label').textContent = this.i18n.t(definition.labelKey);
				button.querySelector('.menu-shortcut').textContent = this.i18n.shortcut(definition.shortcut);
				this.tooltip?.register(button, definition.hintKey);
			}
		}
	}

	updateState(id) {
		const ids = id ? [id] : [...this.commandButtons.keys()];
		const context = this.contextProvider();
		for (const commandId of ids) {
			const buttons = this.commandButtons.get(commandId);
			if (!buttons) {
				continue;
			}
			const state = this.registry.state(commandId, context);
			for (const button of buttons) {
				button.disabled = !state.enabled;
				button.setAttribute('aria-disabled', String(!state.enabled));
				if (state.definition.checkable) {
					button.setAttribute('aria-checked', String(state.checked));
					button.classList.toggle('is-active', state.checked);
				}
			}
		}
	}

	open(index, options = {}) {
		if (index < 0 || index >= this.roots.length) {
			return;
		}
		if (this.openIndex >= 0 && this.openIndex !== index) {
			this.setRootOpen(this.openIndex, false);
		}
		this.openIndex = index;
		this.updateState(null);
		this.setRootOpen(index, true);
		if (options.focusFirst || options.focusLast) {
			const items = this.focusableItems();
			items[options.focusLast ? items.length - 1 : 0]?.focus();
		}
	}

	setRootOpen(index, open) {
		const root = this.roots[index];
		if (!root) {
			return;
		}
		root.root.classList.toggle('is-open', open);
		root.rootButton.setAttribute('aria-expanded', String(open));
		root.popup.classList.remove('is-aligned-right');
		if (open && root.popup.getBoundingClientRect().right > this.document.documentElement.clientWidth) {
			root.popup.classList.add('is-aligned-right');
		}
	}

	close(options = {}) {
		if (this.openIndex < 0) {
			return;
		}
		const oldIndex = this.openIndex;
		this.setRootOpen(oldIndex, false);
		this.openIndex = -1;
		if (options.focusRoot) {
			this.roots[oldIndex].rootButton.focus();
		}
	}

	focusableItems() {
		if (this.openIndex < 0) {
			return [];
		}
		return [...this.roots[this.openIndex].popup.querySelectorAll('.menu-command:not(:disabled)')];
	}

	moveFocus(delta) {
		const items = this.focusableItems();
		if (!items.length) {
			this.roots[this.openIndex]?.rootButton.focus();
			return;
		}
		let index = items.indexOf(this.document.activeElement);
		if (index < 0) {
			index = delta > 0 ? -1 : 0;
		}
		items[(index + delta + items.length) % items.length].focus();
	}

	switchRoot(delta) {
		if (this.openIndex < 0) {
			return;
		}
		const index = (this.openIndex + delta + this.roots.length) % this.roots.length;
		this.open(index, {focusFirst: true});
	}

	handleKeyDown(event) {
		if (this.document.querySelector('.modal-layer:not([hidden])')) {
			return;
		}
		if (event.altKey && !event.ctrlKey && !event.metaKey) {
			const index = this.definition.findIndex(menu => menu.mnemonic.toLowerCase() === event.key.toLowerCase());
			if (index >= 0) {
				event.preventDefault();
				event.stopImmediatePropagation();
				this.open(index, {focusFirst: true});
				return;
			}
		}
		if (this.openIndex < 0) {
			return;
		}
		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				event.stopImmediatePropagation();
				this.close({focusRoot: true});
				break;
			case 'ArrowLeft':
				event.preventDefault();
				event.stopImmediatePropagation();
				this.switchRoot(-1);
				break;
			case 'ArrowRight':
				event.preventDefault();
				event.stopImmediatePropagation();
				this.switchRoot(1);
				break;
			case 'ArrowDown':
			case 'Tab':
				event.preventDefault();
				event.stopImmediatePropagation();
				this.moveFocus(event.shiftKey ? -1 : 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				event.stopImmediatePropagation();
				this.moveFocus(-1);
				break;
			case 'Home': {
				event.preventDefault();
				const items = this.focusableItems();
				items[0]?.focus();
				break;
			}
			case 'End': {
				event.preventDefault();
				const items = this.focusableItems();
				items[items.length - 1]?.focus();
				break;
			}
			case 'Enter':
			case ' ': {
				const active = this.document.activeElement;
				if (active?.classList.contains('menu-command')) {
					event.preventDefault();
					event.stopImmediatePropagation();
					active.click();
				}
				break;
			}
		}
	}

	handleOutsidePointerDown(event) {
		if (this.openIndex < 0 || this.element.contains(event.target)) {
			return;
		}
		this.close();
		this.suppressNextClick = true;
		event.preventDefault();
		event.stopImmediatePropagation();
		clearTimeout(this.suppressTimer);
		this.suppressTimer = setTimeout(() => {
			this.suppressNextClick = false;
		}, 1000);
	}

	handleSuppressedClick(event) {
		if (!this.suppressNextClick) {
			return;
		}
		this.suppressNextClick = false;
		clearTimeout(this.suppressTimer);
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	destroy() {
		this.close();
		this.document.removeEventListener('keydown', this.onDocumentKeyDown, true);
		this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
		this.document.removeEventListener('click', this.onDocumentClick, true);
		this.unsubscribeRegistry?.();
		this.unsubscribeLanguage?.();
		clearTimeout(this.suppressTimer);
	}
}

export class Toolbar {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.element = resolveElement(options.element, 'tool-bar', this.document);
		this.registry = options.registry;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.items = options.items || TOOLBAR_ITEMS;
		this.contextProvider = options.contextProvider || (() => undefined);
		this.buttons = new Map();
		if (!this.element || !this.registry) {
			throw new Error('Toolbar requires an element and a CommandRegistry');
		}
		this.render();
		this.unsubscribeRegistry = this.registry.subscribe(change => this.updateState(change.id));
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.updateLabels());
	}

	render() {
		for (const button of this.buttons.values()) {
			this.tooltip?.unregister(button);
		}
		clearElement(this.element);
		this.buttons.clear();
		for (const id of this.items) {
			if (id === 'separator') {
				const separator = this.document.createElement('div');
				separator.className = 'tool-separator';
				separator.setAttribute('role', 'separator');
				this.element.appendChild(separator);
				continue;
			}
			const definition = this.registry.get(id).definition;
			const button = this.document.createElement('button');
			button.type = 'button';
			button.className = 'tool-button';
			button.dataset.command = id;
			if (definition.checkable) {
				button.setAttribute('aria-pressed', 'false');
			}
			if (definition.icon) {
				const image = this.document.createElement('img');
				image.src = definition.icon;
				image.alt = '';
				image.draggable = false;
				button.appendChild(image);
			}
			button.addEventListener('click', event => {
				if (!button.disabled) {
					void this.registry.execute(id, this.contextProvider(), event);
				}
			});
			this.buttons.set(id, button);
			this.element.appendChild(button);
		}
		this.updateLabels();
		this.updateState(null);
	}

	updateLabels() {
		for (const [id, button] of this.buttons) {
			const definition = this.registry.get(id).definition;
			const label = this.i18n.t(definition.labelKey);
			const shortcut = this.i18n.shortcut(definition.shortcut);
			const title = shortcut ? `${label} (${shortcut})` : label;
			button.setAttribute('aria-label', label);
			this.tooltip?.register(button, definition.hintKey, {title, titleRaw: true});
			if (!this.tooltip) {
				button.title = title;
			}
		}
	}

	updateState(id) {
		const ids = id ? [id] : [...this.buttons.keys()];
		const context = this.contextProvider();
		for (const commandId of ids) {
			const button = this.buttons.get(commandId);
			if (!button) {
				continue;
			}
			const state = this.registry.state(commandId, context);
			button.disabled = !state.enabled;
			button.classList.toggle('is-active', state.checked);
			if (state.definition.checkable) {
				button.setAttribute('aria-pressed', String(state.checked));
			}
		}
	}

	destroy() {
		this.unsubscribeRegistry?.();
		this.unsubscribeLanguage?.();
		for (const button of this.buttons.values()) {
			this.tooltip?.unregister(button);
		}
	}
}

export const MIXED_VALUE = Symbol('mixed-value');

function initialValue(field, suppliedValues = {}) {
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
			const name = `field-radio-${++controlSequence}`;
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
			read = () => [Number(integer.value), Number(numerator.value), Number(denominator.value)];
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
			group.append(...inputs);
			element = group;
			read = () => inputs.map(input => field.numeric ? Number(input.value) : input.value);
			focus = () => inputs[0].focus();
			break;
		}
		default:
			throw new Error(`Unknown field type: ${type}`);
	}

	cleanups.push(attachControlEvents(element, notify));
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
			if (field.positive && value[0] + value[1] / value[2] <= 0) return i18n.t('validation.positive');
			if (field.nonnegative && value[0] + value[1] / value[2] < 0) return i18n.t('validation.nonnegative');
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

function buttonLabel(i18n, button) {
	return button.labelKey ? i18n.t(button.labelKey) : String(button.label || button.id || '');
}

export class DialogManager {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.layer = resolveElement(options.layer, 'modal-layer', this.document);
		this.appElement = resolveElement(options.appElement, 'app', this.document);
		this.active = null;
		if (!this.layer) {
			throw new Error('DialogManager requires a modal layer');
		}
	}

	open(options = {}) {
		if (this.active) {
			this.flash();
			return Promise.reject(new Error('A dialog is already open'));
		}
		const dialog = this.document.createElement('form');
		dialog.className = 'dialog';
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		dialog.noValidate = true;

		const titlebar = this.document.createElement('div');
		titlebar.className = 'dialog-titlebar';
		const titleId = `dialog-title-${++controlSequence}`;
		titlebar.id = titleId;
		titlebar.textContent = translated(this.i18n, options.titleKey || options.title || 'dialog.alert', options.params, Boolean(options.title && !options.titleKey));
		dialog.setAttribute('aria-labelledby', titleId);
		dialog.appendChild(titlebar);

		const body = this.document.createElement('div');
		body.className = 'dialog-body';
		if (options.messageKey || options.message) {
			const message = this.document.createElement('p');
			message.className = 'dialog-message';
			message.textContent = translated(this.i18n, options.messageKey || options.message, options.params, Boolean(options.message && !options.messageKey));
			body.appendChild(message);
		}
		if (options.content) {
			body.appendChild(typeof options.content === 'function'
				? options.content({document: this.document, i18n: this.i18n})
				: options.content);
		}
		dialog.appendChild(body);

		const values = {...(options.values || {})};
		const entries = [];
		const onFieldChange = event => {
			this.refreshDialogState();
			if (this.active && typeof options.onChange === 'function') {
				options.onChange(this.readValues(), {
					event,
					entries: this.active.entries,
					refresh: () => this.refreshDialogState()
				});
			}
		};
		for (const field of options.fields || []) {
			const wrapper = this.document.createElement('div');
			wrapper.className = `dialog-field${field.stacked ? ' is-stacked' : ''}`;
			const label = this.document.createElement('label');
			label.className = 'field-label';
			label.textContent = field.labelKey ? this.i18n.t(field.labelKey) : String(field.label || field.id);
			const control = createFieldControl(field, initialValue(field, values), {
				document: this.document,
				i18n: this.i18n,
				tooltip: this.tooltip,
				onChange: onFieldChange
			});
			const focusTarget = control.element.matches?.('input, select, textarea')
				? control.element
				: control.element.querySelector?.('input, select, textarea');
			if (focusTarget) {
				focusTarget.id ||= `dialog-field-${++controlSequence}`;
				label.htmlFor = focusTarget.id;
			}
			wrapper.append(label, control.element);
			if (field.helpKey || field.help) {
				const help = this.document.createElement('div');
				help.className = 'field-help';
				help.textContent = translated(this.i18n, field.helpKey || field.help, {}, Boolean(field.help && !field.helpKey));
				wrapper.appendChild(help);
			}
			const validation = this.document.createElement('div');
			validation.className = 'validation-message';
			validation.setAttribute('aria-live', 'polite');
			wrapper.appendChild(validation);
			body.appendChild(wrapper);
			const tooltipValue = field.tooltipKey || field.labelKey || field.tooltip || field.label || field.id;
			const tooltipRaw = !field.tooltipKey && !field.labelKey;
			if (this.tooltip) this.tooltip.register(label, tooltipValue, {raw: tooltipRaw});
			else label.title = tooltipRaw ? String(tooltipValue) : this.i18n.t(tooltipValue);
			entries.push({field, wrapper, label, control, validation, disabled: false});
		}

		const actions = this.document.createElement('div');
		actions.className = 'dialog-actions';
		const buttonDefinitions = options.buttons || [
			{id: 'ok', labelKey: 'dialog.ok', primary: true, submit: true},
			{id: 'cancel', labelKey: 'dialog.cancel', value: null, cancel: true, validate: false}
		];
		const buttons = [];
		for (const buttonDefinition of buttonDefinitions) {
			const button = this.document.createElement('button');
			button.type = 'button';
			button.className = `dialog-button${buttonDefinition.primary ? ' is-primary' : ''}`;
			button.textContent = buttonLabel(this.i18n, buttonDefinition);
			button.dataset.dialogAction = buttonDefinition.id;
			button.addEventListener('click', () => void this.activateButton(buttonDefinition));
			actions.appendChild(button);
			buttons.push({definition: buttonDefinition, element: button});
		}
		dialog.appendChild(actions);

		this.layer.hidden = false;
		clearElement(this.layer);
		this.layer.appendChild(dialog);
		const previousFocus = this.document.activeElement;
		const previousInert = this.appElement?.inert;
		const previousAriaHidden = this.appElement?.getAttribute('aria-hidden');
		if (this.appElement) {
			this.appElement.inert = true;
			this.appElement.setAttribute('aria-hidden', 'true');
		}

		return new Promise((resolve, reject) => {
			this.active = {
				options,
				dialog,
				titlebar,
				body,
				entries,
				buttons,
				resolve,
				reject,
				previousFocus,
				previousInert,
				previousAriaHidden,
				drag: null
			};
			this.installDialogListeners();
			this.refreshDialogState();
			queueMicrotask(() => {
				const first = entries.find(entry => !entry.disabled)?.control;
				if (first?.focus) first.focus();
				else buttons[0]?.element.focus();
			});
		});
	}

	installDialogListeners() {
		const active = this.active;
		active.onPointerDown = event => {
			if (!active.dialog.contains(event.target)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				this.flash();
			}
		};
		active.onKeyDown = event => {
			if (event.key === 'Escape') {
				const cancel = active.buttons.find(button => button.definition.cancel);
				if (cancel) {
					event.preventDefault();
					event.stopImmediatePropagation();
					void this.activateButton(cancel.definition);
				}
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey && !event.isComposing
				&& !event.target.closest('textarea, button')) {
				const primary = active.buttons.find(button => button.definition.primary);
				if (primary && !primary.element.disabled) {
					event.preventDefault();
					void this.activateButton(primary.definition);
				}
			}
		};
		active.onTitlePointerDown = event => {
			if (event.button !== 0) return;
			event.preventDefault();
			const rect = active.dialog.getBoundingClientRect();
			active.dialog.style.left = `${rect.left}px`;
			active.dialog.style.top = `${rect.top}px`;
			active.dialog.style.margin = '0';
			active.drag = {
				pointerId: event.pointerId,
				offsetX: event.clientX - rect.left,
				offsetY: event.clientY - rect.top
			};
		};
		active.onPointerMove = event => {
			if (!active.drag || active.drag.pointerId !== event.pointerId) return;
			event.preventDefault();
			const rect = active.dialog.getBoundingClientRect();
			const maxLeft = Math.max(0, globalThis.innerWidth - rect.width);
			const maxTop = Math.max(0, globalThis.innerHeight - rect.height);
			const left = Math.max(0, Math.min(maxLeft, event.clientX - active.drag.offsetX));
			const top = Math.max(0, Math.min(maxTop, event.clientY - active.drag.offsetY));
			active.dialog.style.left = `${left}px`;
			active.dialog.style.top = `${top}px`;
		};
		active.onPointerUp = event => {
			if (active.drag?.pointerId === event.pointerId) active.drag = null;
		};
		this.document.addEventListener('pointerdown', active.onPointerDown, true);
		this.document.addEventListener('keydown', active.onKeyDown, true);
		active.titlebar.addEventListener('pointerdown', active.onTitlePointerDown);
		this.document.addEventListener('pointermove', active.onPointerMove);
		this.document.addEventListener('pointerup', active.onPointerUp);
		this.document.addEventListener('pointercancel', active.onPointerUp);
	}

	readValues() {
		if (!this.active) return {};
		return Object.fromEntries(this.active.entries.map(entry => [entry.field.id, entry.control.read()]));
	}

	refreshDialogState() {
		if (!this.active) return false;
		const values = this.readValues();
		let valid = true;
		for (const entry of this.active.entries) {
			const disabled = typeof entry.field.disabled === 'function'
				? Boolean(entry.field.disabled(values))
				: Boolean(entry.field.disabled);
			entry.disabled = disabled;
			entry.wrapper.classList.toggle('is-disabled', disabled);
			entry.control.setDisabled(disabled);
			const error = disabled ? '' : validateField(entry.field, values[entry.field.id], values, this.i18n);
			entry.validation.textContent = error;
			entry.validation.classList.toggle('is-error', Boolean(error));
			valid &&= !error;
		}
		if (typeof this.active.options.validate === 'function') {
			valid &&= !this.active.options.validate(values);
		}
		for (const {definition, element} of this.active.buttons) {
			if (definition.validate !== false && (definition.submit || definition.primary)) {
				element.disabled = !valid;
			}
		}
		return valid;
	}

	async activateButton(button) {
		if (!this.active) return;
		const shouldValidate = button.validate !== false && (button.submit || button.primary);
		if (shouldValidate && !this.refreshDialogState()) return;
		const values = this.readValues();
		const active = this.active;
		try {
			for (const entry of active.buttons) entry.element.disabled = true;
			if (typeof button.onClick === 'function') {
				const proceed = await button.onClick(values, button.id);
				if (proceed === false) {
					for (const entry of active.buttons) entry.element.disabled = false;
					this.refreshDialogState();
					return;
				}
			}
			if (typeof active.options.onSubmit === 'function' && shouldValidate) {
				const proceed = await active.options.onSubmit(values, button.id);
				if (proceed === false) {
					for (const entry of active.buttons) entry.element.disabled = false;
					this.refreshDialogState();
					return;
				}
			}
			const value = typeof button.value === 'function' ? button.value(values) : button.value;
			this.close({button: button.id, value, values});
		} catch (error) {
			for (const entry of active.buttons) entry.element.disabled = false;
			active.reject(error);
			this.teardownDialog();
		}
	}

	close(result = null) {
		if (!this.active) return;
		const resolve = this.active.resolve;
		this.teardownDialog();
		resolve(result);
	}

	teardownDialog() {
		const active = this.active;
		if (!active) return;
		this.document.removeEventListener('pointerdown', active.onPointerDown, true);
		this.document.removeEventListener('keydown', active.onKeyDown, true);
		active.titlebar.removeEventListener('pointerdown', active.onTitlePointerDown);
		this.document.removeEventListener('pointermove', active.onPointerMove);
		this.document.removeEventListener('pointerup', active.onPointerUp);
		this.document.removeEventListener('pointercancel', active.onPointerUp);
		for (const entry of active.entries) {
			entry.control.destroy?.();
			this.tooltip?.unregister(entry.label);
		}
		active.dialog.remove();
		this.layer.hidden = true;
		if (this.appElement) {
			this.appElement.inert = active.previousInert;
			if (active.previousAriaHidden == null) this.appElement.removeAttribute('aria-hidden');
			else this.appElement.setAttribute('aria-hidden', active.previousAriaHidden);
		}
		this.active = null;
		active.previousFocus?.focus?.();
	}

	flash() {
		const dialog = this.active?.dialog;
		if (!dialog) return;
		dialog.classList.remove('is-warning');
		void dialog.offsetWidth;
		dialog.classList.add('is-warning');
		setTimeout(() => dialog.classList.remove('is-warning'), 1000);
	}

	async form(options = {}) {
		const result = await this.open(options);
		if (!result) return null;
		if (!options.buttons) return result.button === 'ok' ? result.values : null;
		const definition = options.buttons.find(button => button.id === result.button);
		return definition && !definition.cancel && (definition.submit || definition.primary)
			? result.values
			: null;
	}

	async confirm(options = {}) {
		const result = await this.open({
			...options,
			buttons: options.buttons || [
				{id: 'confirm', labelKey: options.confirmLabelKey || 'dialog.ok', primary: true, value: true, validate: false},
				{id: 'cancel', labelKey: options.cancelLabelKey || 'dialog.cancel', cancel: true, value: false, validate: false}
			]
		});
		return Boolean(result?.value);
	}

	async alert(options = {}) {
		await this.open({
			...options,
			buttons: [{id: 'close', labelKey: 'dialog.close', primary: true, value: true, validate: false}]
		});
	}
}

export class ToastManager {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.element = resolveElement(options.element, 'toast-region', this.document);
		this.duration = options.duration ?? 3200;
		this.maxVisible = options.maxVisible ?? 5;
		this.toasts = [];
		if (!this.element) throw new Error('ToastManager requires a toast region');
	}

	show(keyOrText, params = {}, options = {}) {
		const toast = this.document.createElement('div');
		toast.className = `toast${options.type === 'error' ? ' is-error' : ''}`;
		toast.setAttribute('role', options.type === 'error' ? 'alert' : 'status');
		toast.textContent = translated(this.i18n, keyOrText, params, Boolean(options.raw));
		this.element.appendChild(toast);
		const entry = {element: toast, timer: null};
		this.toasts.push(entry);
		while (this.toasts.length > this.maxVisible) this.dismiss(this.toasts[0]);
		entry.timer = setTimeout(() => this.dismiss(entry), options.duration ?? this.duration);
		return () => this.dismiss(entry);
	}

	error(keyOrText, params = {}, options = {}) {
		return this.show(keyOrText, params, {...options, type: 'error'});
	}

	dismiss(entry) {
		const index = this.toasts.indexOf(entry);
		if (index >= 0) this.toasts.splice(index, 1);
		clearTimeout(entry?.timer);
		entry?.element.remove();
	}

	clear() {
		for (const entry of [...this.toasts]) this.dismiss(entry);
	}
}

export function wireSideTabs(documentRef = globalThis.document) {
	const inspectorTab = documentRef?.getElementById('inspector-tab');
	const snappeesTab = documentRef?.getElementById('snappees-tab');
	const inspectorPanel = documentRef?.getElementById('inspector-panel');
	const snappeesPanel = documentRef?.getElementById('snappees-panel');
	if (!inspectorTab || !snappeesTab || !inspectorPanel || !snappeesPanel) {
		return () => {};
	}
	if (inspectorTab.dataset.tabsWired === 'true') {
		return () => {};
	}
	inspectorTab.dataset.tabsWired = 'true';
	const activate = target => {
		const inspectorActive = target === 'inspector';
		inspectorTab.classList.toggle('is-active', inspectorActive);
		snappeesTab.classList.toggle('is-active', !inspectorActive);
		inspectorTab.setAttribute('aria-selected', String(inspectorActive));
		snappeesTab.setAttribute('aria-selected', String(!inspectorActive));
		inspectorPanel.hidden = !inspectorActive;
		snappeesPanel.hidden = inspectorActive;
	};
	const inspect = () => activate('inspector');
	const snap = () => activate('snappees');
	inspectorTab.addEventListener('click', inspect);
	snappeesTab.addEventListener('click', snap);
	return () => {
		inspectorTab.removeEventListener('click', inspect);
		snappeesTab.removeEventListener('click', snap);
		delete inspectorTab.dataset.tabsWired;
	};
}

function deepEqual(left, right) {
	if (Object.is(left, right)) return true;
	try {
		return JSON.stringify(left) === JSON.stringify(right);
	} catch {
		return false;
	}
}

export class InspectorPanel {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.element = resolveElement(options.element, 'inspector-panel', this.document);
		this.controls = [];
		if (!this.element) throw new Error('InspectorPanel requires an inspector panel element');
		this.unwireTabs = wireSideTabs(this.document);
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.rerender());
		this.clear();
	}

	clear(messageKey = 'panel.noSelection') {
		this.destroyControls();
		clearElement(this.element);
		const empty = this.document.createElement('div');
		empty.className = 'empty-panel';
		empty.textContent = this.i18n.t(messageKey);
		this.element.appendChild(empty);
		this.lastRender = {empty: messageKey};
	}

	render(groupsOrFields = [], options = {}) {
		this.destroyControls();
		clearElement(this.element);
		const groups = groupsOrFields.length && groupsOrFields[0]?.fields
			? groupsOrFields
			: [{labelKey: options.groupLabelKey || 'panel.properties', fields: groupsOrFields}];
		if (!groups.some(group => group.fields?.length)) {
			this.clear(options.emptyKey || 'panel.noSelection');
			return;
		}
		this.lastRender = {groupsOrFields, options};
		for (const group of groups) {
			const fieldset = this.document.createElement('fieldset');
			fieldset.className = 'property-group';
			if (group.labelKey || group.label) {
				const legend = this.document.createElement('legend');
				legend.textContent = group.labelKey ? this.i18n.t(group.labelKey) : String(group.label);
				fieldset.appendChild(legend);
			}
			for (const field of group.fields || []) {
				const row = this.document.createElement('div');
				row.className = 'property-row';
				const label = this.document.createElement('label');
				label.textContent = field.labelKey ? this.i18n.t(field.labelKey) : String(field.label || field.id);
				const control = createFieldControl(field, field.value ?? null, {
					document: this.document,
					i18n: this.i18n,
					onChange: () => {
						const value = control.read();
						options.onChange?.(field.id, value, field);
					}
				});
				const input = control.element.matches?.('input, select, textarea')
					? control.element
					: control.element.querySelector?.('input, select, textarea');
				if (input) {
					input.id ||= `inspector-field-${++controlSequence}`;
					label.htmlFor = input.id;
				}
				const disabled = typeof field.disabled === 'function' ? field.disabled(options.context) : field.disabled;
				control.setDisabled(Boolean(disabled));
				if (field.tooltipKey || field.tooltip) {
					this.tooltip?.register(label, field.tooltipKey || field.tooltip, {raw: Boolean(field.tooltip && !field.tooltipKey)});
				}
				row.append(label, control.element);
				fieldset.appendChild(row);
				this.controls.push({control, label});
			}
			this.element.appendChild(fieldset);
		}
	}

	setSelection(items, schema, options = {}) {
		if (!items?.length) {
			this.clear();
			return;
		}
		const source = typeof schema === 'function' ? schema(items) : schema;
		const groups = source?.[0]?.fields ? source : [{labelKey: 'panel.commonProperties', fields: source || []}];
		const renderedGroups = groups.map(group => ({
			...group,
			fields: (group.fields || []).map(field => {
				const getter = field.get || (item => item?.[field.id]);
				const first = getter(items[0]);
				const common = items.every(item => deepEqual(getter(item), first));
				return {...field, value: common ? first : MIXED_VALUE};
			})
		}));
		this.render(renderedGroups, {
			...options,
			onChange: (id, value, field) => options.onChange?.({id, value, field, items})
		});
	}

	destroyControls() {
		for (const {control, label} of this.controls) {
			control.destroy?.();
			this.tooltip?.unregister(label);
		}
		this.controls.length = 0;
	}

	rerender() {
		if (!this.lastRender) return;
		if (this.lastRender.empty) {
			this.clear(this.lastRender.empty);
		} else {
			this.render(this.lastRender.groupsOrFields, this.lastRender.options);
		}
	}

	destroy() {
		this.destroyControls();
		this.unsubscribeLanguage?.();
		this.unwireTabs?.();
	}
}

function drawSnappeePreview(canvas, item) {
	const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
	canvas.width = 24 * ratio;
	canvas.height = 24 * ratio;
	canvas.style.width = '24px';
	canvas.style.height = '24px';
	const context = canvas.getContext('2d');
	if (!context) return;
	context.scale(ratio, ratio);
	context.clearRect(0, 0, 24, 24);
	context.strokeStyle = item.color || '#50a226';
	context.fillStyle = item.color || '#50a226';
	context.lineWidth = 1.5;
	context.globalAlpha = item.active === false ? 0.45 : 0.95;
	const type = item.type || '';
	if (type.includes('rectangular') || type.includes('parametricMesh')) {
		for (const coordinate of [5, 12, 19]) {
			context.beginPath(); context.moveTo(coordinate, 3); context.lineTo(coordinate, 21); context.stroke();
			context.beginPath(); context.moveTo(3, coordinate); context.lineTo(21, coordinate); context.stroke();
		}
	} else if (type.includes('radial')) {
		for (const radius of [4, 8]) {
			context.beginPath(); context.arc(12, 12, radius, 0, Math.PI * 2); context.stroke();
		}
		for (let index = 0; index < 6; index++) {
			const angle = index * Math.PI / 3;
			context.beginPath(); context.moveTo(12, 12);
			context.lineTo(12 + Math.cos(angle) * 10, 12 + Math.sin(angle) * 10); context.stroke();
		}
	} else if (type.includes('regularPolygon')) {
		context.beginPath();
		for (let index = 0; index < 6; index++) {
			const angle = index * Math.PI / 3 - Math.PI / 2;
			const x = 12 + Math.cos(angle) * 9;
			const y = 12 + Math.sin(angle) * 9;
			index ? context.lineTo(x, y) : context.moveTo(x, y);
		}
		context.closePath(); context.stroke();
	} else if (type.includes('circular')) {
		context.beginPath(); context.arc(12, 12, 9, Math.PI * 0.25, Math.PI * 1.75); context.stroke();
	} else {
		context.beginPath();
		context.moveTo(2, 17);
		context.bezierCurveTo(7, 2, 15, 22, 22, 7);
		context.stroke();
		for (const point of [[2, 17], [9, 9], [16, 15], [22, 7]]) {
			context.beginPath(); context.arc(point[0], point[1], 1.4, 0, Math.PI * 2); context.fill();
		}
	}
}

function drawActionIcon(canvas, type) {
	const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
	canvas.width = 17 * ratio;
	canvas.height = 17 * ratio;
	canvas.style.width = '17px';
	canvas.style.height = '17px';
	const context = canvas.getContext('2d');
	if (!context) return;
	context.scale(ratio, ratio);
	context.strokeStyle = 'currentColor';
	context.lineWidth = 1.6;
	if (type === 'duplicate') {
		context.strokeRect(2.5, 5.5, 9, 9);
		context.strokeRect(5.5, 2.5, 9, 9);
	} else {
		context.beginPath();
		context.moveTo(4, 4); context.lineTo(13, 13);
		context.moveTo(13, 4); context.lineTo(4, 13);
		context.stroke();
	}
}

export class SnappeesPanel {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.element = resolveElement(options.element, 'snappees-panel', this.document);
		this.callbacks = {
			onSelect: options.onSelect,
			onToggle: options.onToggle,
			onDuplicate: options.onDuplicate,
			onDelete: options.onDelete,
			onEdit: options.onEdit
		};
		this.items = [];
		this.selectedId = null;
		this.registeredElements = [];
		if (!this.element) throw new Error('SnappeesPanel requires a snappees panel element');
		this.unwireTabs = wireSideTabs(this.document);
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.render());
		this.render();
	}

	setCallbacks(callbacks = {}) {
		Object.assign(this.callbacks, callbacks);
	}

	setItems(items = [], options = {}) {
		this.items = items;
		if (Object.hasOwn(options, 'selectedId')) this.selectedId = options.selectedId;
		this.render();
	}

	select(id, notify = true) {
		this.selectedId = id;
		this.render();
		if (notify) this.callbacks.onSelect?.(id, this.items.find(item => item.id === id) || null);
	}

	clearSelection(notify = true) {
		this.select(null, notify);
	}

	createAction(item, tooltipKey, iconType, callback) {
		const button = this.document.createElement('button');
		button.type = 'button';
		button.className = 'snappee-action';
		if (iconType === 'activate' || iconType === 'deactivate') {
			const image = this.document.createElement('img');
			image.src = `../maker/svg/icons/${iconType}-snappee.svg`;
			image.alt = '';
			image.draggable = false;
			button.appendChild(image);
		} else {
			const canvas = this.document.createElement('canvas');
			drawActionIcon(canvas, iconType);
			button.appendChild(canvas);
		}
		button.setAttribute('aria-label', this.i18n.t(tooltipKey));
		this.tooltip?.register(button, tooltipKey);
		this.registeredElements.push(button);
		button.addEventListener('click', event => {
			event.stopPropagation();
			callback?.(item);
		});
		return button;
	}

	render() {
		for (const element of this.registeredElements) this.tooltip?.unregister(element);
		this.registeredElements.length = 0;
		clearElement(this.element);
		if (!this.items.length) {
			const empty = this.document.createElement('div');
			empty.className = 'empty-panel';
			empty.textContent = this.i18n.t('panel.noSnappees');
			this.element.appendChild(empty);
			return;
		}
		for (const item of this.items) {
			const row = this.document.createElement('div');
			row.className = 'snappee-item';
			row.classList.toggle('is-selected', item.id === this.selectedId);
			row.tabIndex = 0;
			row.setAttribute('role', 'button');
			row.setAttribute('aria-pressed', String(item.id === this.selectedId));
			row.title = this.i18n.t('panel.snappee.edit');
			const preview = this.document.createElement('div');
			preview.className = 'snappee-preview';
			if (typeof item.renderPreview === 'function') {
				item.renderPreview(preview, item);
			} else {
				const canvas = this.document.createElement('canvas');
				drawSnappeePreview(canvas, item);
				preview.appendChild(canvas);
			}
			const name = this.document.createElement('span');
			name.className = 'snappee-name';
			name.textContent = item.name || `${this.i18n.t(`snappee.${item.type}`)} ${item.id}`;
			row.append(preview, name);
			row.append(
				this.createAction(
					item,
					item.active === false ? 'panel.snappee.activate' : 'panel.snappee.deactivate',
					item.active === false ? 'activate' : 'deactivate',
					selected => this.callbacks.onToggle?.(selected, selected.active === false)
				),
				this.createAction(item, 'panel.snappee.duplicate', 'duplicate', selected => this.callbacks.onDuplicate?.(selected)),
				this.createAction(item, 'panel.snappee.delete', 'delete', selected => this.callbacks.onDelete?.(selected))
			);
			row.addEventListener('click', () => {
				if (item.active !== false) this.select(item.id);
			});
			row.addEventListener('dblclick', event => {
				event.preventDefault();
				this.callbacks.onEdit?.(item);
			});
			row.addEventListener('keydown', event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					item.active === false ? this.callbacks.onToggle?.(item, true) : this.select(item.id);
				} else if (event.key === 'Escape' && this.selectedId != null) {
					event.preventDefault();
					this.clearSelection();
				}
			});
			this.element.appendChild(row);
		}
	}

	destroy() {
		for (const element of this.registeredElements) this.tooltip?.unregister(element);
		this.unsubscribeLanguage?.();
		this.unwireTabs?.();
	}
}

function formatHistoryTime(value) {
	if (!value) return '';
	if (typeof value === 'string') return value;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
}

export class HistoryPanel {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.element = resolveElement(options.element, 'history-list', this.document);
		this.capacity = options.capacity ?? 1000;
		this.onSeek = options.onSeek || null;
		this.items = [];
		this.pointer = -1;
		this.registeredElements = [];
		if (!this.element) throw new Error('HistoryPanel requires a history list element');
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.render());
	}

	set(items = [], pointer = items.length - 1) {
		const overflow = Math.max(0, items.length - this.capacity);
		this.items = items.slice(overflow);
		this.pointer = Math.max(-1, Math.min(this.items.length - 1, pointer - overflow));
		this.render();
	}

	append(item, options = {}) {
		if (this.pointer < this.items.length - 1) {
			this.items.splice(this.pointer + 1);
		}
		this.items.push({...item, time: item.time || Date.now()});
		if (this.items.length > this.capacity) this.items.shift();
		this.pointer = options.current === false ? this.pointer : this.items.length - 1;
		this.render({scrollCurrent: true});
	}

	setPointer(pointer, options = {}) {
		this.pointer = Math.max(-1, Math.min(this.items.length - 1, pointer));
		this.render({scrollCurrent: options.scrollCurrent !== false});
	}

	seek(pointer) {
		if (pointer < 0 || pointer >= this.items.length || pointer === this.pointer) return;
		const item = this.items[pointer];
		const accepted = this.onSeek?.(pointer, item);
		if (accepted !== false) this.setPointer(pointer);
	}

	labelFor(item) {
		if (item.labelKey) return this.i18n.t(item.labelKey, item.params || {});
		return String(item.label || item.name || '');
	}

	render(options = {}) {
		for (const element of this.registeredElements) this.tooltip?.unregister(element);
		this.registeredElements.length = 0;
		clearElement(this.element);
		let currentElement = null;
		this.items.forEach((item, index) => {
			const button = this.document.createElement('button');
			button.type = 'button';
			button.className = 'history-item';
			button.classList.toggle('is-current', index === this.pointer);
			button.classList.toggle('is-future', index > this.pointer);
			button.setAttribute('aria-current', index === this.pointer ? 'step' : 'false');
			const indexElement = this.document.createElement('span');
			indexElement.className = 'history-index';
			indexElement.textContent = String(index + 1);
			const name = this.document.createElement('span');
			name.textContent = this.labelFor(item);
			const time = this.document.createElement('span');
			time.className = 'history-time';
			time.textContent = formatHistoryTime(item.time);
			button.append(indexElement, name, time);
			button.addEventListener('click', () => this.seek(index));
			this.tooltip?.register(button, 'panel.history.seek');
			this.registeredElements.push(button);
			this.element.appendChild(button);
			if (index === this.pointer) currentElement = button;
		});
		if (options.scrollCurrent) currentElement?.scrollIntoView({block: 'nearest'});
	}

	destroy() {
		for (const element of this.registeredElements) this.tooltip?.unregister(element);
		this.unsubscribeLanguage?.();
	}
}
