// The clips panel and the thumbnails it paints.
//
// A clip is a saved fragment of a chart (events plus the snappees they were attached to). The
// panel shows each one as a small map of its notes drawn with the same icons and colours the
// timeline uses, so a clip is recognizable without opening it.
//
// Split out of js/panels.js.

import { resolveAttachedPosition } from "../core/geometry.js";
import { TIMELINE_EVENT_COLORS, drawTimelineEventIcon } from "../render/timeline-helpers.js";
import { clear } from "./panel-controls.js";

function makeInlineActionRow(documentRef, i18n, tooltip, items) {
	const row = documentRef.createElement("div");
	row.className = "item-expanded-actions";
	for (const item of items) {
		const button = documentRef.createElement("button");
		button.type = "button";
		button.className = "snappee-action";
		button.disabled = Boolean(item.disabled);
		button.setAttribute("aria-label", i18n.t(item.tooltipKey));
		const image = documentRef.createElement("img");
		image.src = `svg/icons/${item.icon}.svg`;
		image.alt = "";
		image.draggable = false;
		button.append(image);
		button.addEventListener("click", event => {
			event.stopPropagation();
			if (!button.disabled) {
				item.onSelect?.();
			}
		});
		tooltip?.register(button, item.tooltipKey);
		row.append(button);
	}
	return row;
}

function makeExpansionButton(documentRef, i18n, tooltip, expanded, onToggle) {
	const button = documentRef.createElement("button");
	button.type = "button";
	button.className = "snappee-action item-expand-button";
	button.setAttribute("aria-expanded", String(expanded));
	button.setAttribute("aria-label", i18n.t(expanded ? "panel.item.collapse" : "panel.item.expand"));
	const image = documentRef.createElement("img");
	image.src = "svg/icons/menu.svg";
	image.alt = "";
	image.draggable = false;
	button.append(image);
	button.addEventListener("click", event => {
		event.stopPropagation();
		onToggle(!expanded);
	});
	tooltip?.register(button, expanded ? "panel.item.collapse" : "panel.item.expand");
	return button;
}

export function drawClipThumbnail(canvas, data, size = 42) {
	const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
	canvas.width = size * ratio;
	canvas.height = size * ratio;
	canvas.style.width = `${size}px`;
	canvas.style.height = `${size}px`;
	const context = canvas.getContext("2d");
	if (!context) {
		return;
	}
	context.scale(ratio, ratio);
	context.fillStyle = "#15181b";
	context.fillRect(0, 0, size, size);
	// Notes inside a clip may be attached to a snappee, so their positions are resolved
	// against the snappees the clip carries rather than the chart's current ones.
	const events = [];
	const visit = items =>
		(items || []).forEach(event => {
			if (event.type === "group") {
				visit(event.events);
			} else {
				const position = resolveAttachedPosition(event, data?.snappees || []);
				if (position) {
					events.push({ event, position });
				}
			}
		});
	visit(data?.events);
	if (!events.length) {
		return;
	}
	const minX = Math.min(...events.map(({ position }) => position.x));
	const maxX = Math.max(...events.map(({ position }) => position.x));
	const minY = Math.min(...events.map(({ position }) => position.y));
	const maxY = Math.max(...events.map(({ position }) => position.y));
	const span = Math.max(maxX - minX, maxY - minY, 1);
	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;
	const iconScale = size / 72;
	for (const { event, position } of events) {
		const x = size / 2 + ((position.x - centerX) / span) * (size - 10);
		const y = size / 2 - ((position.y - centerY) / span) * (size - 10);
		context.save();
		context.translate(x, y);
		context.scale(iconScale, iconScale);
		drawTimelineEventIcon(context, event, 0, 0, TIMELINE_EVENT_COLORS[event.type] || "#d5dade");
		context.restore();
	}
}

export class ClipsPanel {
	constructor(options = {}) {
		this.element = options.element || document.getElementById("clips-panel");
		this.i18n = options.i18n;
		this.tooltip = options.tooltip;
		this.onPaste = options.onPaste || (() => {});
		this.onMove = options.onMove || (() => {});
		this.onEdit = options.onEdit || (() => {});
		this.onDelete = options.onDelete || (() => {});
		this.onToggleExpanded = options.onToggleExpanded || (() => {});
		this.cleanup = [];
	}

	#action(icon, tooltipKey, callback, disabled = false) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "snappee-action";
		button.disabled = disabled;
		button.setAttribute("aria-label", this.i18n.t(tooltipKey));
		const image = document.createElement("img");
		image.src = `svg/icons/${icon}.svg`;
		image.alt = "";
		image.draggable = false;
		button.append(image);
		button.addEventListener("click", event => {
			event.stopPropagation();
			if (!button.disabled) {
				callback();
			}
		});
		this.cleanup.push(this.tooltip?.register(button, tooltipKey));
		return button;
	}

	#item(clip, index, model, readOnly) {
		const item = document.createElement("div");
		item.className = "snappee-item clip-item";
		item.tabIndex = 0;
		const canvas = document.createElement("canvas");
		canvas.className = "clip-thumbnail";
		drawClipThumbnail(canvas, clip.data);
		const name = document.createElement("span");
		name.className = "snappee-name";
		name.textContent = clip.name;
		const actions = makeInlineActionRow(document, this.i18n, this.tooltip, [
				{
					icon: "up",
					tooltipKey: "panel.clip.moveUp",
					disabled: readOnly || index === 0,
					keepOpen: true,
					onSelect: () => this.onMove(index, -1),
				},
				{
					icon: "down",
					tooltipKey: "panel.clip.moveDown",
					disabled: readOnly || index === model.clips.length - 1,
					keepOpen: true,
					onSelect: () => this.onMove(index, 1),
				},
				{
					icon: "edit",
					tooltipKey: "panel.clip.edit",
					disabled: readOnly,
					onSelect: () => this.onEdit(index),
				},
				{
					icon: "delete",
					tooltipKey: "panel.clip.delete",
					disabled: readOnly,
					onSelect: () => this.onDelete(index),
				},
		]);
		actions.hidden = clip.expanded !== true;
		const expansion = makeExpansionButton(
			document,
			this.i18n,
			this.tooltip,
			clip.expanded === true,
			expanded => this.onToggleExpanded(index, expanded),
		);
		item.append(
			canvas,
			name,
			this.#action("paste", "panel.clip.paste", () => this.onPaste(index), readOnly),
			expansion,
			actions,
		);
		item.addEventListener("dblclick", () => {
			if (!readOnly) {
				this.onEdit(index);
			}
		});
		return item;
	}

	render(model, context = {}) {
		const readOnly = Boolean(context.readOnly);
		this.cleanup.forEach(dispose => dispose?.());
		this.cleanup = [];
		clear(this.element);
		if (!model.clips?.length) {
			const empty = document.createElement("div");
			empty.className = "empty-panel";
			empty.textContent = this.i18n.t("panel.noClips");
			this.element.append(empty);
			return;
		}
		model.clips.forEach((clip, index) => {
			this.element.append(this.#item(clip, index, model, readOnly));
		});
	}
}
