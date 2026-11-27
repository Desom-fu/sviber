import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, CommandRegistry } from "../js/app/commands.js";
import { withBulkEditTexts } from "../js/app/app-bulk-edit.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";
import { createFieldControl } from "../js/ui/ui-fields.js";

function createBulkEditHarness(model) {
	const App = withBulkEditTexts(class {});
	const app = new App();
	app.model = model;
	app.currentBeat = () => Rational.from(0);
	let commits = 0;
	app.commit = (_label, mutator) => {
		commits += 1;
		mutator(app.model);
	};
	return { app, getCommits: () => commits };
}

test("Bulk edit texts has Ctrl+E shortcut and both bulk edit commands remain enabled in read-only mode", () => {
	assert.equal(COMMAND_DEFINITIONS["events.bulkEditTexts"].shortcut, "Ctrl+E");
	assert.equal(COMMAND_DEFINITIONS["events.bulkEditTexts"].allowWhenReadOnly, true);
	assert.equal(COMMAND_DEFINITIONS["events.bulkEditTextsByChannel"].allowWhenReadOnly, true);

	const registry = new CommandRegistry(COMMAND_DEFINITIONS);
	const model = ChartModel.createDefault({ editor: { readOnly: true } });
	model.addEvent("tap", { time: [1, 0, 1], x: 0, y: 0, text: "hi", selected: true });
	let ran = false;
	registry.register(
		"events.bulkEditTexts",
		() => {
			ran = true;
		},
		() => true,
	);
	registry.register("events.bulkEditTextsByChannel", () => {}, () => true);

	const readOnlyContext = { readOnly: true };
	assert.equal(registry.isEnabled("events.bulkEditTexts", readOnlyContext), true);
	assert.equal(registry.isEnabled("events.bulkEditTextsByChannel", readOnlyContext), true);
	const matched = registry.handleKeyboard(
		{
			key: "e",
			target: null,
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
		},
		readOnlyContext,
	);
	assert.equal(matched, true);
	assert.equal(ran, true);
});

test("both bulk edit dialogs open with non-editable text boxes and never mutate chart in read-only mode", async () => {
	const model = ChartModel.createDefault({
		channels: [
			{ id: 0, name: "Lead" },
			{ id: 1, name: "Harmony" },
		],
		editor: { readOnly: true, currentChannel: 0 },
	});
	const tapA = model.addEvent("tap", { time: [1, 0, 1], channel: 0, x: 0, y: 0, text: "alpha", selected: true });
	const tapB = model.addEvent("tap", { time: [2, 0, 1], channel: 1, x: 10, y: 0, text: "beta", selected: true });
	const { app, getCommits } = createBulkEditHarness(model);

	const captured = [];
	app.dialogs = {
		async form(options) {
			captured.push(options);
			if (options.onChange) {
				const fakeTextarea = {
					value: options.values.text,
					selectionStart: 0,
					selectionEnd: 0,
					setSelectionRange(start, end) {
						this.selectionStart = start;
						this.selectionEnd = end;
					},
				};
				options.onChange(
					{ channel: "1", text: "ignored edit" },
					{
						entries: [
							{
								field: { id: "text" },
								control: { element: fakeTextarea, read: () => "ignored edit" },
							},
						],
					},
				);
				assert.equal(fakeTextarea.value, "beta");
			}
			return { ...options.values, text: "mutated" };
		},
	};

	const resultSelection = await app.showBulkEditTextsDialog();
	const resultChannel = await app.showBulkEditTextsByChannelDialog();

	assert.equal(resultSelection, false);
	assert.equal(resultChannel, false);
	assert.equal(getCommits(), 0);
	assert.equal(tapA.text, "alpha");
	assert.equal(tapB.text, "beta");

	assert.equal(captured.length, 2);
	const selectionTextField = captured[0].fields.find(field => field.id === "text");
	const channelTextField = captured[1].fields.find(field => field.id === "text");
	assert.equal(selectionTextField.readOnly, true);
	assert.equal(channelTextField.readOnly, true);
	assert.equal(captured[0].buttons?.length, 1);
	assert.equal(captured[1].buttons?.length, 1);
});

test("createFieldControl sets readOnly on textarea controls when field.readOnly is true", () => {
	const previousDocument = globalThis.document;
	const hadDocument = Object.hasOwn(globalThis, "document");
	globalThis.document = {
		createElement(tag) {
			return {
				tagName: tag.toUpperCase(),
				className: "",
				value: "",
				readOnly: false,
				rows: 0,
				addEventListener() {},
			};
		},
	};
	try {
		const control = createFieldControl(
			{ id: "text", type: "textarea", rows: 8, readOnly: true },
			"readonly text",
			{
				i18n: { t: key => key },
				onChange: () => {},
			},
		);
		assert.equal(control.element.readOnly, true);
		assert.equal(control.element.value, "readonly text");
	} finally {
		if (hadDocument) {
			globalThis.document = previousDocument;
		} else {
			delete globalThis.document;
		}
	}
});
