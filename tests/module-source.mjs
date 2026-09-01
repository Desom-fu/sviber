import { readFile } from "node:fs/promises";

// Several layers of the editor are assembled from trait modules that are composed into one
// class. Source level assertions therefore concatenate a family of modules, so that they keep
// describing the behaviour of the layer as a whole no matter which module a particular method
// currently lives in.

export const STAGE_INTERACTION_MODULES = [
	"../js/render/stage-interactions.js",
	"../js/render/stage-hud.js",
	"../js/render/stage-pointer.js",
	"../js/render/stage-transform-drag.js",
];

export const STAGE_NOTE_MODULES = [
	"../js/render/stage-notes.js",
	"../js/render/stage-overlays.js",
	"../js/render/stage-drafts.js",
	"../js/render/note-painting.js",
];

export const TIMELINE_MODULES = [
	"../js/render/timeline.js",
	"../js/render/timeline-drawing.js",
	"../js/render/timeline-pointer.js",
];

export const EVENT_EDITING_MODULES = [
	"../js/app/app-event-editing.js",
	"../js/app/app-view-callbacks.js",
	"../js/app/app-selection.js",
	"../js/app/app-selection-preview.js",
	"../js/app/app-stage-move-exception.js",
	"../js/app/app-timeline-navigation.js",
	"../js/app/app-event-move.js",
	"../js/app/app-position-move.js",
	"../js/app/app-group-anchor-move.js",
	"../js/app/app-tip-spawn-move.js",
	"../js/app/app-snappee-drag.js",
	"../js/app/app-transform-targets.js",
	"../js/app/app-selection-transform.js",
	"../js/app/app-property-editing.js",
	"../js/app/app-tip-point-modes.js",
];

export async function readSources(modules) {
	const sources = await Promise.all(modules.map(name => readFile(new URL(name, import.meta.url), "utf8")));
	return sources.join("\n");
}

// The manual body lives in one HTML fragment per supported language so content assertions
// can read the same resources that the documentation page injects.
export function manualArticle(manual) {
	let article;
	if (typeof manual === "string") {
		article = manual;
	} else if (Array.isArray(manual.article)) {
		article = manual.article.join("");
	} else {
		article = manual.article;
	}
	return article
		.replace(/<!---->\r?\n/g, "")
		.replace(/\r?\n$/, "");
}

// Content assertions read all supported languages at once.
export async function readManual() {
	const [en, zh, zhTw, ja] = await Promise.all([
		readFile(new URL("../docs/manual.en-US.html", import.meta.url), "utf8"),
		readFile(new URL("../docs/manual.zh-CN.html", import.meta.url), "utf8"),
		readFile(new URL("../docs/manual.zh-TW.html", import.meta.url), "utf8"),
		readFile(new URL("../docs/manual.ja-JP.html", import.meta.url), "utf8"),
	]);
	return [en, zh, zhTw, ja].map(manualArticle).join("\n");
}
