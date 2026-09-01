import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../js/app/commands.js";
import { Toolbar } from "../js/ui/ui-shell.js";

function createNode(tag) {
	const node = {
		tagName: tag,
		className: "",
		disabled: false,
		dataset: {},
		children: [],
		attributes: {},
		classList: {
			toggle(name, on) {
				node.classes ||= new Set();
				if (on) {
					node.classes.add(name);
				} else {
					node.classes.delete(name);
				}
			},
		},
		setAttribute(name, value) {
			node.attributes[name] = String(value);
		},
		appendChild(child) {
			node.children.push(child);
			return child;
		},
		addEventListener() {},
	};
	return node;
}

test("a single command notify refreshes every toolbar button against current context", () => {
	const previousDocument = globalThis.document;
	const element = createNode("div");
	globalThis.document = {
		createElement: tag => createNode(tag),
		getElementById: () => element,
	};
	try {
		const registry = new CommandRegistry();
		let timeDragActive = false;
		const toolbar = new Toolbar({
			element,
			registry,
			document: globalThis.document,
			items: ["events.tap", "events.flick"],
			contextProvider: () => ({ timeDragActive: () => timeDragActive }),
		});
		assert.equal(toolbar.buttons.get("events.tap").disabled, false);
		assert.equal(toolbar.buttons.get("events.flick").disabled, false);
		timeDragActive = true;
		registry.notify("events.tap");
		assert.equal(toolbar.buttons.get("events.tap").disabled, true);
		assert.equal(toolbar.buttons.get("events.flick").disabled, true);
		timeDragActive = false;
		registry.notify("events.flick");
		assert.equal(toolbar.buttons.get("events.tap").disabled, false);
		assert.equal(toolbar.buttons.get("events.flick").disabled, false);
	} finally {
		globalThis.document = previousDocument;
	}
});
