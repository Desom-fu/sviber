const GLOBAL_KEY = "sviber.macros";
const MONACO_VERSION = "0.52.2";
const MONACO_CDN_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
const LANGUAGE = String(navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
const TEXT = Object.freeze({
	"en-US": {
		"page.title": "sviber Macros", "menu.aria": "Macros menu", "menu.file": "File", "menu.edit": "Edit", "menu.run": "Run",
		"menu.new": "New...", "menu.save": "Save", "menu.rename": "Rename...", "menu.import": "Import...", "menu.export": "Export...",
		"menu.undo": "Undo", "menu.redo": "Redo", "menu.cut": "Cut", "menu.copy": "Copy", "menu.paste": "Paste",
		"list.global": "Global", "list.project": "Project", "console.heading": "Console", "empty.none": "No macros",
		"empty.projectBrowser": "Project macros require NW.js.", "form.newTitle": "New macro", "form.renameTitle": "Rename macro",
		"form.importTitle": "Import macro", "form.name": "Name", "form.scope": "Macro scope", "form.cancel": "Cancel", "form.ok": "OK",
		"error.emptyName": "Macro name cannot be empty.", "error.reservedName": "Macro names cannot contain filesystem-reserved characters.",
		"error.duplicateName": "Macro names must be unique.", "error.projectUnavailable": "Project macros are available only in NW.js.",
		"error.saveProject": "Unable to save the project macro.", "error.createProject": "Unable to create the project macro.",
		"error.importProject": "Unable to import the project macro.", "error.renameProject": "Unable to rename the project macro.",
		"error.noMacro": "Open a macro first.", "error.noState": "The sviber window did not return chart state.",
		"error.noOpener": "Open the macro window from sviber before running a macro.", "error.export": "Unable to export the macro.", "error.globalStore": "Unable to write global macros to localStorage.",
		"title.projectAvailable": "Project macros", "title.projectUnavailable": "Project macros require NW.js.",
		"error.monaco": "Monaco unavailable; using the plain-text editor.", "message.applied": "Macro applied as one undoable action.",
		"message.timeout": "Macro execution timed out.", "message.discard": "Discard unsaved changes to {name}?", "message.exported": "Macro exported."
	},
	"zh-CN": {
		"page.title": "sviber 宏", "menu.aria": "宏菜单", "menu.file": "文件", "menu.edit": "编辑", "menu.run": "运行",
		"menu.new": "新建...", "menu.save": "保存", "menu.rename": "重命名...", "menu.import": "导入...", "menu.export": "导出...",
		"menu.undo": "撤销", "menu.redo": "重做", "menu.cut": "剪切", "menu.copy": "复制", "menu.paste": "粘贴",
		"list.global": "全局", "list.project": "项目", "console.heading": "控制台", "empty.none": "没有宏",
		"empty.projectBrowser": "项目宏仅在 NW.js 中可用。", "form.newTitle": "新建宏", "form.renameTitle": "重命名宏",
		"form.importTitle": "导入宏", "form.name": "名称", "form.scope": "宏范围", "form.cancel": "取消", "form.ok": "确定",
		"error.emptyName": "宏名称不能为空。", "error.reservedName": "宏名称不能包含文件系统保留字符。",
		"error.duplicateName": "宏名称不能重复。", "error.projectUnavailable": "项目宏仅在 NW.js 中可用。",
		"error.saveProject": "无法保存项目宏。", "error.createProject": "无法创建项目宏。",
		"error.importProject": "无法导入项目宏。", "error.renameProject": "无法重命名项目宏。",
		"error.noMacro": "请先打开一个宏。", "error.noState": "sviber 窗口没有返回谱面状态。",
		"error.noOpener": "请从 sviber 打开宏窗口后再运行宏。", "error.export": "无法导出宏。", "error.globalStore": "无法写入 localStorage 中的全局宏。",
		"title.projectAvailable": "项目宏", "title.projectUnavailable": "项目宏仅在 NW.js 中可用。",
		"error.monaco": "Monaco 不可用，已切换到纯文本编辑器。", "message.applied": "宏已作为一个可撤销操作应用。",
		"message.timeout": "宏运行超时。", "message.discard": "放弃对“{name}”的未保存修改吗？", "message.exported": "宏已导出。"
	}
});
const t = key => TEXT[LANGUAGE][key] ?? TEXT["en-US"][key] ?? key;
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
		for (const [name, content] of Object.entries(value)) macros.global.set(name, { name, type: "global", content: String(content) });
	} catch { /* A damaged macro store is treated as empty. */ }
}

function writeGlobal() {
	const value = Object.fromEntries([...macros.global].map(([name, macro]) => [name, macro.content]));
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

function macroFilename(name) {
	const value = String(name || "").trim();
	if (!value || /[<>:"/\\|?*\u0000-\u001f]/.test(value) || value === "." || value === "..") return null;
	return `${value.replace(/\.js$/i, "")}.js`;
}

function macroName(name) {
	return String(name || "").trim().replace(/\.js$/i, "");
}

function macroKey(macro) { return `${macro.type}:${macro.name}`; }

function validateMacroName(name, collection) {
	const clean = macroName(name);
	if (!clean) return t("error.emptyName");
	if (!macroFilename(clean)) return t("error.reservedName");
	if (collection && hasMacroName(collection, clean)) return t("error.duplicateName");
	return "";
}

function showMacroForm({ titleKey, initialName = "", includeScope = true, scope = "global", validate } = {}) {
	if (!elements.dialog || !elements.form) return Promise.resolve(null);
	return new Promise(resolve => {
		let settled = false;
		const projectRadio = elements.form.querySelector('input[name="macro-scope"][value="project"]');
		const globalRadio = elements.form.querySelector('input[name="macro-scope"][value="global"]');
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
			const selectedScope = includeScope && projectAvailable && projectRadio?.checked ? "project" : "global";
			const error = validate?.(name, selectedScope) || "";
			if (error) {
				elements.formError.textContent = error;
				elements.formError.hidden = false;
				elements.formName.focus();
				return;
			}
			finish({ name, type: selectedScope });
		};
		elements.formTitle.textContent = t(titleKey);
		elements.formName.value = initialName;
		elements.formError.hidden = true;
		elements.formError.textContent = "";
		elements.formScope.hidden = !includeScope;
		if (projectRadio) projectRadio.disabled = !projectAvailable || !includeScope;
		if (globalRadio) globalRadio.checked = !includeScope || scope !== "project" || !projectAvailable;
		if (projectRadio) projectRadio.checked = includeScope && scope === "project" && projectAvailable;
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

function getEditorValue() {
	return editorReady ? editor.getValue() : elements.fallback.value;
}

function setEditorValue(value) {
	if (editorReady) editor.setValue(String(value));
	else elements.fallback.value = String(value);
}

function markDirty() {
	const tab = currentTab();
	if (!tab || tab.loading) return;
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
	if (editorReady) editor.layout();
	queueMicrotask(() => { tab.loading = false; });
	renderTabs();
	renderList();
}

function openMacro(macro) {
	const key = macroKey(macro);
	if (!openTabs.has(key)) openTabs.set(key, { macro, dirty: false, loading: false });
	activateTab(key);
}

function closeTab(key) {
	const tab = openTabs.get(key);
	if (!tab) return;
	if (tab.dirty && !window.confirm(interpolate("message.discard", { name: tab.macro.name }))) return;
	openTabs.delete(key);
	if (activeKey === key) {
		activeKey = openTabs.keys().next().value || null;
		if (activeKey) activateTab(activeKey);
		else { setEditorValue(""); renderTabs(); }
	}
	renderList();
}

async function loadProjectMacros() {
	if (!projectAvailable || projectMacrosLoaded) return;
	projectMacrosLoaded = true;
	const result = await request("sviber-macro-project-list");
	for (const filename of result.files || []) {
		const name = String(filename).replace(/\.js$/i, "");
		if (!name || hasMacroName(macros.project, name)) continue;
		const content = await request("sviber-macro-project-read", { filename });
		if (content.text != null) macros.project.set(name, { name, type: "project", filename, content: content.text });
	}
	renderList();
}

async function saveTab(tab) {
	if (!tab) return false;
	tab.macro.content = getEditorValue();
	if (tab.macro.type === "global") writeGlobal();
	else {
		if (!projectAvailable) { appendConsole(t("error.projectUnavailable"), "error"); return false; }
		const result = await request("sviber-macro-project-write", { filename: tab.macro.filename || `${tab.macro.name}.js`, text: tab.macro.content });
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
		validate: (name, type) => validateMacroName(name, macros[type]),
	});
	if (!values) return;
	const { name: clean, type } = values;
	const filename = macroFilename(clean);
	const macro = { name: clean, type, filename, content: "// sviber macro\nconsole.log('hello');\n" };
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
	const values = await showMacroForm({
		titleKey: "form.renameTitle", initialName: tab.macro.name, includeScope: false,
		validate: name => name === tab.macro.name ? "" : validateMacroName(name, macros[tab.macro.type]),
	});
	if (!values || values.name === tab.macro.name) return;
	const name = values.name;
	const filename = macroFilename(name);
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
	const values = await showMacroForm({
		titleKey: "form.importTitle", initialName: uniqueName(file.name.replace(/\.js$/i, ""), activeList), includeScope: true,
		validate: (name, type) => validateMacroName(name, macros[type]),
	});
	if (!values) return;
	const { name, type } = values;
	const filename = macroFilename(name);
	const macro = { name, type, filename, content: await file.text() };
	if (type === "project") {
		const result = await request("sviber-macro-project-write", { filename, text: macro.content });
		if (!result.ok) { appendConsole(t("error.importProject"), "error"); return; }
	}
	macros[type].set(name, macro);
	if (type === "global") writeGlobal();
	openMacro(macro);
}

function chooseNwSavePath(suggestedName) {
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".js,text/javascript";
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
	if (globalThis.nw) {
		try {
			const pathname = await chooseNwSavePath(`${tab.macro.name}.js`);
			if (!pathname) return;
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
				suggestedName: `${tab.macro.name}.js`,
				types: [{ description: "JavaScript macro", accept: { "text/javascript": [".js"] } }],
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
	const blob = new Blob([content], { type: "text/javascript" });
	const anchor = document.createElement("a");
	anchor.href = URL.createObjectURL(blob);
	anchor.download = `${tab.macro.name}.js`;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
	appendConsole(t("message.exported"));
}

function sandboxSource() {
	return `<!doctype html><script>
window.addEventListener('message', async messageEvent => {
  if (messageEvent.data?.type !== 'run') return;
  const clone = value => JSON.parse(JSON.stringify(value));
  const state = clone(messageEvent.data.state);
  const output = (kind, values) => parent.postMessage({type:'log', kind, values: values.map(value => { try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return String(value); } })}, '*');
  const log = (...values) => output('log', values);
  const error = (...values) => output('error', values);
  const consoleProxy = { log, info: log, warn: log, error };
  window.console = consoleProxy;
  const nextId = key => { const values = (state[key] || []).map(item => Number(item.id)).filter(Number.isSafeInteger); return values.length ? Math.max(...values) + 1 : 0; };
  const event = (type, overrides = {}) => { const item = { id: nextId('events'), type, channel: state.editor.currentChannel, time: clone(state.editor.currentTime), selected: true, ...overrides }; state.events.push(item); return item; };
  const channel = (name = 'Channel') => { const item = { id: nextId('channels'), name: String(name), active: true }; state.channels.push(item); return item; };
  const snappee = (type, overrides = {}) => { const item = { id: nextId('snappees'), type, name: type, active: true, ...overrides }; state.snappees.push(item); return item; };
  const select = (...ids) => { const chosen = new Set(ids.flat()); for (const item of state.events) item.selected = chosen.has(item.id); return state.events.filter(item => item.selected); };
  const setTime = value => { state.editor.timeSnapped = Array.isArray(value); state.editor.currentTime = clone(value); return state.editor.currentTime; };
  const api = { state, chart: state, event, tap: (o={}) => event('tap', o), t: (o={}) => event('tap', o), hold: (o={}) => event('hold', o), h: (o={}) => event('hold', o), drag: (o={}) => event('drag', o), d: (o={}) => event('drag', o), flick: (o={}) => event('flick', o), f: (o={}) => event('flick', o), bgNote: (o={}) => event('bgNote', o), channel, addChannel: channel, snappee, addSnappee: snappee, select, setTime, log, console: consoleProxy };
  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const helpers = Object.fromEntries(Object.entries(api).filter(([key]) => key !== 'state' && key !== 'console'));
    const names = Object.keys(helpers);
    const result = await (new AsyncFunction('api', 'state', 'console', ...names, messageEvent.data.code))(
      api, state, consoleProxy, ...names.map(name => helpers[name]));
    const returned = result && typeof result === 'object' ? (result.state && typeof result.state === 'object' ? result.state : result) : state;
    parent.postMessage({type:'result', state: returned}, '*');
  } catch (exception) { parent.postMessage({type:'error', message: String(exception?.stack || exception)}, '*'); }
});
<\/script>`;
}

async function runMacro() {
	const tab = currentTab();
	if (!tab) { appendConsole(t("error.noMacro"), "error"); return; }
	tab.macro.content = getEditorValue();
	const stateResult = await request("sviber-macro-state-request");
	if (!stateResult.state) {
		appendConsole(window.opener ? t("error.noState") : t("error.noOpener"), "error");
		return;
	}
	const frame = document.createElement("iframe");
	frame.sandbox.add("allow-scripts");
	frame.srcdoc = sandboxSource();
	frame.hidden = true;
	document.body.append(frame);
	const result = await new Promise(resolve => {
		const listener = event => {
			if (event.source !== frame.contentWindow) return;
			if (event.data?.type === "log") appendConsole(event.data.values.join(" "), event.data.kind);
			if (event.data?.type === "result" || event.data?.type === "error") {
				window.removeEventListener("message", listener);
				resolve(event.data);
			}
		};
		window.addEventListener("message", listener);
		frame.addEventListener("load", () => frame.contentWindow.postMessage({ type: "run", code: tab.macro.content, state: stateResult.state }, "*"), { once: true });
		setTimeout(() => { window.removeEventListener("message", listener); resolve({ type: "error", message: t("message.timeout") }); }, 30_000);
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
		const actions = { new: newMacro, save: () => saveTab(currentTab()), rename: renameMacro, import: importMacro, export: exportMacro,
			undo: () => editAction("undo"), redo: () => editAction("redo"), cut: () => editAction("cut"),
			copy: () => editAction("copy"), paste: () => editAction("paste"), run: runMacro };
		void actions[button.dataset.action]?.();
	}));
	document.addEventListener("keydown", event => {
		if (event.key === "F8") { event.preventDefault(); void runMacro(); }
		if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); void saveTab(currentTab()); }
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
	const fallback = () => { editorReady = false; elements.editor.hidden = true; elements.fallback.hidden = false; elements.fallback.addEventListener("input", markDirty); };
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
	const projectTab = document.querySelector('[data-list="project"]');
	if (projectTab) {
		projectTab.disabled = !projectAvailable;
		projectTab.title = projectAvailable ? t("title.projectAvailable") : t("title.projectUnavailable");
	}
	if (projectAvailable) await loadProjectMacros();
	renderList();
}

applyLocale();
readGlobal();
installMenus();
void installEditor();
renderList();
void initializeProjectAccess();
window.opener?.postMessage({ type: "sviber-macro-ready" }, "*");
