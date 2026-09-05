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

class FileDropTrait {
	_bindFileDrop() {
		const root = document.getElementById("app") || document.body;
		root.addEventListener("dragover", event => {
			if ([...event.dataTransfer.files].length || [...event.dataTransfer.items].length) {
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			}
		});
		root.addEventListener("drop", event => {
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
export { classifyFile };
