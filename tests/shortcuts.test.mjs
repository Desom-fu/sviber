import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, CommandRegistry, parseShortcut } from "../js/app/commands.js";
import { HelpController } from "../js/ui/help.js";

function keyboardEvent(key, target) {
	return {
		key,
		target,
		defaultPrevented: false,
		isComposing: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		repeat: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopImmediatePropagation() {},
	};
}

test("difficulty selector focus preserves Space and numeric shortcuts", () => {
	let executions = 0;
	const registry = new CommandRegistry({
		space: { id: "space", shortcut: "Space" },
		number: { id: "number", shortcut: "1" },
	});
	registry.register("space", () => {
		executions += 1;
	});
	registry.register("number", () => {
		executions += 1;
	});
	const difficulty = {
		closest() {
			return difficulty;
		},
		matches(selector) {
			return selector === "#difficulty-select";
		},
	};
	assert.equal(registry.handleKeyboard(keyboardEvent(" ", difficulty), {}), true);
	assert.equal(registry.handleKeyboard(keyboardEvent("1", difficulty), {}), true);
	assert.equal(executions, 2);
});

test("keyboard shortcut dialog lists group and ungroup", async () => {
	const previousDocument = globalThis.document;
	const hadDocument = Object.hasOwn(globalThis, "document");
	const makeNode = tag => ({
		tag,
		children: [],
		dataset: {},
		className: "",
		textContent: "",
		append(...children) {
			this.children.push(...children);
		},
	});
	globalThis.document = { createElement: tag => makeNode(tag) };
	let dialog;
	const tooltipKeys = [];
	try {
		const help = new HelpController({
			i18n: { t: key => key, shortcut: shortcut => shortcut },
			dialogs: {
				open: async options => {
					dialog = options;
				},
			},
			tooltip: {
				register: (_element, key) => {
					tooltipKeys.push(key);
					return () => {};
				},
			},
		});
		await help.showKeyboardShortcuts(COMMAND_DEFINITIONS);
		const groups = dialog.content.children.flatMap(column => column.children);
		const rows = groups.flatMap(group =>
			group.children[1].children.flatMap(row => row.children.map(child => child.textContent)),
		);
		assert.ok(rows.includes("command.events.group"));
		assert.ok(rows.includes("command.events.ungroup"));
		assert.ok(rows.includes("Ctrl+G"));
		assert.ok(rows.includes("Ctrl+Shift+G"));
		assert.ok(tooltipKeys.includes("command.events.group.hint"));
		assert.equal(dialog.dialogClass, "keyboard-shortcuts-dialog");
		assert.ok(groups.some(group => group.children[0].textContent === "menu.events"));
	} finally {
		if (hadDocument) {
			globalThis.document = previousDocument;
		} else {
			delete globalThis.document;
		}
	}
});

test("global shortcuts remain active when a status checkbox is focused", () => {
	let executions = 0;
	const registry = new CommandRegistry({
		space: { id: "space", shortcut: "Space" },
		number: { id: "number", shortcut: "1" },
	});
	registry.register("space", () => {
		executions += 1;
	});
	registry.register("number", () => {
		executions += 1;
	});
	const checkbox = {
		closest() {
			return checkbox;
		},
		matches(selector) {
			return selector === 'input[type="checkbox"], input[type="radio"]';
		},
	};
	const event = key => ({
		key,
		target: checkbox,
		defaultPrevented: false,
		isComposing: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		repeat: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopImmediatePropagation() {},
	});
	assert.equal(registry.handleKeyboard(event(" "), {}), true);
	assert.equal(registry.handleKeyboard(event("1"), {}), true);
	assert.equal(executions, 2);
});

test("Ctrl+Space does not activate a focused status checkbox", () => {
	let executions = 0;
	const registry = new CommandRegistry({
		space: { id: "space", shortcut: "Space" },
	});
	registry.register("space", () => {
		executions += 1;
	});
	const checkbox = {
		closest() {
			return checkbox;
		},
		matches(selector) {
			return selector === 'input[type="checkbox"], input[type="radio"]';
		},
	};
	const event = {
		key: " ",
		target: checkbox,
		defaultPrevented: false,
		isComposing: false,
		ctrlKey: true,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		repeat: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopImmediatePropagation() {},
	};
	assert.equal(registry.handleKeyboard(event, {}), false);
	assert.equal(event.defaultPrevented, true);
	assert.equal(executions, 0);
});

test("shortcuts describe reverse playback, A-B marks, exact speed, channels, and page direction", () => {
	assert.equal(COMMAND_DEFINITIONS["music.playReverse"].shortcut, "Shift+Space");
	assert.equal(COMMAND_DEFINITIONS["music.abLoop"].shortcut, "L");
	assert.equal(COMMAND_DEFINITIONS["music.speed025"].shortcut, "Ctrl+4");
	assert.equal(COMMAND_DEFINITIONS["channel.selectLast"].shortcut, "Alt+0");
	assert.equal(COMMAND_DEFINITIONS["timeline.pageForward"].shortcut, "PageUp");
	assert.deepEqual(parseShortcut("Ctrl+Alt+M"), { ctrl: true, shift: false, alt: true, meta: false, key: "m" });
});
