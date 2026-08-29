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

// The manual body lives in per-language JSON data (v21); content assertions read both
// languages at once so each assertion keeps matching against the combined text.
export async function readManual() {
	const [en, zh] = await Promise.all([
		readFile(new URL("../json/manual.en.json", import.meta.url), "utf8"),
		readFile(new URL("../json/manual.zh-CN.json", import.meta.url), "utf8"),
	]);
	// Return the parsed article HTML so content assertions see the same text the old
	// inline articles carried (no JSON quote escaping).
	return `${JSON.parse(en).article}
${JSON.parse(zh).article}`;
}
