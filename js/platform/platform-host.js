// Getting bytes out to whichever host sviber is running on.
//
// sviber runs both as an NW.js desktop app and as a plain web page, and the two have entirely
// different ways of naming and writing a file: NW.js exposes Node's `fs` plus `nwsaveas` and
// `nwdirectory` file inputs, while the browser has the File System Access API and, failing
// that, an anchor download. This module hides that difference behind a handful of functions;
// callers only ask `nwModules()` whether the desktop path is available.
//
// Split out of js/platform.js.

// The Node modules NW.js exposes, or null when running as an ordinary web page.
export function nwModules() {
	if (!globalThis.nw) {
		return null;
	}
	let candidate = null;
	if (typeof globalThis.nw.require === "function") {
		candidate = globalThis.nw.require.bind(globalThis.nw);
	} else if (typeof globalThis.require === "function") {
		candidate = globalThis.require;
	}
	if (!candidate) {
		return null;
	}
	try {
		return { fs: candidate("fs"), path: candidate("path") };
	} catch {
		return null;
	}
}

export function download(blob, filename) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function writeHandle(handle, blob) {
	const writable = await handle.createWritable();
	await writable.write(blob);
	await writable.close();
}

export async function writeLocalFile(filesystem, pathname, blob) {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	await filesystem.promises.writeFile(pathname, bytes);
}

// NW.js has no save dialog API, only a file input carrying `nwsaveas`/`nwdirectory`. Such an
// input reports its result either through `change` or, when the dialog is dismissed in a way
// that fires no event, through the window regaining focus, so both are watched and whichever
// settles first wins. Chromium reports a sandboxed `C:\fakepath\...` value when it refuses to
// disclose the real path, which counts as no selection.
function pickNwPath(configure) {
	if (!globalThis.document?.body) {
		return Promise.resolve(null);
	}
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.className = "visually-hidden";
		configure(input);
		let settled = false;
		const selectedPath = () => input.files?.[0]?.path || input.value || "";
		const finish = value => {
			if (settled) {
				return;
			}
			settled = true;
			window.removeEventListener("focus", onFocus);
			input.remove();
			resolve(value && !String(value).includes("fakepath") ? String(value) : null);
		};
		const onFocus = () => setTimeout(() => finish(selectedPath()), 250);
		input.addEventListener("change", () => finish(selectedPath()), { once: true });
		input.addEventListener("cancel", () => finish(null), { once: true });
		window.addEventListener("focus", onFocus, { once: true });
		document.body.append(input);
		input.click();
	});
}

export function pickNwSavePath(suggestedName, accept) {
	return pickNwPath(input => {
		input.accept = accept;
		input.setAttribute("nwsaveas", suggestedName);
	});
}

export function pickNwDirectoryPath() {
	return pickNwPath(input => input.setAttribute("nwdirectory", ""));
}

// Wraps raw bytes read from disk as a File, tagging it with the path it came from so the
// project writer can tell a file that is already in place from one that must be copied.
export function fileFromBytes(bytes, name, type, pathname = "") {
	let file;
	if (typeof File === "function") {
		file = new File([bytes], name, { type });
	} else {
		file = Object.assign(new Blob([bytes], { type }), { name });
	}
	if (pathname) {
		try {
			Object.defineProperty(file, "sviberPath", { value: pathname, configurable: true });
		} catch {
			file.sviberPath = pathname;
		}
	}
	return file;
}
