import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalizeRationalTuple, validateField } from "../js/ui/ui-fields.js";

test("non-coprime beat inputs are accepted and auto-reduced", () => {
	assert.deepEqual(canonicalizeRationalTuple([1, 2, 4]), [1, 1, 2]);
	assert.equal(validateField({ type: "rational" }, [1, 2, 4], {}), "");
	assert.ok(validateField({ type: "rational" }, [1, 1, 0], {}));
});

test("rational validation waits for a canonical, reduced tuple", () => {
	assert.equal(validateField({ type: "rational" }, [1, 1, 2]), "");
	assert.equal(validateField({ type: "rational" }, [1, 2, 2]), "");
	assert.equal(validateField({ type: "rational" }, [0, 0, 2]), "");
	assert.equal(validateField({ type: "rational" }, [-1, 1, 2]), "");
	assert.equal(validateField({ type: "rational" }, [-1, -1, 2]), "");
	assert.notEqual(validateField({ type: "rational" }, [1, 1, 0]), "");
});

// v18 fix: a field that hides its label contributes no cell for the label column, so without
// `is-full` its control was squeezed into that narrow column. This is what made the
// "Automatic timing..." parameter groups render as a malformed layout.
test("a dialog field without a label spans the whole width", async () => {
	const [dialogs, styles, form] = await Promise.all([
		readFile(new URL("../js/ui/ui-dialogs.js", import.meta.url), "utf8"),
		readFile(new URL("../css/dialogs.css", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/auto-timing-form.js", import.meta.url), "utf8"),
	]);
	assert.match(dialogs, /field\.hideLabel \? "is-full" : ""/);
	assert.match(styles, /\.dialog-field\.is-full \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
	// The automatic timing form is the caller that needs it.
	assert.match(form, /hideLabel: true/);
});
