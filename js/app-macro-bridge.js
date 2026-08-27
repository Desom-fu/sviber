import { i18n } from "./i18n.js";
import { ChartModel } from "./core/chart-model.js";
import { deepClone } from "./app-helpers.js";

function reply(source, message) {
	try {
		source?.postMessage(message, "*");
	} catch {
		/* The popup may have closed. */
	}
}

async function projectFileMessage(app, source, message) {
	if (message.type === "sviber-macro-project-list") {
		let files = [];
		try {
			files = [...(await app.files.listProjectFiles(".js")), ...(await app.files.listProjectFiles(".rb"))].sort(
				(left, right) => left.localeCompare(right),
			);
		} catch {
			files = [];
		}
		reply(source, { type: "sviber-macro-project-list-result", requestId: message.requestId, files });
		return true;
	}
	if (message.type === "sviber-macro-project-read") {
		let text = null;
		try {
			text = await app.files.readProjectText(String(message.filename || ""));
		} catch {
			/* Missing and unsafe files return null. */
		}
		reply(source, { type: "sviber-macro-project-read-result", requestId: message.requestId, text });
		return true;
	}
	if (message.type === "sviber-macro-project-write") {
		let ok = false;
		try {
			if (app.model.editor.readOnly) {
				throw new Error("The chart is read-only.");
			}
			await app.files.writeProjectText(String(message.filename || ""), String(message.text || ""));
			ok = true;
		} catch {
			/* Browser and unsafe paths are rejected. */
		}
		reply(source, { type: "sviber-macro-project-write-result", requestId: message.requestId, ok });
		return true;
	}
	const operations = {
		"sviber-macro-project-rename": async () =>
			app.files.renameProjectText(String(message.oldFilename || ""), String(message.newFilename || "")),
		"sviber-macro-project-delete": async () => app.files.removeProjectText(String(message.filename || "")),
	};
	if (!operations[message.type]) {
		return false;
	}
	let ok = false;
	let error = "";
	try {
		if (app.model.editor.readOnly) {
			throw new Error("The chart is read-only.");
		}
		await operations[message.type]();
		ok = true;
	} catch (exception) {
		error = String(exception?.message || exception);
	}
	reply(source, { type: `${message.type}-result`, requestId: message.requestId, ok, error });
	return true;
}

function applyMacroState(app, source, message) {
	try {
		if (app.model.editor.readOnly) {
			throw new Error("The chart is read-only.");
		}
		const encoded = JSON.stringify(message.state);
		if (encoded.length > 20_000_000) {
			throw new Error("Macro state is too large.");
		}
		const next = new ChartModel(message.state);
		if (next.events.length > 500_000 || next.snappees.length > 50_000 || next.channels.length > 10_000) {
			throw new Error("Macro state exceeds the editor limits.");
		}
		app.commit(i18n.t("history.runMacro"), model => model.restore(next.snapshot()));
		app.projectTitle = next.metadata.title;
		app.projectArtist = next.metadata.artist;
		app.projectMusic = next.music;
		app.projectImage = next.image;
		app.syncProjectSharedFields();
		reply(source, { type: "sviber-macro-apply-result", requestId: message.requestId, ok: true });
	} catch (error) {
		reply(source, {
			type: "sviber-macro-apply-result",
			requestId: message.requestId,
			ok: false,
			error: String(error?.message || error),
		});
	}
}

const GLOBAL_MACRO_KEY = "sviber.macros";

function readGlobalMacros() {
	try {
		const value = JSON.parse(localStorage.getItem(GLOBAL_MACRO_KEY) || "{}");
		return Object.entries(value).flatMap(([name, stored]) => {
			const content = stored && typeof stored === "object" ? stored.content : stored;
			if (!name) {
				return [];
			}
			return [
				{
					id: `global:${name}`,
					scope: "global",
					name,
					label: name,
					language:
						stored && typeof stored === "object" && stored.language === "ruby" ? "ruby" : "javascript",
					content: String(content ?? ""),
				},
			];
		});
	} catch {
		return [];
	}
}

export async function listRunnableMacros(app) {
	const global = readGlobalMacros();
	const project = [];
	if (globalThis.nw && app.files?.projectPath) {
		try {
			const files = [
				...(await app.files.listProjectFiles(".js")),
				...(await app.files.listProjectFiles(".rb")),
			].sort((left, right) => left.localeCompare(right));
			for (const filename of files) {
				project.push({
					id: `project:${filename}`,
					scope: "project",
					name: filename.replace(/\.(js|rb)$/i, ""),
					label: filename,
					filename,
					language: /\.rb$/i.test(filename) ? "ruby" : "javascript",
				});
			}
		} catch {
			/* Browser and missing project folders yield no project macros. */
		}
	}
	return { global, project };
}

async function loadRubyResources() {
	const localFirst =
		Boolean(globalThis.nw) ||
		location.protocol === "file:" ||
		/^(?:localhost|127\.0\.0\.1)$/.test(location.hostname);
	const wasmSources = localFirst? [
				"node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm",
				"https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.7.2/dist/ruby+stdlib.wasm",
			]: [
				"https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.7.2/dist/ruby+stdlib.wasm",
				"node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm",
			];
	let failure;
	const fetchWasm = async () => {
		for (const source of wasmSources) {
			try {
				const response = await fetch(new URL(source, location.href));
				if (!response.ok) {
					throw new Error(`ruby.wasm HTTP ${response.status}`);
				}
				return await response.arrayBuffer();
			} catch (error) {
				failure = error;
			}
		}
		throw failure || new Error("ruby.wasm is unavailable.");
	};
	const rubyResponse = await fetch(new URL("js/macro-api.rb", location.href));
	if (!rubyResponse.ok) {
		throw new Error(`Ruby API HTTP ${rubyResponse.status}`);
	}
	return { rubyApi: await rubyResponse.text(), rubyBytes: await fetchWasm() };
}

export async function runChosenMacro(app, macroId) {
	if (app.model.editor.readOnly) {
		throw new Error("The chart is read-only.");
	}
	const lists = await listRunnableMacros(app);
	const chosen = [...lists.global, ...lists.project].find(item => item.id === macroId);
	if (!chosen) {
		throw new Error("The selected macro is unavailable.");
	}
	let content = chosen.content;
	if (chosen.scope === "project") {
		content = await app.files.readProjectText(chosen.filename);
		if (content == null) {
			throw new Error("The project macro could not be read.");
		}
	}
	let rubyResources = {};
	if (chosen.language === "ruby") {
		rubyResources = await loadRubyResources();
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
			if (event.source !== frame.contentWindow) {
				return;
			}
			if (event.data?.type === "result" || event.data?.type === "error") {
				finish(event.data);
			}
		};
		window.addEventListener("message", listener);
		frame.addEventListener(
			"load",
			() =>
				frame.contentWindow.postMessage(
					{
						type: "run",
						code: content,
						state: deepClone(app.model.snapshot()),
						language: chosen.language,
						...rubyResources,
					},
					"*",
				),
			{ once: true },
		);
		frame.src = new URL("macro-sandbox.html", location.href).href;
		document.body.append(frame);
		timer = setTimeout(() => finish({ type: "error", message: "The macro timed out." }), 60_000);
	});
	frame.remove();
	if (result.type === "error" || !result.state) {
		throw new Error(result.message || "The macro failed.");
	}
	const next = new ChartModel(result.state);
	if (next.events.length > 500_000 || next.snappees.length > 50_000 || next.channels.length > 10_000) {
		throw new Error("Macro state exceeds the editor limits.");
	}
	app.commit(i18n.t("history.runMacro"), model => model.restore(next.snapshot()));
	app.projectTitle = next.metadata.title;
	app.projectArtist = next.metadata.artist;
	app.projectMusic = next.music;
	app.projectImage = next.image;
	app.syncProjectSharedFields();
	app.toast?.show("toast.macroRan");
}

export async function handleMacroMessage(app, event) {
	const message = event.data;
	if (!message || typeof message !== "object" || !String(message.type || "").startsWith("sviber-macro-")) {
		return;
	}
	if (app.macroWindow && event.source !== app.macroWindow) {
		return;
	}
	if (message.type === "sviber-macro-state-request") {
		reply(event.source, {
			type: "sviber-macro-state",
			requestId: message.requestId,
			state: deepClone(app.model.snapshot()),
			project: Boolean(globalThis.nw && app.files.projectPath),
			readOnly: Boolean(app.model.editor.readOnly),
		});
		return;
	}
	if (await projectFileMessage(app, event.source, message)) {
		return;
	}
	if (message.type === "sviber-macro-apply" && message.state) {
		applyMacroState(app, event.source, message);
	}
}
