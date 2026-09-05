import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { rememberNwWindow } from "../platform/window-bounds.js";
import { needsDisplayTextFile } from "../platform/platform-file-kinds.js";

function reply(source, message) {
	try {
		source?.postMessage(message, "*");
	} catch {
		/* The popup may have closed. */
	}
}

export async function handleReadmeMessage(app, event) {
	const message = event.data;
	if (!message || typeof message !== "object" || !String(message.type || "").startsWith("sviber-readme-")) {
		return;
	}
	if (message.type === "sviber-readme-list") {
		let files = [];
		try {
			files = await app.files.listReadmeFiles();
		} catch {
			files = [];
		}
		reply(event.source, { type: "sviber-readme-list-result", requestId: message.requestId, files });
		return;
	}
	if (message.type === "sviber-readme-read") {
		let text = null;
		try {
			text = await app.files.readProjectText(String(message.filename || ""));
		} catch {
			text = null;
		}
		reply(event.source, { type: "sviber-readme-read-result", requestId: message.requestId, text });
		return;
	}
	if (message.type === "sviber-readme-write") {
		let ok = false;
		try {
			const name = String(message.filename || "");
			if (!needsDisplayTextFile(name)) {
				throw new Error("The filename is not a display text file.");
			}
			await app.files.writeProjectText(name, String(message.text || ""));
			ok = true;
		} catch {
			ok = false;
		}
		reply(event.source, { type: "sviber-readme-write-result", requestId: message.requestId, ok });
	}
}

const FALLBACK = { width: 1180, height: 820, min_width: 760, min_height: 520 };

class ReadmeEditorTrait {
	openReadmeEditor() {
		if (!globalThis.nw || !this.files.projectPath) {
			this.toast?.show("toast.readmeNeedsProject");
			return;
		}
		const urlObject = new URL("readme.html", location.href);
		urlObject.searchParams.set("lang", i18n.language);
		const url = urlObject.href;
		if (this.readmeWindow && !this.readmeWindow.closed) {
			this.readmeWindow.focus();
			return;
		}
		if (globalThis.nw?.Window?.open) {
			globalThis.nw.Window.open(
				url,
				{
					title: "sviber Readme",
					...FALLBACK,
				},
				popup => {
					this.readmeWindow = popup?.window || popup || null;
					rememberNwWindow("readme", popup, FALLBACK);
				},
			);
			return;
		}
		this.readmeWindow = window.open(url, "sviber-readme", "popup,width=1180,height=820");
	}
}

export const withReadmeEditor = composeTraits("ReadmeEditorLayer", ReadmeEditorTrait);
