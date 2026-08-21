import {i18n as defaultI18n} from './i18n.js';
import {clearElement, nextControlId, resolveElement, translated} from './ui-shared.js';
import {createFieldControl, initialValue, validateField} from './ui-fields.js';

function buttonLabel(i18n, button) {
	return button.labelKey ? i18n.t(button.labelKey) : String(button.label || button.id || '');
}

export class DialogManager {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.onStateChange = options.onStateChange || null;
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
		dialog.className = ['dialog', options.dialogClass].filter(Boolean).join(' ');
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		dialog.noValidate = true;

		const titlebar = this.document.createElement('div');
		titlebar.className = 'dialog-titlebar';
		const titleId = nextControlId('dialog-title');
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
				focusTarget.id ||= nextControlId('dialog-field');
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
			this.onStateChange?.(true);
			this.installDialogListeners();
			this.refreshDialogState();
			queueMicrotask(() => {
				const first = entries.find(entry => entry.field.id === options.focusField && !entry.disabled)?.control
					|| entries.find(entry => !entry.disabled)?.control;
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
		this.onStateChange?.(false);
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
