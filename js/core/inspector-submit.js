// Submit an inspector field that disappears while it still has an uncommitted edit
// (PROMPT-v26). Works with real DOM inputs and with the test doubles that expose the
// same `type` / `value` / `dataset.initialValue` / `dispatchEvent` surface.

export function inspectorControlCurrent(control) {
	if (control.type === "checkbox" || control.type === "radio") {
		return String(control.checked);
	}
	return String(control.value ?? "");
}

export function isInspectorControlDirty(control) {
	const initial = control?.dataset?.initialValue;
	if (initial === undefined) {
		return false;
	}
	return inspectorControlCurrent(control) !== initial;
}

export function collectDirtyInspectorControls(root) {
	const list = root?.querySelectorAll?.("input, select, textarea");
	return [...(list || [])].filter(isInspectorControlDirty);
}

export function flushInspectorEdits(root, EventCtor = globalThis.Event) {
	const Construct = EventCtor || class SyntheticEvent {
		constructor(type, init = {}) {
			this.type = type;
			this.bubbles = Boolean(init.bubbles);
		}
	};
	const dirty = collectDirtyInspectorControls(root);
	for (const control of dirty) {
		control.dispatchEvent?.(new Construct("change", { bubbles: true }));
	}
	return dirty;
}
