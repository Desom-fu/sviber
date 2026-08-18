(function () {
	"use strict";

	const SOURCES = new Set([
		"js/app.js", "js/font-loader.js", "js/nw-source-bootstrap.js", "js/vendor-loader.js",
		"js/license-page.js", "service-worker.js", "docs/docs.js",
	]);

	function preferences() {
		try { return JSON.parse(localStorage.getItem("sviber.preferences") || "{}"); }
		catch { return {}; }
	}

	const stored = preferences();
	if (stored.theme === "light" || stored.theme === "dark") {
		document.documentElement.dataset.theme = stored.theme;
	}
	const systemLanguage = String(navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
	const language = stored.language === "zh-CN" || stored.language === "en-US" ? stored.language : systemLanguage;
	document.documentElement.lang = language;

	function returnToEditor(event) {
		event.preventDefault();
		const fallback = event.currentTarget.href;
		try { window.opener?.focus(); } catch { /* Cross-origin opener access can be denied. */ }
		window.close();
		setTimeout(() => location.assign(fallback), 50);
	}

	async function loadSource() {
		const output = document.getElementById("source-code");
		if (!output) return;
		const filename = new URLSearchParams(location.search).get("file") || "";
		const title = document.getElementById("source-title");
		if (!SOURCES.has(filename)) {
			title.textContent = "Source unavailable";
			output.textContent = "The requested file is not part of the JavaScript license source list.";
			return;
		}
		title.textContent = filename;
		document.title = `${filename} - sviber source viewer`;
		try {
			const response = await fetch(new URL(filename, location.href));
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			output.textContent = await response.text();
		} catch (error) {
			output.textContent = `Unable to load ${filename}: ${error.message}`;
		}
	}

	document.addEventListener("DOMContentLoaded", () => {
		for (const element of document.querySelectorAll("[data-license-en]")) {
			element.textContent = element.dataset[language === "zh-CN" ? "licenseZh" : "licenseEn"];
		}
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
				if (!globalThis.nw?.Shell?.openExternal) return;
				event.preventDefault();
				globalThis.nw.Shell.openExternal(link.href);
			});
		}
		void loadSource();
	});
})();
