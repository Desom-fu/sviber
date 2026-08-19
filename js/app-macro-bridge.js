import { i18n } from "./i18n.js";
import { ChartModel } from "./core/chart-model.js";
import { deepClone } from "./app-helpers.js";

function reply(source, message) {
	try { source?.postMessage(message, "*"); } catch { /* The popup may have closed. */ }
}

async function projectFileMessage(app, source, message) {
	if (message.type === "sviber-macro-project-list") {
		let files = [];
		try {
			files = [
				...await app.files.listProjectFiles(".js"),
				...await app.files.listProjectFiles(".rb"),
			].sort((left, right) => left.localeCompare(right));
		} catch { files = []; }
		reply(source, { type: "sviber-macro-project-list-result", requestId: message.requestId, files });
		return true;
	}
	if (message.type === "sviber-macro-project-read") {
		let text = null;
		try { text = await app.files.readProjectText(String(message.filename || "")); } catch { /* Missing and unsafe files return null. */ }
		reply(source, { type: "sviber-macro-project-read-result", requestId: message.requestId, text });
		return true;
	}
	if (message.type === "sviber-macro-project-write") {
		let ok = false;
		try {
			await app.files.writeProjectText(String(message.filename || ""), String(message.text || ""));
			ok = true;
		} catch { /* Browser and unsafe paths are rejected. */ }
		reply(source, { type: "sviber-macro-project-write-result", requestId: message.requestId, ok });
		return true;
	}
	const operations = {
		"sviber-macro-project-rename": async () => app.files.renameProjectText(
			String(message.oldFilename || ""), String(message.newFilename || ""),
		),
		"sviber-macro-project-delete": async () => app.files.removeProjectText(String(message.filename || "")),
	};
	if (!operations[message.type]) return false;
	let ok = false;
	let error = "";
	try { await operations[message.type](); ok = true; }
	catch (exception) { error = String(exception?.message || exception); }
	reply(source, { type: `${message.type}-result`, requestId: message.requestId, ok, error });
	return true;
}

function applyMacroState(app, source, message) {
	try {
		const encoded = JSON.stringify(message.state);
		if (encoded.length > 20_000_000) throw new Error("Macro state is too large.");
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
		app.updateDirty();
		app.refresh();
		reply(source, { type: "sviber-macro-apply-result", requestId: message.requestId, ok: true });
	} catch (error) {
		reply(source, {
			type: "sviber-macro-apply-result", requestId: message.requestId,
			ok: false, error: String(error?.message || error),
		});
	}
}

export async function handleMacroMessage(app, event) {
	const message = event.data;
	if (!message || typeof message !== "object" || !String(message.type || "").startsWith("sviber-macro-")) return;
	if (app.macroWindow && event.source !== app.macroWindow) return;
	if (message.type === "sviber-macro-state-request") {
		reply(event.source, {
			type: "sviber-macro-state", requestId: message.requestId,
			state: deepClone(app.model.snapshot()),
			project: Boolean(globalThis.nw && app.files.projectPath),
		});
		return;
	}
	if (await projectFileMessage(app, event.source, message)) return;
	if (message.type === "sviber-macro-apply" && message.state) applyMacroState(app, event.source, message);
}
