import { MESSAGES } from "./i18n.js";

const GLOBAL_KEY = "sviber.macros";
const MONACO_VERSION = "0.52.2";
const MONACO_CDN_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
function preferredLanguage() {
	const query = new URLSearchParams(location.search).get("lang");
	if (query === "en-US" || query === "zh-CN") return query;
	try {
		const stored = JSON.parse(localStorage.getItem("sviber.preferences") || "{}").language;
		if (stored === "en-US" || stored === "zh-CN") return stored;
	} catch { /* Ignore unavailable or malformed preference storage. */ }
	return String(navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}
const LANGUAGE = preferredLanguage();
const t = key => MESSAGES[LANGUAGE][`macro.${key}`] ?? MESSAGES["en-US"][`macro.${key}`] ?? key;
const interpolate = (key, values = {}) => t(key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));

const elements = {
	list: document.getElementById("macro-list"),
	tabs: document.getElementById("macro-editor-tabs"),
	editor: document.getElementById("macro-editor"),
	fallback: document.getElementById("macro-fallback"),
	console: document.getElementById("macro-console-output"),
	import: document.getElementById("macro-import"),
	dialog: document.getElementById("macro-form-dialog"),
	form: document.getElementById("macro-form"),
	formTitle: document.getElementById("macro-form-title"),
	formName: document.getElementById("macro-form-name"),
	formScope: document.getElementById("macro-form-scope-field"),
	formLanguage: document.getElementById("macro-form-language-field"),
	formError: document.getElementById("macro-form-error"),
};
const macros = { global: new Map(), project: new Map() };
const openTabs = new Map();
let activeKey = null;
let activeList = "global";
let editor = null;
let editorReady = false;
let requestCounter = 0;
let projectAvailable = false;
let projectMacrosLoaded = false;
let readOnly = false;
let rubyResourcesPromise = null;

window.addEventListener("sviber-theme-change", event => {
	if (editorReady && globalThis.monaco?.editor) {
		globalThis.monaco.editor.setTheme(event.detail?.dark ? "vs-dark" : "vs");
	}
});

function applyLocale() {
	document.documentElement.lang = LANGUAGE;
	for (const element of document.querySelectorAll("[data-i18n]")) {
		const value = t(element.dataset.i18n);
		if (element.dataset.mnemonic && LANGUAGE === "en-US" && value.length > 1) {
			element.innerHTML = `<u>${element.dataset.mnemonic}</u>${value.slice(1)}`;
		} else element.textContent = value;
	}
	for (const element of document.querySelectorAll("[data-i18n-aria]")) element.setAttribute("aria-label", t(element.dataset.i18nAria));
}

function request(type, payload = {}) {
	return new Promise(resolve => {
		if (!window.opener) {
			resolve({ ok: false });
			return;
		}
		const requestId = `macro-${++requestCounter}`;
		let timer = 0;
		const finish = value => {
			window.removeEventListener("message", listener);
			clearTimeout(timer);
			resolve(value);
		};
		const listener = event => {
			if (event.source !== window.opener || event.data?.requestId !== requestId) return;
			finish(event.data);
		};
		window.addEventListener("message", listener);
		window.opener.postMessage({ type, requestId, ...payload }, "*");
		timer = setTimeout(() => finish({ requestId, ok: false }), 5000);
	});
}

function readGlobal() {
	try {
		const value = JSON.parse(localStorage.getItem(GLOBAL_KEY) || "{}");
		for (const [storedName, stored] of Object.entries(value)) {
			const language = stored && typeof stored === "object" && stored.language === "ruby" ? "ruby" : "javascript";
			const name = macroName(storedName);
			const content = stored && typeof stored === "object" ? stored.content : stored;
			if (name && !hasMacroName(macros.global, name)) {
				macros.global.set(name, { name, type: "global", language, content: String(content ?? "") });
			}
		}
	} catch { /* A damaged macro store is treated as empty. */ }
}

function writeGlobal() {
	const value = Object.fromEntries([...macros.global].map(([name, macro]) => [name, {
		language: macro.language === "ruby" ? "ruby" : "javascript",
		content: macro.content,
	}]));
	try { localStorage.setItem(GLOBAL_KEY, JSON.stringify(value)); } catch { appendConsole(t("error.globalStore"), "error"); }
}

function appendConsole(value, kind = "log") {
	const prefix = kind === "error" ? "[error] " : "";
	elements.console.textContent += `${prefix}${String(value)}\n`;
	elements.console.parentElement.scrollTop = elements.console.parentElement.scrollHeight;
}

function hasMacroName(collection, name) {
	const key = String(name || "").trim().toLocaleLowerCase("en-US");
	return [...collection.keys()].some(existing => String(existing).trim().toLocaleLowerCase("en-US") === key);
}

function uniqueName(name, type) {
	const base = String(name || "macro").trim() || "macro";
	if (!hasMacroName(macros[type], base)) return base;
	let index = 2;
	while (hasMacroName(macros[type], `${base} ${index}`)) index += 1;
	return `${base} ${index}`;
}

function macroFilename(name, language = "javascript") {
	const value = String(name || "").trim();
	if (!value || /[<>:"/\\|?*\u0000-\u001f]/.test(value) || value === "." || value === "..") return null;
	return `${value.replace(/\.(?:js|rb)$/i, "")}.${language === "ruby" ? "rb" : "js"}`;
}

function macroName(name) {
	return String(name || "").trim().replace(/\.(?:js|rb)$/i, "");
}

function macroKey(macro) { return `${macro.type}:${macro.name}`; }

function validateMacroName(name, collection, language = "javascript") {
	const clean = macroName(name);
	if (!clean) return t("error.emptyName");
	if (!macroFilename(clean, language)) return t("error.reservedName");
	if (collection && hasMacroName(collection, clean)) return t("error.duplicateName");
	return "";
}

function showMacroForm({
	titleKey, initialName = "", includeScope = true, scope = "global",
	includeLanguage = false, language = "javascript", validate,
} = {}) {
	if (!elements.dialog || !elements.form) return Promise.resolve(null);
	return new Promise(resolve => {
		let settled = false;
		const projectRadio = elements.form.querySelector('input[name="macro-scope"][value="project"]');
		const globalRadio = elements.form.querySelector('input[name="macro-scope"][value="global"]');
		const rubyRadio = elements.form.querySelector('input[name="macro-language"][value="ruby"]');
		const javascriptRadio = elements.form.querySelector('input[name="macro-language"][value="javascript"]');
		const cancelButton = elements.form.querySelector("[data-macro-cancel]");
		const finish = value => {
			if (settled) return;
			settled = true;
			elements.dialog.close();
			elements.form.removeEventListener("submit", submit);
			elements.form.removeEventListener("reset", cancel);
			elements.dialog.removeEventListener("cancel", cancel);
			cancelButton?.removeEventListener("click", cancel);
			resolve(value);
		};
		const cancel = event => {
			event?.preventDefault();
			finish(null);
		};
		const submit = event => {
			event.preventDefault();
			const name = macroName(elements.formName.value);
			const selectedScope = includeScope && projectAvailable && !readOnly && projectRadio?.checked ? "project" : "global";
			const selectedLanguage = includeLanguage && rubyRadio?.checked ? "ruby" : language;
			const error = validate?.(name, selectedScope, selectedLanguage) || "";
			if (error) {
				elements.formError.textContent = error;
				elements.formError.hidden = false;
				elements.formName.focus();
				return;
			}
			finish({ name, type: selectedScope, language: selectedLanguage });
		};
		elements.formTitle.textContent = t(titleKey);
		elements.formName.value = initialName;
		elements.formError.hidden = true;
		elements.formError.textContent = "";
		elements.formScope.hidden = !includeScope;
		elements.formLanguage.hidden = !includeLanguage;
		const projectWritable = projectAvailable && !readOnly;
		if (projectRadio) projectRadio.disabled = !projectWritable || !includeScope;
		if (globalRadio) globalRadio.checked = !includeScope || scope !== "project" || !projectWritable;
		if (projectRadio) projectRadio.checked = includeScope && scope === "project" && projectWritable;
		if (rubyRadio) rubyRadio.checked = includeLanguage && language === "ruby";
		if (javascriptRadio) javascriptRadio.checked = !includeLanguage || language !== "ruby";
		elements.form.addEventListener("submit", submit);
		elements.form.addEventListener("reset", cancel);
		elements.dialog.addEventListener("cancel", cancel);
		cancelButton?.addEventListener("click", cancel);
		elements.dialog.showModal();
		elements.formName.focus();
		elements.formName.select();
	});
}

function currentTab() { return activeKey ? openTabs.get(activeKey) : null; }

function tabIsEditable(tab = currentTab()) {
	return !readOnly || tab?.macro?.type !== "project";
}

function refreshReadOnlyState() {
	const tab = currentTab();
	const editable = tabIsEditable(tab);
	if (editorReady) editor.updateOptions({ readOnly: !editable });
	elements.fallback.readOnly = !editable;
	const projectRadio = elements.form?.querySelector('input[name="macro-scope"][value="project"]');
	if (projectRadio) projectRadio.disabled = readOnly || !projectAvailable;
	const blockedForProject = new Set(["save", "rename", "delete", "undo", "redo", "cut", "paste"]);
	for (const button of document.querySelectorAll("[data-action]")) {
		const disabled = readOnly && (button.dataset.action === "run"
			|| tab?.macro?.type === "project" && blockedForProject.has(button.dataset.action));
		button.disabled = disabled;
		button.setAttribute("aria-disabled", String(disabled));
	}
}

function setReadOnlyState(value) {
	readOnly = Boolean(value);
	refreshReadOnlyState();
}

function getEditorValue() {
	return editorReady ? editor.getValue() : elements.fallback.value;
}

function setEditorValue(value) {
	if (editorReady) editor.setValue(String(value));
	else elements.fallback.value = String(value);
}

function markDirty() {
	const tab = currentTab();
	if (!tab || tab.loading || !tabIsEditable(tab)) return;
	tab.macro.content = getEditorValue();
	tab.dirty = true;
	renderTabs();
}

function renderList() {
	elements.list.replaceChildren();
	for (const macro of macros[activeList].values()) {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = macro.name;
		button.classList.toggle("is-active", activeKey === macroKey(macro));
		button.addEventListener("click", () => openMacro(macro));
		elements.list.append(button);
	}
	if (!elements.list.childElementCount) {
		const empty = document.createElement("div");
		empty.textContent = activeList === "project" && !projectAvailable ? t("empty.projectBrowser") : t("empty.none");
		empty.style.cssText = "padding:12px;color:var(--muted);font-size:12px";
		elements.list.append(empty);
	}
}

function renderTabs() {
	elements.tabs.replaceChildren();
	for (const [key, tab] of openTabs) {
		const button = document.createElement("div");
		button.className = `editor-tab${key === activeKey ? " is-active" : ""}`;
		button.tabIndex = 0;
		button.setAttribute("role", "tab");
		button.setAttribute("aria-selected", String(key === activeKey));
		const label = document.createElement("span");
		label.textContent = `${tab.dirty ? "*" : ""}${tab.macro.name}`;
		label.style.overflow = "hidden";
		label.style.textOverflow = "ellipsis";
		button.append(label);
		const close = document.createElement("button");
		close.type = "button";
		close.className = "tab-close";
		close.textContent = "x";
		close.title = LANGUAGE === "zh-CN" ? "关闭标签" : "Close tab";
		close.addEventListener("click", event => { event.stopPropagation(); closeTab(key); });
		button.append(close);
		button.addEventListener("click", () => activateTab(key));
		button.addEventListener("keydown", event => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				activateTab(key);
			}
		});
		elements.tabs.append(button);
	}
}

function activateTab(key) {
	const tab = openTabs.get(key);
	if (!tab) return;
	if (activeKey && openTabs.has(activeKey)) openTabs.get(activeKey).macro.content = getEditorValue();
	activeKey = key;
	tab.loading = true;
	setEditorValue(tab.macro.content);
	if (editorReady) {
		globalThis.monaco?.editor.setModelLanguage(editor.getModel(), tab.macro.language === "ruby" ? "ruby" : "javascript");
		editor.layout();
	}
	queueMicrotask(() => { tab.loading = false; });
	renderTabs();
	renderList();
	refreshReadOnlyState();
}

function openMacro(macro) {
	const key = macroKey(macro);
	if (!openTabs.has(key)) openTabs.set(key, { macro, dirty: false, loading: false });
	activateTab(key);
}

function closeTab(key, force = false) {
	const tab = openTabs.get(key);
	if (!tab) return;
	if (!force && tab.dirty && !window.confirm(interpolate("message.discard", { name: tab.macro.name }))) return;
	openTabs.delete(key);
	if (activeKey === key) {
		activeKey = openTabs.keys().next().value || null;
		if (activeKey) activateTab(activeKey);
		else { setEditorValue(""); renderTabs(); }
	}
	renderList();
	refreshReadOnlyState();
}

async function loadProjectMacros() {
	if (!projectAvailable || projectMacrosLoaded) return;
	projectMacrosLoaded = true;
	const result = await request("sviber-macro-project-list");
	for (const filename of result.files || []) {
		const language = String(filename).toLowerCase().endsWith(".rb") ? "ruby" : "javascript";
		const name = macroName(filename);
		if (!name || hasMacroName(macros.project, name)) continue;
		const content = await request("sviber-macro-project-read", { filename });
		if (content.text != null) macros.project.set(name, {
			name, type: "project", language, filename, content: content.text,
		});
	}
	renderList();
}

async function saveTab(tab) {
	if (!tab) return false;
	if (!tabIsEditable(tab)) { appendConsole(t("error.readOnly"), "error"); return false; }
	tab.macro.content = getEditorValue();
	if (tab.macro.type === "global") writeGlobal();
	else {
		if (!projectAvailable) { appendConsole(t("error.projectUnavailable"), "error"); return false; }
		const result = await request("sviber-macro-project-write", {
			filename: tab.macro.filename || macroFilename(tab.macro.name, tab.macro.language),
			text: tab.macro.content,
		});
		if (!result.ok) { appendConsole(t("error.saveProject"), "error"); return false; }
	}
	tab.dirty = false;
	renderTabs();
	renderList();
	return true;
}

async function newMacro() {
	const values = await showMacroForm({
		titleKey: "form.newTitle", initialName: uniqueName("macro", activeList), includeScope: true,
		includeLanguage: true,
		validate: (name, type, language) => validateMacroName(name, macros[type], language),
	});
	if (!values) return;
	const { name: clean, type, language } = values;
	const filename = macroFilename(clean, language);
	const content = language === "ruby"
		? "# sviber macro\nputs \"hello\"\n"
		: "// sviber macro\nconsole.log(\"hello\");\n";
	const macro = { name: clean, type, language, filename, content };
	if (type === "project") {
		const result = await request("sviber-macro-project-write", { filename, text: macro.content });
		if (!result.ok) { appendConsole(t("error.createProject"), "error"); return; }
	}
	macros[type].set(clean, macro);
	if (type === "global") writeGlobal();
	openMacro(macro);
}

async function renameMacro() {
	const tab = currentTab();
	if (!tab) return;
	if (!tabIsEditable(tab)) { appendConsole(t("error.readOnly"), "error"); return; }
	const values = await showMacroForm({
		titleKey: "form.renameTitle", initialName: tab.macro.name, includeScope: false,
		language: tab.macro.language,
		validate: name => name === tab.macro.name ? "" : validateMacroName(name, macros[tab.macro.type], tab.macro.language),
	});
	if (!values || values.name === tab.macro.name) return;
	const name = values.name;
	const filename = macroFilename(name, tab.macro.language);
	const oldFilename = tab.macro.filename;
	if (tab.macro.type === "project") {
		const result = await request("sviber-macro-project-rename", { oldFilename, newFilename: filename });
		if (!result.ok) { appendConsole(result.error || t("error.renameProject"), "error"); return; }
	}
	const oldKey = macroKey(tab.macro);
	macros[tab.macro.type].delete(tab.macro.name);
	tab.macro.name = name;
	if (tab.macro.type === "project") tab.macro.filename = filename;
	macros[tab.macro.type].set(name, tab.macro);
	openTabs.delete(oldKey);
	openTabs.set(macroKey(tab.macro), tab);
	activeKey = macroKey(tab.macro);
	if (tab.macro.type === "global") writeGlobal();
	renderTabs();
	renderList();
}

function importMacro() {
	elements.import.value = "";
	elements.import.click();
}

async function handleImport() {
	const file = elements.import.files?.[0];
	if (!file) return;
	const importedLanguage = String(file.name).toLowerCase().endsWith(".rb") ? "ruby" : "javascript";
	const values = await showMacroForm({
		titleKey: "form.importTitle", initialName: uniqueName(macroName(file.name), activeList), includeScope: true,
		includeLanguage: true, language: importedLanguage,
		validate: (name, type, language) => validateMacroName(name, macros[type], language),
	});
	if (!values) return;
	const { name, type, language } = values;
	const filename = macroFilename(name, language);
	const macro = { name, type, language, filename, content: await file.text() };
	if (type === "project") {
		const result = await request("sviber-macro-project-write", { filename, text: macro.content });
		if (!result.ok) { appendConsole(t("error.importProject"), "error"); return; }
	}
	macros[type].set(name, macro);
	if (type === "global") writeGlobal();
	openMacro(macro);
}

function chooseNwSavePath(suggestedName, accept) {
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.className = "visually-hidden";
		input.setAttribute("nwsaveas", suggestedName);
		let settled = false;
		const finish = value => {
			if (settled) return;
			settled = true;
			window.removeEventListener("focus", onFocus);
			input.remove();
			resolve(value && !String(value).includes("fakepath") ? String(value) : null);
		};
		const selectedPath = () => input.files?.[0]?.path || input.value || "";
		const onFocus = () => setTimeout(() => finish(selectedPath()), 250);
		input.addEventListener("change", () => finish(selectedPath()), { once: true });
		input.addEventListener("cancel", () => finish(null), { once: true });
		window.addEventListener("focus", onFocus, { once: true });
		document.body.append(input);
		input.click();
	});
}

async function exportMacro() {
	const tab = currentTab();
	if (!tab) return;
	const content = getEditorValue();
	const extension = tab.macro.language === "ruby" ? ".rb" : ".js";
	const mime = tab.macro.language === "ruby" ? "text/x-ruby" : "text/javascript";
	const description = tab.macro.language === "ruby" ? "Ruby macro" : "JavaScript macro";
	const filename = `${tab.macro.name}${extension}`;
	if (globalThis.nw) {
		try {
			let pathname = await chooseNwSavePath(filename, `${extension},${mime}`);
			if (!pathname) return;
			if (!pathname.toLowerCase().endsWith(extension)) pathname += extension;
			const nodeRequire = window.nodeRequire || globalThis.nw.require;
			const filesystem = nodeRequire?.("fs");
			if (!filesystem) throw new Error("fs unavailable");
			await filesystem.promises.writeFile(pathname, content, "utf8");
			appendConsole(t("message.exported"));
		} catch (error) { appendConsole(`${t("error.export")} ${error?.message || error}`, "error"); }
		return;
	}
	if (typeof globalThis.showSaveFilePicker === "function") {
		try {
			const handle = await globalThis.showSaveFilePicker({
				suggestedName: filename,
				types: [{ description, accept: { [mime]: [extension] } }],
			});
			const writable = await handle.createWritable();
			await writable.write(content);
			await writable.close();
			appendConsole(t("message.exported"));
		} catch (error) {
			if (error?.name !== "AbortError") appendConsole(`${t("error.export")} ${error?.message || error}`, "error");
		}
		return;
	}
	const blob = new Blob([content], { type: mime });
	const anchor = document.createElement("a");
	anchor.href = URL.createObjectURL(blob);
	anchor.download = filename;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
	appendConsole(t("message.exported"));
}

async function deleteMacro() {
	const tab = currentTab();
	if (!tabIsEditable(tab)) { appendConsole(t("error.readOnly"), "error"); return; }
	if (!tab || !window.confirm(interpolate("message.delete", { name: tab.macro.name }))) return;
	if (tab.macro.type === "project") {
		const result = await request("sviber-macro-project-delete", { filename: tab.macro.filename });
		if (!result.ok) {
			appendConsole(result.error || t("error.deleteProject"), "error");
			return;
		}
	}
	const key = macroKey(tab.macro);
	macros[tab.macro.type].delete(tab.macro.name);
	if (tab.macro.type === "global") writeGlobal();
	closeTab(key, true);
	renderList();
	appendConsole(t("message.deleted"));
}

function loadRubyResources() {
	if (!rubyResourcesPromise) {
		const localFirst = Boolean(globalThis.nw) || location.protocol === "file:"
			|| /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname);
		const wasmSources = localFirst
			? ["node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm", "https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.7.2/dist/ruby+stdlib.wasm"]
			: ["https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.7.2/dist/ruby+stdlib.wasm", "node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm"];
		const fetchWasm = async () => {
			let failure;
			for (const source of wasmSources) {
				try {
					const response = await fetch(new URL(source, location.href));
					if (!response.ok) throw new Error(`ruby.wasm HTTP ${response.status}`);
					return await response.arrayBuffer();
				} catch (error) { failure = error; }
			}
			throw failure || new Error("ruby.wasm is unavailable.");
		};
		rubyResourcesPromise = Promise.all([
			fetch(new URL("js/macro-api.rb", location.href)).then(response => {
				if (!response.ok) throw new Error(`Ruby API HTTP ${response.status}`);
				return response.text();
			}),
			fetchWasm(),
		]).then(([rubyApi, rubyBytes]) => ({ rubyApi, rubyBytes }));
	}
	return rubyResourcesPromise;
}

async function runMacro() {
	if (readOnly) { appendConsole(t("error.readOnly"), "error"); return; }
	const tab = currentTab();
	if (!tab) { appendConsole(t("error.noMacro"), "error"); return; }
	tab.macro.content = getEditorValue();
	const stateResult = await request("sviber-macro-state-request");
	setReadOnlyState(stateResult.readOnly);
	if (readOnly) { appendConsole(t("error.readOnly"), "error"); return; }
	if (!stateResult.state) {
		appendConsole(window.opener ? t("error.noState") : t("error.noOpener"), "error");
		return;
	}
	let rubyResources = {};
	if (tab.macro.language === "ruby") {
		try { rubyResources = await loadRubyResources(); }
		catch (error) {
			appendConsole(`${t("error.rubyLoad")} ${error?.message || error}`, "error");
			return;
		}
	}
	const frame = document.createElement("iframe");
	frame.sandbox.add("allow-scripts");
	frame.hidden = true;
	const result = await new Promise(resolve => {
		let timer = 0;
		const finish = value => {
			window.removeEventListener("message", listener);
			clearTimeout(timer);
			resolve(value);
		};
		const listener = event => {
			if (event.source !== frame.contentWindow) return;
			if (event.data?.type === "log") appendConsole(event.data.values.join(" "), event.data.kind);
			if (event.data?.type === "result" || event.data?.type === "error") {
				finish(event.data);
			}
		};
		window.addEventListener("message", listener);
		frame.addEventListener("load", () => frame.contentWindow.postMessage({
			type: "run", code: tab.macro.content, state: stateResult.state,
			language: tab.macro.language, ...rubyResources,
		}, "*"), { once: true });
		frame.src = new URL("macro-sandbox.html", location.href).href;
		document.body.append(frame);
		timer = setTimeout(() => finish({ type: "error", message: t("message.timeout") }), 60_000);
	});
	frame.remove();
	if (result.type === "error") { appendConsole(result.message, "error"); return; }
	const applied = await request("sviber-macro-apply", { state: result.state });
	if (applied.ok) appendConsole(t("message.applied"));
	else appendConsole(applied.error || t("error.noState"), "error");
}

function installMenus() {
	for (const root of document.querySelectorAll(".menu-root")) {
		root.querySelector("[data-menu]").addEventListener("click", () => {
			for (const other of document.querySelectorAll(".menu-root")) if (other !== root) other.classList.remove("is-open");
			root.classList.toggle("is-open");
		});
	}
	document.addEventListener("click", event => { if (!event.target.closest(".menu-root")) document.querySelectorAll(".menu-root").forEach(root => root.classList.remove("is-open")); });
	document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => {
		document.querySelectorAll(".menu-root").forEach(root => root.classList.remove("is-open"));
		const editAction = action => {
			const commands = { cut: "editor.action.clipboardCutAction", copy: "editor.action.clipboardCopyAction", paste: "editor.action.clipboardPasteAction" };
			if (editorReady) editor.trigger("menu", commands[action] || action);
			else { elements.fallback.focus(); document.execCommand(action); }
		};
		const actions = { new: newMacro, save: () => saveTab(currentTab()), rename: renameMacro, import: importMacro, export: exportMacro, delete: deleteMacro,
			undo: () => editAction("undo"), redo: () => editAction("redo"), cut: () => editAction("cut"),
			copy: () => editAction("copy"), paste: () => editAction("paste"), run: runMacro };
		void actions[button.dataset.action]?.();
	}));
	document.addEventListener("keydown", event => {
		if (event.key === "F8") { event.preventDefault(); if (!readOnly) void runMacro(); }
		if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); if (tabIsEditable()) void saveTab(currentTab()); }
		if (event.ctrlKey && event.key.toLowerCase() === "n") { event.preventDefault(); void newMacro(); }
	});
	elements.import.addEventListener("change", () => void handleImport());
	for (const button of document.querySelectorAll("[data-list]")) button.addEventListener("click", async () => {
		activeList = button.dataset.list;
		document.querySelectorAll("[data-list]").forEach(item => item.classList.toggle("is-active", item === button));
		if (activeList === "project" && macros.project.size === 0) await loadProjectMacros();
		renderList();
	});
}

function loadScript(source) {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = source;
		script.addEventListener("load", resolve, { once: true });
		script.addEventListener("error", () => reject(new Error(`Unable to load ${source}`)), { once: true });
		document.head.append(script);
	});
}

async function installEditor() {
	const fallback = () => {
		editorReady = false;
		elements.editor.hidden = true;
		elements.fallback.hidden = false;
		elements.fallback.addEventListener("input", markDirty);
		refreshReadOnlyState();
	};
	try {
		const nwRuntime = Boolean(globalThis.nw);
		if (nwRuntime && typeof window.require === "function" && typeof window.require.config !== "function") {
			window.nodeRequire = window.require;
			try { delete window.require; } catch { window.require = undefined; }
		}
		const vsBase = nwRuntime
			? new URL("node_modules/monaco-editor/min/vs", location.href).href.replace(/\/$/, "")
			: MONACO_CDN_BASE;
		if (!window.require?.config) await loadScript(`${vsBase}/loader.js`);
		if (!nwRuntime) {
			window.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
				`self.MonacoEnvironment={baseUrl:'${vsBase}/'};importScripts('${vsBase}/base/worker/workerMain.js');`)}` };
		}
		window.require.config({ paths: { vs: vsBase } });
		await new Promise((resolve, reject) => window.require(["vs/editor/editor.main"], resolve, reject));
		editor = window.monaco.editor.create(elements.editor, { value: "", language: "javascript", theme: globalThis.sviberTheme?.isDark() ? "vs-dark" : "vs", automaticLayout: true, minimap: { enabled: false } });
		editorReady = true;
		refreshReadOnlyState();
		elements.editor.hidden = false;
		elements.fallback.hidden = true;
		editor.onDidChangeModelContent(markDirty);
		if (activeKey) activateTab(activeKey);
	} catch (error) {
		fallback();
		appendConsole(`${t("error.monaco")} ${error?.message || error}`, "error");
	}
}

async function initializeProjectAccess() {
	if (!window.opener) return;
	const result = await request("sviber-macro-state-request");
	projectAvailable = Boolean(result.project);
	setReadOnlyState(result.readOnly);
	const projectTab = document.querySelector('[data-list="project"]');
	if (projectTab) {
		projectTab.disabled = !projectAvailable;
		projectTab.title = projectAvailable ? t("title.projectAvailable") : t("title.projectUnavailable");
	}
	if (projectAvailable) await loadProjectMacros();
	renderList();
}

window.addEventListener("message", event => {
	if (event.source === window.opener && event.data?.type === "sviber-macro-read-only") {
		setReadOnlyState(event.data.readOnly);
	}
});

applyLocale();
readGlobal();
installMenus();
void installEditor();
renderList();
void initializeProjectAccess();
window.opener?.postMessage({ type: "sviber-macro-ready" }, "*");
