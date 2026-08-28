import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	applyPresetDifficultyColor,
	isUserFieldEdit,
	trackDialogFieldEdits,
} from "../js/app/app-helpers.js";
import { DIFFICULTY_COLORS } from "../js/core/chart-model.js";
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

function nameColorDialog(event) {
	const nameInput = {
		contains(target) {
			return target === this;
		},
	};
	const color = {
		value: "#123456",
		matches(selector) {
			return selector === 'input[type="color"]';
		},
	};
	return {
		color,
		dialogState: {
			event,
			entries: [
				{ field: { id: "difficultyName" }, control: { element: nameInput } },
				{ field: { id: "difficultyColor" }, control: { element: color } },
			],
			refresh() {},
		},
		nameInput,
	};
}

test("difficulty color presets wait for a user edit of the name field", () => {
	const opened = nameColorDialog({ type: "input", target: null });
	opened.dialogState.event.target = opened.nameInput;
	applyPresetDifficultyColor({ difficultyName: "Master" }, opened.dialogState);
	assert.equal(opened.color.value, "#123456");
	opened.dialogState.event = {
		type: "input",
		inputType: "insertReplacementText",
		target: opened.nameInput,
	};
	applyPresetDifficultyColor({ difficultyName: "Master" }, opened.dialogState);
	assert.equal(opened.color.value, "#123456");
	opened.dialogState.event = { type: "input", inputType: "insertText", target: opened.nameInput };
	applyPresetDifficultyColor({ difficultyName: "Master" }, opened.dialogState);
	assert.equal(opened.color.value, DIFFICULTY_COLORS.master);
});

test("last charter is remembered only after the user edits the charter field", () => {
	const charterInput = {
		contains(target) {
			return target === this;
		},
	};
	const tracking = trackDialogFieldEdits(["charter"]);
	const dialogState = {
		event: { type: "input", target: charterInput },
		entries: [{ field: { id: "charter" }, control: { element: charterInput } }],
	};
	tracking.onChange({ charter: "Imported" }, dialogState);
	assert.equal(isUserFieldEdit(dialogState, "charter"), false);
	assert.equal(tracking.userEdited("charter"), false);
	dialogState.event = { type: "input", inputType: "insertText", target: charterInput };
	tracking.onChange({ charter: "Me" }, dialogState);
	assert.equal(tracking.userEdited("charter"), true);
});

test("chart property forms remember charter only after a user edit", async () => {
	const [lifecycle, media] = await Promise.all([
		readFile(new URL("../js/app/app-document-lifecycle.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-preferences-media.js", import.meta.url), "utf8"),
	]);
	assert.match(lifecycle, /trackDialogFieldEdits\(\["charter"\]/);
	assert.match(lifecycle, /tracking\.userEdited\("charter"\)/);
	assert.match(media, /trackDialogFieldEdits\(\["charter"\]/);
	assert.match(media, /tracking\.userEdited\("charter"\)/);
});
