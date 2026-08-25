import { i18n } from "./i18n.js";
import { walkEvents } from "./core/grouping.js";
import { CommandRegistry } from "./commands.js";
import { DialogManager, MenuBar, ToastManager, Toolbar, TooltipManager } from "./ui.js";
import { ChartModel, DIFFICULTY_COLORS, EVENT_TYPES, connectSelectedTipPointChain, createEvent } from "./core/chart-model.js";
import { History } from "./core/history.js";
import { Rational } from "./core/rational.js";
import { TimingMap } from "./core/timing.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, isPointWithinChartBounds, multiplyTransforms, penCommandsFromNodes, resolveAttachedPosition, sampleSnappee, transformAngle } from "./core/geometry.js";
import { AudioPlayer } from "./audio/player.js";
import { collectHitSchedule, collectHoldReleaseSchedule } from "./audio/scheduler.js";
import { TimelineView } from "./render/timeline.js";
import { StageView } from "./render/stage.js";
import { AutosaveManager, FileManager } from "./platform.js";
import { HistoryPanel, InspectorPanel, SnappeesPanel } from "./panels.js";

export const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote", "group"]);
export const DURATION_TYPES = new Set(["hold", "bgNote", "bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram", "comment"]);
export const PATTERN_TYPES = new Set(["bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"]);
export const SNAPPEE_COLORS = ["#00e0ad", "#3086ff", "#ff9d3d", "#d567ff", "#ff2e59", "#50a226"];
export const PREFERENCES_KEY = "sviber.preferences";
export const LAST_CHARTER_KEY = "sviber.lastCharter";
export const LAST_OPEN_KEY = "sviber.lastOpen";
export const RECENT_OPEN_KEY = "sviber.recentOpen";
export const DEFAULT_PREFERENCES = Object.freeze({
	theme: "system", language: "system", noteSpeed: 2,
	seVolume: 1, musicVolume: 1, autoSaveInterval: 120,
	liveHostingAddress: "0.0.0.0:8011", liveReloadPort: 31108,
});

function preferenceChoice(value, choices, fallback) {
	return choices.includes(value) ? value : fallback;
}

function normalizePreferences(source = {}) {
	const noteSpeed = Number(source.noteSpeed);
	const finiteNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
	const autoSaveInterval = Number(source.autoSaveInterval);
	return {
		theme: preferenceChoice(source.theme, ["system", "light", "dark"], DEFAULT_PREFERENCES.theme),
		language: preferenceChoice(source.language, ["system", "en-US", "zh-CN"], DEFAULT_PREFERENCES.language),
		noteSpeed: noteSpeed > 0 ? noteSpeed : DEFAULT_PREFERENCES.noteSpeed,
		seVolume: finiteNumber(source.seVolume, DEFAULT_PREFERENCES.seVolume),
		musicVolume: finiteNumber(source.musicVolume, DEFAULT_PREFERENCES.musicVolume),
		autoSaveInterval: Number.isFinite(autoSaveInterval) && autoSaveInterval >= 0
			? autoSaveInterval : DEFAULT_PREFERENCES.autoSaveInterval,
		liveHostingAddress: String(source.liveHostingAddress || DEFAULT_PREFERENCES.liveHostingAddress),
		liveReloadPort: Math.max(0, Math.floor(Number(source.liveReloadPort ?? DEFAULT_PREFERENCES.liveReloadPort) || 0)),
	};
}

export function loadPreferences(storage = globalThis.localStorage) {
	try {
		return normalizePreferences(JSON.parse(storage?.getItem(PREFERENCES_KEY) || "{}"));
	} catch {
		return { ...DEFAULT_PREFERENCES };
	}
}

export function storePreferences(preferences, storage = globalThis.localStorage) {
	const normalized = normalizePreferences(preferences);
	try { storage?.setItem(PREFERENCES_KEY, JSON.stringify(normalized)); } catch { /* Storage may be unavailable. */ }
	return normalized;
}

export function resolvePreferenceLanguage(language, systemLanguage = globalThis.navigator?.language) {
	if (language === "en-US" || language === "zh-CN") return language;
	return String(systemLanguage || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function isScrollableDomTarget(target) {
	if (!target || typeof target.closest !== "function") return false;
	if (target.closest("textarea, select, [contenteditable='true']")) return true;
	let element = target.nodeType === 1 ? target : target.parentElement;
	while (element && element !== element.ownerDocument?.body && element !== element.ownerDocument?.documentElement) {
		const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
		const overflowY = style?.overflowY || "";
		const overflowX = style?.overflowX || "";
		const scrollableY = (overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1;
		const scrollableX = (overflowX === "auto" || overflowX === "scroll") && element.scrollWidth > element.clientWidth + 1;
		if (scrollableY || scrollableX) return true;
		element = element.parentElement;
	}
	return false;
}

export function applyThemePreference(theme, root = globalThis.document?.documentElement) {
	const normalized = preferenceChoice(theme, ["system", "light", "dark"], DEFAULT_PREFERENCES.theme);
	if (root) {
		if (normalized === "system") root.removeAttribute("data-theme");
		else root.setAttribute("data-theme", normalized);
		const documentRef = root.ownerDocument || globalThis.document;
		const systemDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
		const dark = normalized === "dark" || normalized === "system" && systemDark;
		root.classList.toggle("theme-dark", dark);
		root.classList.toggle("theme-light", !dark);
		documentRef?.querySelector?.('meta[name="theme-color"]')
			?.setAttribute("content", dark ? "#292c30" : "#eceeef");
	}
	return normalized;
}

export function deepClone(value) {
	return structuredClone(value);
}

export function formatTime(seconds) {
	const sign = seconds < 0 ? "-" : "";
	const absolute = Math.abs(seconds);
	const minutes = Math.floor(absolute / 60);
	return `${sign}${minutes}:${(absolute % 60).toFixed(3).padStart(6, "0")}`;
}

export function formatBeat(value, subdivision) {
	const [whole, numerator, denominator] = Rational.from(value).snap(subdivision).toJSON();
	const expandedNumerator = numerator * (subdivision / denominator);
	return `${whole}${expandedNumerator < 0 ? "" : "+"}${expandedNumerator}/${subdivision}`;
}

export function evaluateExpression(value, fallback = 0) {
	if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
	try {
		const result = globalThis.math?.evaluate?.(String(value));
		return Number.isFinite(Number(result)) ? Number(result) : fallback;
	} catch {
		const result = Number(value);
		return Number.isFinite(result) ? result : fallback;
	}
}

export function selected(model) {
	return model.allEvents ? model.allEvents().filter(event => event.selected) : model.events.filter(event => event.selected);
}

export function allowsOutOfBounds(model) {
	return Boolean(model.editor?.allowOutOfBound);
}

export function pointAllowed(model, point) {
	return allowsOutOfBounds(model) || isPointWithinChartBounds(point);
}

export function attachedMoveAllowed(model, snappee, events, snapPoints) {
	if (allowsOutOfBounds(model)) return true;
	return events.every((event, index) => {
		const position = resolveAttachedPosition({ ...event, snappee: snappee.id, snapPoint: snapPoints[index] }, model.snappees);
		return position && isPointWithinChartBounds(position);
	});
}

export function attachedNotesStayWithinBounds(model, snappeeId) {
	if (allowsOutOfBounds(model)) return true;
	return (model.allEvents ? model.allEvents() : model.events).every(event => {
		if (!MOVABLE_TYPES.has(event.type) || !event.attached || event.snappee !== snappeeId) return true;
		try {
			const position = resolveAttachedPosition(event, model.snappees);
			return position && isPointWithinChartBounds(position);
		} catch {
			return false;
		}
	});
}

export function mutateSnappeeWithinBounds(model, id, mutation) {
	const index = model.snappees.findIndex(item => item.id === id);
	if (index < 0) return false;
	const previous = deepClone(model.snappees[index]);
	const result = mutation(model.snappees[index]);
	if (result === false || !attachedNotesStayWithinBounds(model, id)) {
		model.snappees[index] = previous;
		return false;
	}
	return true;
}

export function constrainSnappeeTranslation(model, id, delta) {
	const requested = { x: Number(delta?.x) || 0, y: Number(delta?.y) || 0 };
	if (allowsOutOfBounds(model)) return requested;
	const limits = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
	const includePoint = position => {
		limits.minX = Math.max(limits.minX, CHART_BOUNDS.minX - position.x);
		limits.maxX = Math.min(limits.maxX, CHART_BOUNDS.maxX - position.x);
		limits.minY = Math.max(limits.minY, CHART_BOUNDS.minY - position.y);
		limits.maxY = Math.min(limits.maxY, CHART_BOUNDS.maxY - position.y);
	};
	const snappee = model.snappees.find(item => item.id === id);
	if (!snappee) return requested;
	try {
		for (const point of sampleSnappee(snappee)) includePoint(point);
	} catch {
		return requested;
	}
	for (const event of model.allEvents ? model.allEvents() : model.events) {
		if (!event.attached || event.snappee !== id || !MOVABLE_TYPES.has(event.type)) continue;
		const position = resolveAttachedPosition(event, model.snappees);
		if (position) includePoint(position);
	}
	return {
		x: Math.max(limits.minX, Math.min(limits.maxX, requested.x)),
		y: Math.max(limits.minY, Math.min(limits.maxY, requested.y)),
	};
}

export function constrainPastedEvent(model, event) {
	if (event.type === "group") {
		for (const child of event.events || []) constrainPastedEvent(model, child);
		return;
	}
	if (!MOVABLE_TYPES.has(event.type)) return;
	let position = event;
	if (event.attached) {
		try { position = resolveAttachedPosition(event, model.snappees); } catch { position = null; }
		if (position && (allowsOutOfBounds(model) || isPointWithinChartBounds(position))) return;
	} else if (allowsOutOfBounds(model)) {
		return;
	}
	const bounded = clampPointToChartBounds(position || event);
	event.attached = false;
	event.x = bounded.x;
	event.y = bounded.y;
	delete event.snappee;
	delete event.snapPoint;
}

export function difficultyColor(name, current) {
	return DIFFICULTY_COLORS[String(name).toLowerCase()] || current || DIFFICULTY_COLORS.normal;
}

export function eventTypeLabel(type) {
	return i18n.t(`event.${type}`);
}

export function localizedErrorMessage(error) {
	const message = String(error?.message || error || "");
	if (/Web Audio is not supported/i.test(message)) return i18n.t("error.webAudioUnsupported");
	if (/Unable to decode the selected audio file/i.test(message)) return i18n.t("error.audioDecode");
	if (/Unable to decode the selected image/i.test(message)) return i18n.t("error.imageDecode");
	if (/JSZip is unavailable/i.test(message)) return i18n.t("error.zipUnavailable");
	if (/does not contain a JSON chart/i.test(message)) return i18n.t("error.levelMissingChart");
	if (/selected chart was not found/i.test(message)) return i18n.t("error.levelChartMissing");
	if (/Project folders (?:are unavailable|are available only)/i.test(message)) return i18n.t("error.projectFoldersUnavailable");
	if (/already contains sviber-project\.json/i.test(message)) return i18n.t("error.projectManifestExists");
	if (/sviber-project\.json|ENOENT|NotFoundError/i.test(message)) return i18n.t("error.projectManifestMissing");
	if (/must contain a music file/i.test(message)) return i18n.t("error.levelMusicRequired");
	if (/Clipboard access is unavailable/i.test(message)) return i18n.t("error.clipboardUnavailable");
	if (error instanceof SyntaxError) return i18n.t("error.invalidJson");
	return i18n.t("error.unknown");
}

export function localizedImportWarning(warning) {
	const message = String(warning);
	let match;
	if (message === "Chart filters are not editable in sviber and were omitted") return i18n.t("warning.filtersOmitted");
	if ((match = message.match(/^Ignored malformed event at index (\d+)$/))) return i18n.t("warning.malformedEvent", { index: match[1] });
	if ((match = message.match(/^Ignored unsupported event type (.+) at index (\d+)$/))) return i18n.t("warning.unsupportedEvent", { type: match[1], index: match[2] });
	if ((match = message.match(/^Only the first flick angle was imported at index (\d+)$/))) return i18n.t("warning.flickAngle", { index: match[1] });
	if ((match = message.match(/^The bgNote tip point was omitted at index (\d+)$/))) return i18n.t("warning.bgNoteTipPoint", { index: match[1] });
	if ((match = message.match(/^Visual-only data was omitted from event at index (\d+)$/))) return i18n.t("warning.visualData", { index: match[1] });
	if ((match = message.match(/^Tip point (.+) has no placeholder; default spawn settings were used$/))) return i18n.t("warning.missingPlaceholder", { id: match[1] });
	return i18n.t("warning.generic");
}

export function metadataFields() {
	return [
		{ id: "title", type: "text", labelKey: "field.title" },
		{ id: "artist", type: "text", labelKey: "field.artist" },
		{ id: "charter", type: "text", labelKey: "field.charter" },
		{ id: "difficultyName", type: "text", labelKey: "field.difficultyName" },
		{ id: "difficultyColor", type: "color", labelKey: "field.difficultyColor", required: true },
		{ id: "difficulty", type: "text", labelKey: "field.difficulty" },
		{ id: "difficultySup", type: "text", labelKey: "field.difficultySup" },
		{ id: "offset", type: "number", labelKey: "field.offset", step: "any" },
		{ id: "initialBpm", type: "number", labelKey: "field.initialBpm", min: 0.001, positive: true, step: "any" },
	];
}

export function applyPresetDifficultyColor(values, dialogState) {
	const nameEntry = dialogState.entries.find(item => item.field.id === "difficultyName");
	if (!nameEntry?.control?.element?.contains?.(dialogState.event?.target)
		&& nameEntry?.control?.element !== dialogState.event?.target) return;
	const preset = DIFFICULTY_COLORS[String(values.difficultyName || "").toLowerCase()];
	if (!preset) return;
	const entry = dialogState.entries.find(item => item.field.id === "difficultyColor");
	const input = entry?.control?.element?.matches?.('input[type="color"]')
		? entry.control.element
		: entry?.control?.element?.querySelector?.('input[type="color"]');
	if (input && input.value !== preset) {
		input.value = preset;
		dialogState.refresh();
	}
}
