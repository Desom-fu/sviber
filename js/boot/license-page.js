// v21: the page texts come from the JSON i18n data instead of being hardcoded in the
// HTML attributes.
let vocabulary = null;
const SUPPORTED_LANGUAGES = new Set(["en-US", "zh-CN", "zh-TW", "ja-JP"]);

function translate(key) {
	return vocabulary?.[key] ?? key;
}

function formatMessage(template, values) {
	return String(template || "").replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

async function loadVocabulary(language) {
	const response = await fetch(`json/i18n.${language}.json`, { cache: "no-cache" });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	vocabulary = await response.json();
}

function normalizeLanguage(value) {
	const language = String(value || "").toLowerCase();
	if (language.startsWith("zh-tw") || language.startsWith("zh-hk") || language.startsWith("zh-mo")) {
		return "zh-TW";
	}
	if (language.startsWith("zh")) {
		return "zh-CN";
	}
	if (language.startsWith("ja")) {
		return "ja-JP";
	}
	return "en-US";
}

function applyTexts() {
	document.title = `${translate("license.title")} - sviber`;
	for (const element of document.querySelectorAll("[data-i18n-key]")) {
		element.textContent = translate(element.dataset.i18nKey);
	}
}

(function () {
	"use strict";

	const SOURCES = new Set([
		"js/app/app.js",
		"js/boot/font-loader.js",
		"js/boot/nw-source-bootstrap.js",
		"js/boot/vendor-loader.js",
		"js/boot/license-page.js",
		"service-worker.js",
		"docs/docs.js",
	]);

	function preferences() {
		try {
			return JSON.parse(localStorage.getItem("sviber.preferences") || "{}");
		} catch {
			return {};
		}
	}

	const stored = preferences();
	if (stored.theme === "light" || stored.theme === "dark") {
		document.documentElement.dataset.theme = stored.theme;
	}
	const systemLanguage = normalizeLanguage(navigator.language);
	const language = SUPPORTED_LANGUAGES.has(stored.language) ? stored.language : systemLanguage;
	document.documentElement.lang = language;

	loadVocabulary(language)
		.then(applyTexts)
		.catch(error => console.warn("License i18n data unavailable", error));

	function returnToEditor(event) {
		event.preventDefault();
		const fallback = event.currentTarget.href;
		try {
			window.opener?.focus();
		} catch {
			/* Cross-origin opener access can be denied. */
		}
		window.close();
		setTimeout(() => location.assign(fallback), 50);
	}

	async function loadSource() {
		const output = document.getElementById("source-code");
		if (!output) {
			return;
		}
		const filename = new URLSearchParams(location.search).get("file") || "";
		const title = document.getElementById("source-title");
		if (!SOURCES.has(filename)) {
			title.textContent = translate("license.sourceUnavailable");
			output.textContent = translate("license.sourceUnavailableHint");
			return;
		}
		title.textContent = filename;
		document.title = `${filename} - ${translate("license.sourceViewerTitle")}`;
		try {
			const response = await fetch(new URL(filename, location.href));
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			output.textContent = await response.text();
		} catch (error) {
			output.textContent = formatMessage(translate("license.loadFailed"), {
				filename,
				message: error.message,
			});
		}
	}

	document.addEventListener("DOMContentLoaded", () => {
		for (const link of document.querySelectorAll("[data-return-editor]")) {
			link.addEventListener("click", returnToEditor);
		}
		for (const link of document.querySelectorAll("[data-view-source]")) {
			link.addEventListener("click", event => {
				event.preventDefault();
				location.href = `source-viewer.html?file=${encodeURIComponent(link.dataset.viewSource)}`;
			});
		}
		for (const link of document.querySelectorAll("[data-external]")) {
			link.addEventListener("click", event => {
				if (!globalThis.nw?.Shell?.openExternal) {
					return;
				}
				event.preventDefault();
				globalThis.nw.Shell.openExternal(link.href);
			});
		}
		void loadSource();
	});
})();
