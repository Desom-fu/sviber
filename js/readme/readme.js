import { MESSAGES, SUPPORTED_LANGUAGES, normalizeLanguage } from "../ui/i18n.js";
import { loadMonaco } from "../macro/macro-monaco-loader.js";
import { needsDisplayTextFile } from "../platform/platform-file-kinds.js";
import { DEFAULT_PREFERENCES, loadPreferences, storePreferences } from "../app/app-helpers.js";

function preferredLanguage() {
	const query = new URLSearchParams(location.search).get("lang");
	if (SUPPORTED_LANGUAGES.includes(query)) {
		return query;
	}
	try {
		const stored = JSON.parse(localStorage.getItem("sviber.preferences") || "{}").language;
		if (SUPPORTED_LANGUAGES.includes(stored)) {
			return stored;
		}
	} catch {
		/* ignore */
	}
	return normalizeLanguage(navigator.language);
}

const LANGUAGE = preferredLanguage();
const t = key =>
	MESSAGES[LANGUAGE][`readme.${key}`] ?? MESSAGES["en-US"][`readme.${key}`] ?? key;

const files = new Map();
let active = null;
let editor = null;
let previewHidden = loadPreferences().readmePreviewHidden;

function applyLocale() {
	document.documentElement.lang = LANGUAGE;
	document.title = t("page.title");
	for (const element of document.querySelectorAll("[data-i18n]")) {
		element.textContent = t(element.dataset.i18n);
	}
}

function request(type, payload = {}) {
	return new Promise(resolve => {
		if (!window.opener) {
			resolve({ ok: false });
			return;
		}
		const requestId = `${Date.now()}-${Math.random()}`;
		const onMessage = event => {
			if (event.source !== window.opener || event.data?.requestId !== requestId) {
				return;
			}
			window.removeEventListener("message", onMessage);
			resolve(event.data);
		};
		window.addEventListener("message", onMessage);
		window.opener.postMessage({ type, requestId, ...payload }, "*");
	});
}

function applyLayout() {
	const prefs = loadPreferences();
	const workspace = document.querySelector(".readme-workspace");
	workspace.style.setProperty("--readme-sidebar", `${prefs.readmeSidebarWidthFraction * 100}%`);
	workspace.style.setProperty("--readme-preview", `${prefs.readmePreviewWidthFraction * 100}%`);
	workspace.classList.toggle("is-preview-hidden", previewHidden || !isMarkdown(active));
}

function isMarkdown(name) {
	return /\.(md|markdown)$/i.test(name || "");
}

function renderList() {
	const sidebar = document.getElementById("readme-sidebar");
	sidebar.replaceChildren();
	for (const [name, record] of files) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `readme-file${name === active ? " is-active" : ""}`;
		button.textContent = `${record.dirty ? "* " : ""}${name}`;
		button.addEventListener("click", () => openFile(name));
		sidebar.append(button);
	}
}

function renderPreview() {
	const pane = document.getElementById("readme-preview");
	if (previewHidden || !isMarkdown(active)) {
		pane.innerHTML = "";
		applyLayout();
		return;
	}
	const text = editor?.getValue?.() ?? files.get(active)?.text ?? "";
	const html = globalThis.marked?.parse?.(text) ?? text;
	pane.innerHTML = globalThis.DOMPurify?.sanitize?.(html) ?? html;
	applyLayout();
}

function openFile(name) {
	if (active && editor) {
		const record = files.get(active);
		if (record) {
			record.text = editor.getValue();
		}
	}
	active = name;
	const record = files.get(name);
	if (editor && record) {
		editor.setValue(record.text);
	}
	renderList();
	renderPreview();
}

async function loadFiles() {
	const result = await request("sviber-readme-list");
	for (const name of result.files || []) {
		const read = await request("sviber-readme-read", { filename: name });
		files.set(name, { text: read.text || "", dirty: false });
	}
	if (!files.size) {
		files.set("README.md", { text: "", dirty: false });
	}
	openFile([...files.keys()][0]);
}

function markDirty() {
	const record = files.get(active);
	if (record && editor) {
		record.text = editor.getValue();
		record.dirty = true;
		renderList();
		renderPreview();
	}
}

async function saveActive() {
	const record = files.get(active);
	if (!record) {
		return;
	}
	record.text = editor?.getValue?.() ?? record.text;
	const result = await request("sviber-readme-write", { filename: active, text: record.text });
	if (result.ok) {
		record.dirty = false;
		renderList();
	}
}

function promptName(initial) {
	const name = window.prompt(t("form.filename"), initial);
	if (!name || !needsDisplayTextFile(name)) {
		return null;
	}
	return name;
}

function bindMenus() {
	document.addEventListener("click", event => {
		const action = event.target.closest("[data-action]")?.dataset.action;
		if (!action) {
			return;
		}
		if (action === "new") {
			const name = promptName(files.has("README.md") ? "" : "README.md");
			if (name) {
				files.set(name, { text: "", dirty: true });
				openFile(name);
			}
		} else if (action === "save") {
			void saveActive();
		} else if (action === "rename") {
			const name = promptName(active);
			if (name && name !== active) {
				const record = files.get(active);
				files.delete(active);
				files.set(name, record);
				active = name;
				renderList();
			}
		} else if (action === "toggle-preview") {
			if (!isMarkdown(active)) {
				return;
			}
			previewHidden = !previewHidden;
			storePreferences({ ...loadPreferences(), readmePreviewHidden: previewHidden });
			applyLayout();
		} else if (action === "reset-layout") {
			storePreferences({
				...loadPreferences(),
				readmeSidebarWidthFraction: DEFAULT_PREFERENCES.readmeSidebarWidthFraction,
				readmePreviewWidthFraction: DEFAULT_PREFERENCES.readmePreviewWidthFraction,
				readmePreviewHidden: false,
			});
			previewHidden = false;
			applyLayout();
		} else if (action === "undo") {
			editor?.trigger?.("readme", "undo");
		} else if (action === "redo") {
			editor?.trigger?.("readme", "redo");
		}
	});
	document.addEventListener("keydown", event => {
		if (event.ctrlKey && event.key.toLowerCase() === "s") {
			event.preventDefault();
			void saveActive();
		}
		if (event.ctrlKey && event.key.toLowerCase() === "n") {
			event.preventDefault();
			document.querySelector("[data-action='new']")?.click();
		}
		if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") {
			event.preventDefault();
			document.querySelector("[data-action='toggle-preview']")?.click();
		}
	});
}

async function loadPreviewLibraries() {
	const inject = src =>
		new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = src;
			script.onload = resolve;
			script.onerror = reject;
			document.head.append(script);
		});
	try {
		await inject("https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js");
		await inject("https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js");
	} catch {
		/* Preview libraries are optional when offline. */
	}
}

applyLocale();
bindMenus();
applyLayout();
await loadPreviewLibraries();
const monaco = await loadMonaco(LANGUAGE);
editor = monaco.editor.create(document.getElementById("readme-editor"), {
	value: "",
	language: "markdown",
	automaticLayout: true,
	theme: document.documentElement.dataset.theme === "light" ? "vs" : "vs-dark",
});
editor.onDidChangeModelContent(markDirty);
await loadFiles();
