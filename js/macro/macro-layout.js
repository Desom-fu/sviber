import { DEFAULT_PREFERENCES, loadPreferences, storePreferences } from "../app/app-helpers.js";

export function applyMacroLayout() {
	const prefs = loadPreferences();
	const workspace = document.querySelector(".macro-workspace");
	const area = document.querySelector(".macro-editor-area");
	if (workspace) {
		workspace.style.gridTemplateColumns = `${prefs.macrosSidebarWidthFraction * 100}% minmax(0, 1fr)`;
	}
	if (area) {
		area.classList.toggle("is-console-hidden", prefs.macrosConsoleHidden);
		if (!prefs.macrosConsoleHidden) {
			area.style.gridTemplateRows = `32px minmax(0, 1fr) ${prefs.macrosConsoleHeightFraction * 100}%`;
		}
	}
}

export function installMacroLayout() {
	applyMacroLayout();
	document.addEventListener("click", event => {
		const action = event.target.closest("[data-action]")?.dataset.action;
		if (action === "toggle-console") {
			const prefs = loadPreferences();
			storePreferences({ ...prefs, macrosConsoleHidden: !prefs.macrosConsoleHidden });
			applyMacroLayout();
		} else if (action === "reset-layout") {
			storePreferences({
				...loadPreferences(),
				macrosSidebarWidthFraction: DEFAULT_PREFERENCES.macrosSidebarWidthFraction,
				macrosConsoleHeightFraction: DEFAULT_PREFERENCES.macrosConsoleHeightFraction,
				macrosConsoleHidden: false,
			});
			applyMacroLayout();
		}
	});
	document.addEventListener("dragover", event => {
		if (event.dataTransfer?.files?.length) {
			event.preventDefault();
		}
	});
	document.addEventListener("drop", event => {
		const file = event.dataTransfer?.files?.[0];
		if (!file) {
			return;
		}
		event.preventDefault();
		document.getElementById("macro-import")?.dispatchEvent(new Event("change"));
		const input = document.getElementById("macro-import");
		if (input) {
			const transfer = new DataTransfer();
			transfer.items.add(file);
			input.files = transfer.files;
			input.dispatchEvent(new Event("change"));
		}
	});
}
