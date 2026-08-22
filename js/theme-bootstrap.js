"use strict";

(() => {
	const PREFERENCES_KEY = "sviber.preferences";
	const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");

	function storedTheme() {
		try {
			const value = JSON.parse(globalThis.localStorage?.getItem(PREFERENCES_KEY) || "{}");
			return value.theme === "light" || value.theme === "dark" ? value.theme : "system";
		} catch {
			return "system";
		}
	}

	function apply(theme = storedTheme()) {
		const selected = theme === "light" || theme === "dark" ? theme : "system";
		if (selected === "system") document.documentElement.removeAttribute("data-theme");
		else document.documentElement.dataset.theme = selected;
		const dark = selected === "dark" || selected === "system" && Boolean(media?.matches);
		document.documentElement.classList.toggle("theme-dark", dark);
		document.documentElement.classList.toggle("theme-light", !dark);
		document.querySelector('meta[name="theme-color"]')
			?.setAttribute("content", dark ? "#292c30" : "#eceeef");
		globalThis.dispatchEvent(new CustomEvent("sviber-theme-change", {
			detail: { theme: selected, dark },
		}));
		return { theme: selected, dark };
	}

	globalThis.sviberTheme = Object.freeze({
		apply,
		read: storedTheme,
		isDark: () => document.documentElement.dataset.theme === "dark"
			|| !document.documentElement.hasAttribute("data-theme") && Boolean(media?.matches),
	});
	apply();
	globalThis.addEventListener("storage", event => {
		if (event.key === PREFERENCES_KEY) apply();
	});
	media?.addEventListener?.("change", () => {
		if (storedTheme() === "system") apply("system");
	});
})();
