// Drag-and-drop import of charts, music and background images onto the editor.

import { composeTraits } from "../core/mixin.js";

const MUSIC_TYPES = /^(audio\/|video\/ogg)/;
const IMAGE_TYPES = /^image\//;
const CHART_EXTENSIONS = /\.(json|ssc|txt)$/i;

function classifyFile(file) {
	const name = String(file?.name || "");
	const type = String(file?.type || "");
	if (IMAGE_TYPES.test(type) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name)) {
		return "image";
	}
	if (MUSIC_TYPES.test(type) || /\.(mp3|ogg|wav|flac|m4a|aac|opus)$/i.test(name)) {
		return "audio";
	}
	if (CHART_EXTENSIONS.test(name) || type === "application/json" || type === "application/zip") {
		return "chart";
	}
	return null;
}

function isExternalFileDrop(dataTransfer) {
	if (!dataTransfer) {
		return false;
	}
	const types = [...(dataTransfer.types || [])].map(type => String(type).toLowerCase());
	// Ignore in-page icon/image drags (often expose text/uri-list without Files).
	if (!types.includes("files")) {
		return false;
	}
	const files = [...(dataTransfer.files || [])];
	if (files.length > 0) {
		return true;
	}
	return [...(dataTransfer.items || [])].some(item => item.kind === "file");
}

class FileDropTrait {
	_bindFileDrop() {
		const root = document.getElementById("app") || document.body;
		// Status/tool/menu icons must not start a drag that would set the editor background.
		root.addEventListener(
			"dragstart",
			event => {
				if (event.target?.closest?.(".status-panel, .status-option, .tool-bar, .menu-bar, .menu-popup")) {
					event.preventDefault();
				}
			},
			true,
		);
		root.addEventListener("dragover", event => {
			if (isExternalFileDrop(event.dataTransfer)) {
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			}
		});
		root.addEventListener("drop", event => {
			if (!isExternalFileDrop(event.dataTransfer)) {
				return;
			}
			event.preventDefault();
			const files = [...(event.dataTransfer.files || [])];
			void this._handleDroppedFiles(files);
		});
	}

	async _handleDroppedFiles(files) {
		for (const file of files) {
			const kind = classifyFile(file);
			if (kind === "audio") {
				await this.loadMusic(file);
				continue;
			}
			if (kind === "image") {
				await this.loadBackground(file);
				continue;
			}
			if (kind === "chart") {
				await this.openFile(file, { offerAddToProject: true });
			}
		}
	}
}

export const withFileDrop = composeTraits("FileDropLayer", FileDropTrait);
export { classifyFile, isExternalFileDrop };
