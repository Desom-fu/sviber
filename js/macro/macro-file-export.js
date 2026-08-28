// Saving a macro's text to a file the user picks.
//
// The macros window runs in three environments, each with a different way of asking for a
// destination: NW.js has only an `nwsaveas` file input, a modern browser has the File System
// Access API, and anything else falls back to an anchor download. The caller only needs to know
// whether the file was written, so all three paths report the same result.
//
// Split out of js/macros.js.

// NW.js reports a chosen save path either through `change` or, when the dialog closes without
// firing one, through the window regaining focus, so both are watched. A sandboxed
// `C:\fakepath\...` value means the real path was withheld and counts as no selection.
function chooseNwSavePath(suggestedName, accept) {
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.className = "visually-hidden";
		input.setAttribute("nwsaveas", suggestedName);
		let settled = false;
		const finish = value => {
			if (settled) {
				return;
			}
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

async function writeThroughNw(content, { filename, extension, mime }) {
	let pathname = await chooseNwSavePath(filename, `${extension},${mime}`);
	if (!pathname) {
		return { saved: false };
	}
	if (!pathname.toLowerCase().endsWith(extension)) {
		pathname += extension;
	}
	const nodeRequire = window.nodeRequire || globalThis.nw.require;
	const filesystem = nodeRequire?.("fs");
	if (!filesystem) {
		throw new Error("fs unavailable");
	}
	await filesystem.promises.writeFile(pathname, content, "utf8");
	return { saved: true };
}

async function writeThroughFilePicker(content, { filename, extension, mime, description }) {
	const handle = await globalThis.showSaveFilePicker({
		suggestedName: filename,
		types: [{ description, accept: { [mime]: [extension] } }],
	});
	const writable = await handle.createWritable();
	await writable.write(content);
	await writable.close();
	return { saved: true };
}

function writeThroughDownload(content, { filename, mime }) {
	const blob = new Blob([content], { type: mime });
	const anchor = document.createElement("a");
	anchor.href = URL.createObjectURL(blob);
	anchor.download = filename;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
	return { saved: true };
}

// Returns `{ saved }` plus, when something went wrong that the user should hear about,
// `{ error }`. A cancelled picker is neither saved nor an error.
export async function saveMacroFile(content, target) {
	if (globalThis.nw) {
		try {
			return await writeThroughNw(content, target);
		} catch (error) {
			return { saved: false, error };
		}
	}
	if (typeof globalThis.showSaveFilePicker === "function") {
		try {
			return await writeThroughFilePicker(content, target);
		} catch (error) {
			return { saved: false, error: error?.name === "AbortError" ? null : error };
		}
	}
	return writeThroughDownload(content, target);
}
