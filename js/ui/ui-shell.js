import { i18n as defaultI18n } from "./i18n.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION, TOOLBAR_ITEMS } from "../app/commands.js";
import { appendMnemonic, clearElement, resolveElement, translated } from "./ui-shared.js";

export class TooltipManager {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.i18n = options.i18n || defaultI18n;
		this.element = resolveElement(options.element, "tooltip-text", this.document);
		this.defaultKey = options.defaultKey || "tooltip.ready";
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
			titleRaw: Boolean(options.titleRaw ?? options.raw),
		};
		entry.enter = () => {
			this.activeElement = element;
			this.show(entry.tooltip, entry.params, entry.raw);
		};
		entry.leave = event => {
			if (event.type === "focusout" && element.contains(event.relatedTarget)) {
				return;
			}
			if (this.activeElement === element) {
				this.activeElement = null;
				this.reset();
			}
		};
		element.addEventListener("pointerenter", entry.enter);
		element.addEventListener("pointerleave", entry.leave);
		element.addEventListener("focusin", entry.enter);
		element.addEventListener("focusout", entry.leave);
		this.entries.set(element, entry);
		this.updateTitle(element, entry);
		return () => this.unregister(element);
	}

	bind(root = this.document) {
		const elements = [];
		if (root?.matches?.("[data-tooltip-key]")) {
			elements.push(root);
		}
		elements.push(...(root?.querySelectorAll?.("[data-tooltip-key]") || []));
		for (const element of elements) {
			this.register(element, element.dataset.tooltipKey);
		}
	}

	unregister(element) {
		const entry = this.entries.get(element);
		if (!entry) {
			return;
		}
		element.removeEventListener("pointerenter", entry.enter);
		element.removeEventListener("pointerleave", entry.leave);
		element.removeEventListener("focusin", entry.enter);
		element.removeEventListener("focusout", entry.leave);
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
		this.element = resolveElement(options.element, "menu-bar", this.document);
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
			throw new Error("MenuBar requires an element and a CommandRegistry");
		}
		this.render();
		this.onDocumentKeyDown = event => this.handleKeyDown(event);
		this.onDocumentPointerDown = event => this.handleOutsidePointerDown(event);
		this.onDocumentClick = event => this.handleSuppressedClick(event);
		this.document.addEventListener("keydown", this.onDocumentKeyDown, true);
		this.document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
		this.document.addEventListener("click", this.onDocumentClick, true);
		this.unsubscribeRegistry = this.registry.subscribe(() => this.updateState(null));
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.updateLabels());
	}

	render() {
		for (const buttons of this.commandButtons.values()) {
			for (const button of buttons) {
				this.tooltip?.unregister(button);
			}
		}
		clearElement(this.element);
		this.element.setAttribute("role", "menubar");
		this.roots = [];
		this.commandButtons.clear();
		this.definition.forEach((menu, index) => {
			const root = this.document.createElement("div");
			root.className = "menu-root";
			root.dataset.menuId = menu.id;

			const rootButton = this.document.createElement("button");
			rootButton.type = "button";
			rootButton.className = "menu-root-button";
			rootButton.setAttribute("role", "menuitem");
			rootButton.setAttribute("aria-haspopup", "true");
			rootButton.setAttribute("aria-expanded", "false");
			rootButton.addEventListener("click", event => {
				event.stopPropagation();
				this.openIndex === index ? this.close() : this.open(index);
			});
			rootButton.addEventListener("pointerenter", () => {
				if (this.openIndex >= 0 && this.openIndex !== index) {
					this.open(index);
				}
			});
			rootButton.addEventListener("keydown", event => {
				if (this.openIndex >= 0) {
					return;
				}
				if (["ArrowDown", "Enter", " "].includes(event.key)) {
					event.preventDefault();
					this.open(index, { focusFirst: true });
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					this.open(index, { focusLast: true });
				}
			});
			root.appendChild(rootButton);

			const popup = this.document.createElement("div");
			popup.className = "menu-popup";
			popup.setAttribute("role", "menu");
			const visibleEntries = menu.items.filter(
				entry =>
					entry.type === "separator" ||
					!this.registry.get(entry.command).definition.desktopOnly ||
					globalThis.nw,
			);
			const normalizedEntries = visibleEntries.filter(
				(entry, entryIndex, entries) =>
					entry.type !== "separator" || (entryIndex > 0 && entries[entryIndex - 1].type !== "separator"),
			);
			if (normalizedEntries.at(-1)?.type === "separator") {
				normalizedEntries.pop();
			}
			for (const entry of normalizedEntries) {
				if (entry.type === "separator") {
					const line = this.document.createElement("div");
					line.className = "menu-separator";
					line.setAttribute("role", "separator");
					popup.appendChild(line);
					continue;
				}
				popup.appendChild(this.createCommandButton(entry.command));
			}
			root.appendChild(popup);
			this.element.appendChild(root);
			this.roots.push({ definition: menu, root, rootButton, popup });
		});
		this.updateLabels();
		this.updateState(null);
	}

	createCommandButton(id) {
		const definition = COMMAND_DEFINITIONS[id] || this.registry.get(id).definition;
		const button = this.document.createElement("button");
		button.type = "button";
		button.className = "menu-command";
		button.dataset.command = id;
		button.setAttribute("role", definition.checkable ? "menuitemcheckbox" : "menuitem");

		const iconBox = this.document.createElement("span");
		iconBox.className = "menu-command-icon";
		if (definition.icon) {
			const image = this.document.createElement("img");
			image.src = definition.icon;
			image.alt = "";
			image.draggable = false;
			iconBox.appendChild(image);
		}
		button.appendChild(iconBox);

		const label = this.document.createElement("span");
		label.className = "menu-command-label";
		button.appendChild(label);
		const shortcut = this.document.createElement("span");
		shortcut.className = "menu-shortcut";
		button.appendChild(shortcut);
		button.addEventListener("click", event => {
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
		for (const { definition, rootButton } of this.roots) {
			appendMnemonic(this.document, rootButton, this.i18n.t(definition.labelKey), definition.mnemonic);
		}
		for (const [id, buttons] of this.commandButtons) {
			const definition = this.registry.get(id).definition;
			for (const button of buttons) {
				button.querySelector(".menu-command-label").textContent = this.i18n.t(definition.labelKey);
				button.querySelector(".menu-shortcut").textContent = this.i18n.shortcut(definition.shortcut);
				this.tooltip?.register(button, definition.hintKey);
			}
		}
	}

	updateState(id) {
		const ids = Array.isArray(id) ? id : id ? [id] : [...this.commandButtons.keys()];
		const context = this.contextProvider();
		for (const commandId of ids) {
			const buttons = this.commandButtons.get(commandId);
			if (!buttons) {
				continue;
			}
			const state = this.registry.state(commandId, context);
			for (const button of buttons) {
				button.disabled = !state.enabled;
				button.setAttribute("aria-disabled", String(!state.enabled));
				if (state.definition.checkable) {
					button.setAttribute("aria-checked", String(state.checked));
					button.classList.toggle("is-active", state.checked);
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
		this.updateState(
			this.definition[index].items.filter(entry => entry.type === "command").map(entry => entry.command),
		);
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
		root.root.classList.toggle("is-open", open);
		root.rootButton.setAttribute("aria-expanded", String(open));
		root.popup.classList.remove("is-aligned-right");
		if (open && root.popup.getBoundingClientRect().right > this.document.documentElement.clientWidth) {
			root.popup.classList.add("is-aligned-right");
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
		return [...this.roots[this.openIndex].popup.querySelectorAll(".menu-command:not(:disabled)")];
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
		this.open(index, { focusFirst: true });
	}

	handleKeyDown(event) {
		if (this.document.querySelector(".modal-layer:not([hidden])")) {
			return;
		}
		if (event.altKey && !event.ctrlKey && !event.metaKey) {
			const index = this.definition.findIndex(menu => menu.mnemonic.toLowerCase() === event.key.toLowerCase());
			if (index >= 0) {
				event.preventDefault();
				event.stopImmediatePropagation();
				this.open(index, { focusFirst: true });
				return;
			}
		}
		if (this.openIndex < 0) {
			return;
		}
		switch (event.key) {
			case "Escape":
				event.preventDefault();
				event.stopImmediatePropagation();
				this.close({ focusRoot: true });
				break;
			case "ArrowLeft":
				event.preventDefault();
				event.stopImmediatePropagation();
				this.switchRoot(-1);
				break;
			case "ArrowRight":
				event.preventDefault();
				event.stopImmediatePropagation();
				this.switchRoot(1);
				break;
			case "ArrowDown":
			case "Tab":
				event.preventDefault();
				event.stopImmediatePropagation();
				this.moveFocus(event.shiftKey ? -1 : 1);
				break;
			case "ArrowUp":
				event.preventDefault();
				event.stopImmediatePropagation();
				this.moveFocus(-1);
				break;
			case "Home": {
				event.preventDefault();
				const items = this.focusableItems();
				items[0]?.focus();
				break;
			}
			case "End": {
				event.preventDefault();
				const items = this.focusableItems();
				items[items.length - 1]?.focus();
				break;
			}
			case "Enter":
			case " ": {
				const active = this.document.activeElement;
				if (active?.classList.contains("menu-command")) {
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
		this.document.removeEventListener("keydown", this.onDocumentKeyDown, true);
		this.document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
		this.document.removeEventListener("click", this.onDocumentClick, true);
		this.unsubscribeRegistry?.();
		this.unsubscribeLanguage?.();
		clearTimeout(this.suppressTimer);
	}
}

export class Toolbar {
	constructor(options = {}) {
		this.document = options.document || globalThis.document;
		this.element = resolveElement(options.element, "tool-bar", this.document);
		this.registry = options.registry;
		this.i18n = options.i18n || defaultI18n;
		this.tooltip = options.tooltip || null;
		this.items = options.items || TOOLBAR_ITEMS;
		this.contextProvider = options.contextProvider || (() => undefined);
		this.buttons = new Map();
		if (!this.element || !this.registry) {
			throw new Error("Toolbar requires an element and a CommandRegistry");
		}
		this.render();
		this.unsubscribeRegistry = this.registry.subscribe(() => this.updateState(null));
		this.unsubscribeLanguage = this.i18n.subscribe(() => this.updateLabels());
	}

	render() {
		for (const button of this.buttons.values()) {
			this.tooltip?.unregister(button);
		}
		clearElement(this.element);
		this.buttons.clear();
		for (const id of this.items) {
			if (id === "separator") {
				const separator = this.document.createElement("div");
				separator.className = "tool-separator";
				separator.setAttribute("role", "separator");
				this.element.appendChild(separator);
				continue;
			}
			const definition = this.registry.get(id).definition;
			const button = this.document.createElement("button");
			button.type = "button";
			button.className = "tool-button";
			button.dataset.command = id;
			if (definition.checkable) {
				button.setAttribute("aria-pressed", "false");
			}
			if (definition.icon) {
				const image = this.document.createElement("img");
				image.src = definition.icon;
				image.alt = "";
				image.draggable = false;
				button.appendChild(image);
			}
			button.addEventListener("click", event => {
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
			button.setAttribute("aria-label", label);
			this.tooltip?.register(button, definition.hintKey, { title, titleRaw: true });
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
			button.classList.toggle("is-active", state.checked);
			if (state.definition.checkable) {
				button.setAttribute("aria-pressed", String(state.checked));
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
