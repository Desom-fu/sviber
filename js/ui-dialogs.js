import { i18n as defaultI18n } from "./i18n.js";
import { clearElement, nextControlId, resolveElement, translated } from "./ui-shared.js";
import { createFieldControl, initialValue, validateField } from "./ui-fields.js";

function buttonLabel(i18n, button) {
	return button.labelKey ? i18n.t(button.labelKey) : String(button.label || button.id || "");
}

const FOCUSABLE_CONTROL_SELECTOR = "input, select, textarea";

// A field control is either the form element itself or a wrapper around one; the label points
// at whichever it is so clicking it focuses the control.
function focusableControlElement(element) {
	if (element.matches?.(FOCUSABLE_CONTROL_SELECTOR)) {
		return element;
	}
	return element.querySelector?.(FOCUSABLE_CONTROL_SELECTOR);
}

// A field's `hidden` and `disabled` may each be a plain flag or a predicate over the dialog's
// current values, which is what lets one field react to another.
function fieldFlag(setting, values) {
	if (typeof setting === "function") {
		return Boolean(setting(values));
	}
	return Boolean(setting);
}

export class DialogManager {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.onStateChange = options.onStateChange || null;
		this.layer = resolveElement(options.layer, "modal-layer", this.document);
		this.appElement = resolveElement(options.appElement, "app", this.document);
		this.active = null;
		if (!this.layer) {
			throw new Error("DialogManager requires a modal layer");
		}
	}

	#dialogContent(content) {
		if (typeof content === "function") {
			return content({ document: this.document, i18n: this.i18n });
		}
		return content;
	}

	// The dialog's frame: a form, its draggable titlebar, and a body holding the message and any
	// caller-supplied content.
	#createShell(options) {
		const dialog = this.document.createElement("form");
		dialog.className = ["dialog", options.dialogClass].filter(Boolean).join(" ");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		dialog.noValidate = true;

		const titlebar = this.document.createElement("div");
		titlebar.className = "dialog-titlebar";
		const titleId = nextControlId("dialog-title");
		titlebar.id = titleId;
		titlebar.textContent = translated(
			this.i18n,
			options.titleKey || options.title || "dialog.alert",
			options.params,
			Boolean(options.title && !options.titleKey),
		);
		dialog.setAttribute("aria-labelledby", titleId);
		dialog.appendChild(titlebar);

		const body = this.document.createElement("div");
		body.className = "dialog-body";
		if (options.messageKey || options.message) {
			const message = this.document.createElement("p");
			message.className = "dialog-message";
			message.textContent = translated(
				this.i18n,
				options.messageKey || options.message,
				options.params,
				Boolean(options.message && !options.messageKey),
			);
			body.appendChild(message);
		}
		if (options.content) {
			body.appendChild(this.#dialogContent(options.content));
		}
		dialog.appendChild(body);
		return { dialog, titlebar, body };
	}

	#registerFieldTooltip(field, label) {
		const tooltipValue = field.tooltipKey || field.labelKey || field.tooltip || field.label || field.id;
		const tooltipRaw = !field.tooltipKey && !field.labelKey;
		if (this.tooltip) {
			this.tooltip.register(label, tooltipValue, { raw: tooltipRaw });
		} else {
			label.title = tooltipRaw ? String(tooltipValue) : this.i18n.t(tooltipValue);
		}
	}

	// One field's label, control, optional help text and the line its validation message goes in.
	#createFieldEntry(field, values, onFieldChange) {
		const wrapper = this.document.createElement("div");
		wrapper.className = `dialog-field${field.stacked ? " is-stacked" : ""}`;
		const label = this.document.createElement("label");
		label.className = "field-label";
		label.textContent = field.labelKey ? this.i18n.t(field.labelKey) : String(field.label || field.id);
		const control = createFieldControl(field, initialValue(field, values), {
			document: this.document,
			i18n: this.i18n,
			tooltip: this.tooltip,
			onChange: onFieldChange,
		});
		const focusTarget = focusableControlElement(control.element);
		if (focusTarget) {
			focusTarget.id ||= nextControlId("dialog-field");
			label.htmlFor = focusTarget.id;
		}
		if (field.hideLabel) {
			wrapper.append(control.element);
		} else {
			wrapper.append(label, control.element);
		}
		if (field.helpKey || field.help) {
			const help = this.document.createElement("div");
			help.className = "field-help";
			help.textContent = translated(
				this.i18n,
				field.helpKey || field.help,
				{},
				Boolean(field.help && !field.helpKey),
			);
			wrapper.appendChild(help);
		}
		const validation = this.document.createElement("div");
		validation.className = "validation-message";
		validation.setAttribute("aria-live", "polite");
		wrapper.appendChild(validation);
		return { field, wrapper, label, control, validation, disabled: false };
	}

	#createFieldEntries(options, body, values, onFieldChange) {
		const entries = [];
		for (const field of options.fields || []) {
			const entry = this.#createFieldEntry(field, values, onFieldChange);
			body.appendChild(entry.wrapper);
			this.#registerFieldTooltip(field, entry.label);
			entries.push(entry);
		}
		return entries;
	}

	#createActions(options) {
		const actions = this.document.createElement("div");
		actions.className = "dialog-actions";
		const buttonDefinitions = options.buttons || [
			{ id: "ok", labelKey: "dialog.ok", primary: true, submit: true },
			{ id: "cancel", labelKey: "dialog.cancel", value: null, cancel: true, validate: false },
		];
		const buttons = [];
		for (const buttonDefinition of buttonDefinitions) {
			const button = this.document.createElement("button");
			button.type = "button";
			button.className = `dialog-button${buttonDefinition.primary ? " is-primary" : ""}`;
			button.textContent = buttonLabel(this.i18n, buttonDefinition);
			button.dataset.dialogAction = buttonDefinition.id;
			button.addEventListener("click", () => void this.activateButton(buttonDefinition));
			actions.appendChild(button);
			buttons.push({ definition: buttonDefinition, element: button });
		}
		return { actions, buttons };
	}

	// Puts the dialog on screen and makes the rest of the app inert, returning what has to be
	// put back when the dialog closes.
	#mount(dialog) {
		this.layer.hidden = false;
		clearElement(this.layer);
		this.layer.appendChild(dialog);
		const previousFocus = this.document.activeElement;
		const previousInert = this.appElement?.inert;
		const previousAriaHidden = this.appElement?.getAttribute("aria-hidden");
		if (this.appElement) {
			this.appElement.inert = true;
			this.appElement.setAttribute("aria-hidden", "true");
		}
		return { previousFocus, previousInert, previousAriaHidden };
	}

	// Focus goes to the requested field, else the first field that is usable, else the first
	// button, so a dialog is always keyboard-operable the moment it opens.
	#focusInitialControl(entries, buttons, options) {
		const first =
			entries.find(entry => entry.field.id === options.focusField && !entry.disabled)?.control ||
			entries.find(entry => !entry.disabled && !entry.hidden)?.control;
		if (first?.focus) {
			first.focus();
		} else {
			buttons[0]?.element.focus();
		}
	}

	// Editing any field re-runs validation for all of them, because a field's enabled/hidden
	// state and the dialog's own validate callback may depend on the whole set of values.
	#handleFieldChange(options, event) {
		this.refreshDialogState();
		if (this.active && typeof options.onChange === "function") {
			options.onChange(this.readValues(), {
				event,
				entries: this.active.entries,
				refresh: () => this.refreshDialogState(),
			});
		}
	}

	open(options = {}) {
		if (this.active) {
			this.flash();
			return Promise.reject(new Error("A dialog is already open"));
		}
		const { dialog, titlebar, body } = this.#createShell(options);
		const values = { ...(options.values || {}) };
		const entries = this.#createFieldEntries(options, body, values, event =>
			this.#handleFieldChange(options, event),
		);
		const { actions, buttons } = this.#createActions(options);
		dialog.appendChild(actions);
		const restored = this.#mount(dialog);

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
				...restored,
				drag: null,
			};
			this.onStateChange?.(true);
			this.installDialogListeners();
			this.refreshDialogState();
			queueMicrotask(() => this.#focusInitialControl(entries, buttons, options));
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
			if (event.key === "Escape") {
				const cancel = active.buttons.find(button => button.definition.cancel);
				if (cancel) {
					event.preventDefault();
					event.stopImmediatePropagation();
					void this.activateButton(cancel.definition);
				}
				return;
			}
			if (
				event.key === "Enter" &&
				!event.shiftKey &&
				!event.isComposing &&
				!event.target.closest("textarea, button")
			) {
				const primary = active.buttons.find(button => button.definition.primary);
				if (primary && !primary.element.disabled) {
					event.preventDefault();
					void this.activateButton(primary.definition);
				}
			}
		};
		active.onTitlePointerDown = event => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			const rect = active.dialog.getBoundingClientRect();
			active.dialog.style.left = `${rect.left}px`;
			active.dialog.style.top = `${rect.top}px`;
			active.dialog.style.margin = "0";
			active.drag = {
				pointerId: event.pointerId,
				offsetX: event.clientX - rect.left,
				offsetY: event.clientY - rect.top,
			};
		};
		active.onPointerMove = event => {
			if (!active.drag || active.drag.pointerId !== event.pointerId) {
				return;
			}
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
			if (active.drag?.pointerId === event.pointerId) {
				active.drag = null;
			}
		};
		this.document.addEventListener("pointerdown", active.onPointerDown, true);
		this.document.addEventListener("keydown", active.onKeyDown, true);
		active.titlebar.addEventListener("pointerdown", active.onTitlePointerDown);
		this.document.addEventListener("pointermove", active.onPointerMove);
		this.document.addEventListener("pointerup", active.onPointerUp);
		this.document.addEventListener("pointercancel", active.onPointerUp);
	}

	readValues() {
		if (!this.active) {
			return {};
		}
		return Object.fromEntries(this.active.entries.map(entry => [entry.field.id, entry.control.read()]));
	}

	refreshDialogState() {
		if (!this.active) {
			return false;
		}
		const values = this.readValues();
		let valid = true;
		for (const entry of this.active.entries) {
			const hidden = fieldFlag(entry.field.hidden, values);
			entry.hidden = hidden;
			entry.wrapper.hidden = hidden;
			const disabled = fieldFlag(entry.field.disabled, values);
			entry.disabled = disabled;
			entry.wrapper.classList.toggle("is-disabled", disabled);
			entry.control.setDisabled(disabled);
			const error =
				disabled || hidden ? "" : validateField(entry.field, values[entry.field.id], values, this.i18n);
			entry.validation.textContent = error;
			entry.validation.classList.toggle("is-error", Boolean(error));
			valid &&= !error;
		}
		if (typeof this.active.options.validate === "function") {
			valid &&= !this.active.options.validate(values);
		}
		for (const { definition, element } of this.active.buttons) {
			if (definition.validate !== false && (definition.submit || definition.primary)) {
				element.disabled = !valid;
			}
		}
		return valid;
	}

	async activateButton(button) {
		if (!this.active) {
			return;
		}
		const shouldValidate = button.validate !== false && (button.submit || button.primary);
		if (shouldValidate && !this.refreshDialogState()) {
			return;
		}
		const values = this.readValues();
		const active = this.active;
		try {
			for (const entry of active.buttons) {
				entry.element.disabled = true;
			}
			if (typeof button.onClick === "function") {
				const proceed = await button.onClick(values, button.id);
				if (proceed === false) {
					for (const entry of active.buttons) {
						entry.element.disabled = false;
					}
					this.refreshDialogState();
					return;
				}
			}
			if (typeof active.options.onSubmit === "function" && shouldValidate) {
				const proceed = await active.options.onSubmit(values, button.id);
				if (proceed === false) {
					for (const entry of active.buttons) {
						entry.element.disabled = false;
					}
					this.refreshDialogState();
					return;
				}
			}
			const value = typeof button.value === "function" ? button.value(values) : button.value;
			this.close({ button: button.id, value, values });
		} catch (error) {
			for (const entry of active.buttons) {
				entry.element.disabled = false;
			}
			active.reject(error);
			this.teardownDialog();
		}
	}

	close(result = null) {
		if (!this.active) {
			return;
		}
		const resolve = this.active.resolve;
		this.teardownDialog();
		resolve(result);
	}

	teardownDialog() {
		const active = this.active;
		if (!active) {
			return;
		}
		this.document.removeEventListener("pointerdown", active.onPointerDown, true);
		this.document.removeEventListener("keydown", active.onKeyDown, true);
		active.titlebar.removeEventListener("pointerdown", active.onTitlePointerDown);
		this.document.removeEventListener("pointermove", active.onPointerMove);
		this.document.removeEventListener("pointerup", active.onPointerUp);
		this.document.removeEventListener("pointercancel", active.onPointerUp);
		for (const entry of active.entries) {
			entry.control.destroy?.();
			this.tooltip?.unregister(entry.label);
		}
		active.dialog.remove();
		this.layer.hidden = true;
		if (this.appElement) {
			this.appElement.inert = active.previousInert;
			if (active.previousAriaHidden == null) {
				this.appElement.removeAttribute("aria-hidden");
			} else {
				this.appElement.setAttribute("aria-hidden", active.previousAriaHidden);
			}
		}
		this.active = null;
		setTimeout(() => {
			if (this.active) {
				return;
			}
			this.onStateChange?.(false);
			active.previousFocus?.focus?.();
		}, 0);
	}

	flash() {
		const dialog = this.active?.dialog;
		if (!dialog) {
			return;
		}
		dialog.classList.remove("is-warning");
		void dialog.offsetWidth;
		dialog.classList.add("is-warning");
		setTimeout(() => dialog.classList.remove("is-warning"), 1000);
	}

	async form(options = {}) {
		const result = await this.open(options);
		if (!result) {
			return null;
		}
		if (!options.buttons) {
			return result.button === "ok" ? result.values : null;
		}
		const definition = options.buttons.find(button => button.id === result.button);
		return definition && !definition.cancel && (definition.submit || definition.primary) ? result.values : null;
	}

	async confirm(options = {}) {
		const result = await this.open({
			...options,
			buttons: options.buttons || [
				{
					id: "confirm",
					labelKey: options.confirmLabelKey || "dialog.ok",
					primary: true,
					value: true,
					validate: false,
				},
				{
					id: "cancel",
					labelKey: options.cancelLabelKey || "dialog.cancel",
					cancel: true,
					value: false,
					validate: false,
				},
			],
		});
		return Boolean(result?.value);
	}

	async alert(options = {}) {
		await this.open({
			...options,
			buttons: [{ id: "close", labelKey: "dialog.close", primary: true, value: true, validate: false }],
		});
	}
}

export class ToastManager {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.element = resolveElement(options.element, "toast-region", this.document);
		this.duration = options.duration ?? 3200;
		this.maxVisible = options.maxVisible ?? 5;
		this.toasts = [];
		if (!this.element) {
			throw new Error("ToastManager requires a toast region");
		}
	}

	show(keyOrText, params = {}, options = {}) {
		const toast = this.document.createElement("div");
		toast.className = `toast${options.type === "error" ? " is-error" : ""}`;
		toast.setAttribute("role", options.type === "error" ? "alert" : "status");
		toast.textContent = translated(this.i18n, keyOrText, params, Boolean(options.raw));
		this.element.appendChild(toast);
		const entry = { element: toast, timer: null };
		this.toasts.push(entry);
		while (this.toasts.length > this.maxVisible) {
			this.dismiss(this.toasts[0]);
		}
		entry.timer = setTimeout(() => this.dismiss(entry), options.duration ?? this.duration);
		return () => this.dismiss(entry);
	}

	error(keyOrText, params = {}, options = {}) {
		return this.show(keyOrText, params, { ...options, type: "error" });
	}

	dismiss(entry) {
		const index = this.toasts.indexOf(entry);
		if (index >= 0) {
			this.toasts.splice(index, 1);
		}
		clearTimeout(entry?.timer);
		entry?.element.remove();
	}

	clear() {
		for (const entry of [...this.toasts]) {
			this.dismiss(entry);
		}
	}
}
