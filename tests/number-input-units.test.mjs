import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createFieldControl } from "../js/ui/ui-fields.js";

test("number inputs can show a unit suffix after the control", () => {
	const documentRef = {
		createElement(tag) {
			const element = {
				tagName: tag,
				children: [],
				style: {},
				className: "",
				textContent: "",
				value: "",
				append(...nodes) {
					this.children.push(...nodes);
				},
				addEventListener() {},
				setAttribute() {},
			};
			return element;
		},
	};
	const control = createFieldControl(
		{ id: "offset", type: "number", unit: "s" },
		0.5,
		{ document: documentRef, i18n: { t: key => key } },
	);
	assert.equal(control.element.className, "field-control-row");
	assert.ok(control.element.children.some(child => child.className === "field-unit" && child.textContent === "s"));
	assert.equal(control.read(), 0.5);
});

test("preference and check seconds fields declare unit s", async () => {
	const [prefs, config] = await Promise.all([
		readFile(new URL("../js/app/app-preferences-media.js", import.meta.url), "utf8"),
		readFile(new URL("../js/core/checks-config.js", import.meta.url), "utf8"),
	]);
	assert.match(prefs, /unit: "s"/);
	assert.match(config, /unit: "s"/);
});
