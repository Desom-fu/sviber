import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";
import { withLayout } from "../js/app/app-layout.js";
import { ChartModel } from "../js/core/chart-model.js";
import { InspectorPanel } from "../js/ui/panels.js";

function matchesSimpleSelector(element, selector) {
	return selector
		.split(",")
		.map(part => part.trim())
		.some(part => {
			if (!part) {
				return false;
			}
			const clean = part.replace(/:enabled$/, "");
			if (part.endsWith(":enabled") && element.disabled) {
				return false;
			}
			const attrMatch = /^([a-z*]*)\[([^\]=]+)(?:="([^"]*)")?\]$/i.exec(clean);
			if (attrMatch) {
				const [, tag, attr, expected] = attrMatch;
				if (tag && tag !== "*" && element.tagName !== tag.toUpperCase()) {
					return false;
				}
				if (attr === "hidden") {
					return Boolean(element.hidden);
				}
				const dataName = attr.startsWith("data-") ? attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : null;
				const actual = dataName ? element.dataset[dataName] : element.attributes.get(attr);
				return expected === undefined ? actual !== undefined : actual === expected;
			}
			if (clean.startsWith(".")) {
				return element.className.split(/\s+/).includes(clean.slice(1));
			}
			return element.tagName === clean.toUpperCase();
		});
}

class FakeElement {
	constructor(tag, ownerDocument) {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.parentElement = null;
		this.dataset = {};
		this.attributes = new Map();
		this.listeners = new Map();
		this.className = "";
		this.textContent = "";
		this.value = "";
		this.type = "";
		this.name = "";
		this.checked = false;
		this.disabled = false;
		this.hidden = false;
		this.ownerDocument = ownerDocument;
	}

	get firstChild() {
		return this.children[0] || null;
	}

	append(...nodes) {
		for (const node of nodes) {
			if (node && typeof node === "object") {
				node.parentElement = this;
				this.children.push(node);
			}
		}
	}

	appendChild(node) {
		this.append(node);
		return node;
	}

	removeChild(node) {
		const index = this.children.indexOf(node);
		if (index >= 0) {
			this.children.splice(index, 1);
			node.parentElement = null;
		}
	}

	replaceChildren(...nodes) {
		for (const child of this.children) {
			child.parentElement = null;
		}
		this.children = [];
		this.append(...nodes);
	}

	setAttribute(name, value) {
		this.attributes.set(name, String(value));
	}

	addEventListener(type, handler) {
		const list = this.listeners.get(type) || [];
		list.push(handler);
		this.listeners.set(type, list);
	}

	removeEventListener(type, handler) {
		const list = this.listeners.get(type) || [];
		const index = list.indexOf(handler);
		if (index >= 0) {
			list.splice(index, 1);
		}
	}

	dispatchEvent(event) {
		const payload = { ...event, target: event.target || this };
		let current = this;
		while (current) {
			for (const handler of current.listeners.get(payload.type) || []) {
				handler(payload);
			}
			current = current.parentElement;
		}
	}

	focus() {
		this.ownerDocument.activeElement = this;
		this.dispatchEvent({ type: "focusin", target: this });
	}

	matches(selector) {
		return matchesSimpleSelector(this, selector);
	}

	closest(selector) {
		let current = this;
		while (current) {
			if (current.matches(selector)) {
				return current;
			}
			current = current.parentElement;
		}
		return null;
	}

	contains(target) {
		let current = target;
		while (current) {
			if (current === this) {
				return true;
			}
			current = current.parentElement;
		}
		return false;
	}

	querySelectorAll(selector) {
		const results = [];
		const walk = node => {
			for (const child of node.children) {
				if (child.matches(selector)) {
					results.push(child);
				}
				walk(child);
			}
		};
		walk(this);
		return results;
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] || null;
	}
}

function createFakeDom() {
	const ownerDocument = { activeElement: null };
	ownerDocument.createElement = tag => new FakeElement(tag, ownerDocument);
	return ownerDocument;
}

test("Events menu places Edit in inspector (E) between Ungroup and Lock", () => {
	assert.equal(COMMAND_DEFINITIONS["events.editInInspector"].shortcut, "E");
	const eventsMenu = MENU_DEFINITION.find(menu => menu.id === "events");
	const items = eventsMenu.items;
	const ungroupIndex = items.findIndex(item => item.command === "events.ungroup");
	const lockIndex = items.findIndex(item => item.command === "events.lock");
	assert.ok(ungroupIndex >= 0 && lockIndex > ungroupIndex);
	assert.deepEqual(
		items.slice(ungroupIndex + 1, lockIndex).map(item => (item.type === "separator" ? "---" : item.command)),
		["---", "events.editInInspector", "---"],
	);
});

test("editInInspector unhides inspector, focuses first input, remembers interacted input, and falls back", () => {
	const previousDocument = globalThis.document;
	const hadDocument = Object.hasOwn(globalThis, "document");
	const fakeDoc = createFakeDom();
	globalThis.document = fakeDoc;
	try {
		const container = fakeDoc.createElement("div");
		const panel = new InspectorPanel({
			element: container,
			i18n: { t: key => key },
			tooltip: { register: () => () => {} },
		});
		const model = ChartModel.createDefault();
		const tap = model.addEvent("tap", { time: [1, 0, 1], x: 0, y: 0, text: "A", selected: true });
		const drag = model.addEvent("drag", { time: [2, 0, 1], x: 10, y: 0, selected: false });
		panel.render(model);

		const App = withLayout(class {});
		const app = new App();
		app.preferences = { rightPanelsHidden: true };
		app.inspectorPanel = panel;
		let activatedTab = null;
		app.activateSideTab = id => {
			activatedTab = id;
		};
		app.persistLayoutPreferences = patch => {
			app.preferences = { ...app.preferences, ...patch };
		};

		// Before any interaction, focuses the first focusable inspector input and unhides the panel.
		const first = app.editInInspector();
		assert.equal(app.preferences.rightPanelsHidden, false);
		assert.equal(activatedTab, "inspector");
		assert.ok(first);
		assert.equal(first.dataset.inspectorInputKey, "field.type:0");
		assert.equal(fakeDoc.activeElement, first);

		// Simulate interacting with the text input.
		const textInput = container.querySelector('[data-inspector-input-key="field.text:0"]');
		assert.ok(textInput);
		textInput.dispatchEvent({ type: "focusin" });
		assert.equal(panel.lastInteractedInputKey, "field.text:0");

		// Re-render for the tap and trigger Edit in inspector -> focuses the text input again.
		panel.render(model);
		const remembered = app.editInInspector();
		assert.equal(remembered?.dataset.inspectorInputKey, "field.text:0");
		assert.equal(fakeDoc.activeElement, remembered);

		// Switch selection to drag (which has no text input) -> falls back to first input.
		tap.selected = false;
		drag.selected = true;
		panel.render(model);
		const fallback = app.editInInspector();
		assert.equal(fallback?.dataset.inspectorInputKey, "field.type:0");
		assert.equal(panel.lastInteractedInputKey, "field.text:0");

		// Switch back to tap -> still remembers the text input from this session.
		drag.selected = false;
		tap.selected = true;
		panel.render(model);
		assert.equal(app.editInInspector()?.dataset.inspectorInputKey, "field.text:0");
	} finally {
		if (hadDocument) {
			globalThis.document = previousDocument;
		} else {
			delete globalThis.document;
		}
	}
});
