// The snappee and channel list panels: the two side lists whose items carry an
// activate/deactivate toggle plus a popup menu with the rest of their actions.
//
// v22 moved the rarely used actions of every list item (duplicate, reorder, edit, delete,
// and the channel-specific hide/show and create-above/below) into the small popup menu
// built by ./item-menu.js, so the item itself only keeps its primary toggle. Split out of
// js/panels.js, which re-exports these classes so existing importers keep working.

import { sampleSnappee } from "../core/geometry.js";
import { clear } from "./panel-controls.js";

// The snappee's sampled points, scaled into the preview box. Chart y grows upwards while
// canvas y grows downwards, so the projection flips it.
function snappeePreviewProjection(points, size) {
	const xs = points.map(point => point.x);
	const ys = points.map(point => point.y);
	let minX = Math.min(...xs);
	let maxX = Math.max(...xs);
	let minY = Math.min(...ys);
	let maxY = Math.max(...ys);
	if (maxX - minX < 1e-9) {
		minX -= 0.5;
		maxX += 0.5;
	}
	if (maxY - minY < 1e-9) {
		minY -= 0.5;
		maxY += 0.5;
	}
	const padding = Math.max(2, size * 0.1);
	const scale = Math.min((size - padding * 2) / (maxX - minX), (size - padding * 2) / (maxY - minY));
	const offsetX = (size - (maxX - minX) * scale) / 2;
	const offsetY = (size - (maxY - minY) * scale) / 2;
	return point => ({
		x: offsetX + (point.x - minX) * scale,
		y: offsetY + (maxY - point.y) * scale,
	});
}

// Mesh snappees carry two-dimensional snap points, so their preview is drawn as the two
// families of grid lines through those indices rather than as one polyline.
function meshLines(points, coordinate, sortCoordinate) {
	const groups = new Map();
	for (const point of points) {
		if (!Array.isArray(point.snapPoint)) {
			continue;
		}
		const key = point.snapPoint[coordinate];
		if (!groups.has(key)) {
			groups.set(key, []);
		}
		groups.get(key).push(point);
	}
	return [...groups.values()].map(line =>
		line.sort((left, right) => left.snapPoint[sortCoordinate] - right.snapPoint[sortCoordinate]),
	);
}

function drawSnappeePreview(canvas, snappee, size) {
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
	let points;
	try {
		points = sampleSnappee(snappee);
	} catch {
		points = [];
	}
	if (!points.length) {
		return;
	}

	const project = snappeePreviewProjection(points, size);
	const drawLine = (line, closed = false) => {
		if (!line.length) {
			return;
		}
		context.beginPath();
		line.forEach((point, index) => {
			const projected = project(point);
			if (index) {
				context.lineTo(projected.x, projected.y);
			} else {
				context.moveTo(projected.x, projected.y);
			}
		});
		if (closed && line.length > 2) {
			context.closePath();
		}
		context.stroke();
	};

	context.strokeStyle = snappee.color || "#50a226";
	context.fillStyle = snappee.color || "#50a226";
	context.lineWidth = Math.max(1, size / 18);
	context.lineJoin = "round";
	context.lineCap = "round";
	// Keep the panel preview visible for inactive snappees; the item CSS applies
	// the required grayscale/translucent treatment independently of stage visibility.
	context.globalAlpha = 0.95;
	if (snappee.type === "radialMesh") {
		meshLines(points, 0, 1).forEach(line => drawLine(line));
		meshLines(points, 1, 0).forEach((line, index) => drawLine(line, index > 0));
	} else if (snappee.type.endsWith("Mesh")) {
		meshLines(points, 0, 1).forEach(line => drawLine(line));
		meshLines(points, 1, 0).forEach(line => drawLine(line));
	} else {
		drawLine(points, Boolean(snappee.closed || snappee.type === "regularPolygonCurve"));
	}
	const stride = Math.max(1, Math.ceil(points.length / 80));
	for (let index = 0; index < points.length; index += stride) {
		const projected = project(points[index]);
		context.beginPath();
		context.arc(projected.x, projected.y, Math.max(0.7, size / 30), 0, Math.PI * 2);
		context.fill();
	}
}

export function makeSnappeePreview(documentRef, snappee, size = 24) {
	const preview = documentRef.createElement("span");
	preview.className = "snappee-preview";
	const canvas = documentRef.createElement("canvas");
	drawSnappeePreview(canvas, snappee, size);
	preview.append(canvas);
	return preview;
}

// A list item's modifier classes, kept out of the template literal so the line stays readable.
function listItemClassName(base, { selected = false, inactive = false } = {}) {
	const classes = [base];
	if (selected) {
		classes.push("is-selected");
	}
	if (inactive) {
		classes.push("is-inactive");
	}
	return classes.join(" ");
}

// The popup menu entries of a snappee item, extracted so the item builder stays small.
function snappeeMenuItems(panel, snappee, index, model, readOnly) {
	return [
		{
			icon: "duplicate",
			tooltipKey: "panel.snappee.duplicate",
			disabled: readOnly,
			onSelect: () => panel.onDuplicate(snappee.id),
		},
		{
			icon: "up",
			tooltipKey: "panel.snappee.moveUp",
			disabled: readOnly || index === 0,
			keepOpen: true,
			onSelect: () => panel.onMove(snappee.id, -1),
		},
		{
			icon: "down",
			tooltipKey: "panel.snappee.moveDown",
			disabled: readOnly || index === model.snappees.length - 1,
			keepOpen: true,
			onSelect: () => panel.onMove(snappee.id, 1),
		},
		{
			icon: "edit",
			tooltipKey: "panel.snappee.edit",
			disabled: readOnly,
			onSelect: () => panel.onEdit(snappee.id),
		},
		{
			icon: "delete",
			tooltipKey: "panel.snappee.delete",
			disabled: readOnly,
			onSelect: () => panel.onDelete(snappee.id),
		},
	];
}

// The popup menu entries of a channel item; moving up/down keeps the menu open so a list
// can be reordered without reopening it after every step.
function channelMenuItems(panel, channel, index, model, readOnly) {
	return [
		{
			icon: channel.hidden === true ? "show-channel" : "hide-channel",
			tooltipKey: channel.hidden === true ? "panel.channel.show" : "panel.channel.hide",
			onSelect: () => panel.onSetHidden(channel.id, channel.hidden !== true),
		},
		{
			icon: "duplicate",
			tooltipKey: "panel.channel.duplicate",
			disabled: readOnly,
			onSelect: () => panel.onDuplicate(channel.id),
		},
		{
			icon: "up",
			tooltipKey: "panel.channel.moveUp",
			disabled: readOnly || index === 0,
			keepOpen: true,
			onSelect: () => panel.onMove(channel.id, -1),
		},
		{
			icon: "down",
			tooltipKey: "panel.channel.moveDown",
			disabled: readOnly || index === model.channels.length - 1,
			keepOpen: true,
			onSelect: () => panel.onMove(channel.id, 1),
		},
		{
			icon: "create-channel-above",
			tooltipKey: "panel.channel.createAbove",
			disabled: readOnly,
			onSelect: () => panel.onCreate(channel.id, 0),
		},
		{
			icon: "create-channel-below",
			tooltipKey: "panel.channel.createBelow",
			disabled: readOnly,
			onSelect: () => panel.onCreate(channel.id, 1),
		},
		{
			icon: "edit",
			tooltipKey: "panel.channel.rename",
			disabled: readOnly,
			onSelect: () => panel.onEdit(channel.id),
		},
		{
			icon: "delete",
			tooltipKey: "panel.channel.delete",
			disabled: readOnly || model.channels.length <= 1,
			onSelect: () => panel.onDelete(channel.id),
		},
	];
}

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

export class SnappeesPanel {
	constructor(options = {}) {
		this.element = options.element || document.getElementById("snappees-panel");
		this.i18n = options.i18n;
		this.tooltip = options.tooltip;
		this.onSelect = options.onSelect || (() => {});
		this.onToggle = options.onToggle || (() => {});
		this.onDuplicate = options.onDuplicate || (() => {});
		this.onDelete = options.onDelete || (() => {});
		this.onEdit = options.onEdit || (() => {});
		this.onMove = options.onMove || (() => {});
		this.onToggleExpanded = options.onToggleExpanded || (() => {});
		this.cleanup = [];
	}

	#action(icon, tooltipKey, callback, disabled = false, action = null) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "snappee-action";
		button.disabled = disabled;
		if (action) {
			button.dataset.snappeeAction = action;
		}
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

	#syncToggle(button, snappee) {
		const icon = snappee.active === false ? "activate" : "deactivate";
		const tooltipKey = snappee.active === false ? "panel.snappee.activate" : "panel.snappee.deactivate";
		const image = button.querySelector("img");
		if (image) {
			image.src = `svg/icons/${icon}.svg`;
		}
		button.setAttribute("aria-label", this.i18n.t(tooltipKey));
		this.tooltip?.register(button, tooltipKey);
	}

	// Toggling active/selected does not change the list's shape, so the existing items are
	// patched in place; anything else falls back to a full render.
	syncFlags(model, context = {}) {
		const items = this.element.querySelectorAll(":scope > .snappee-item");
		if (!model.snappees.length || items.length !== model.snappees.length) {
			this.render(model, context);
			return;
		}
		for (let index = 0; index < model.snappees.length; index += 1) {
			const snappee = model.snappees[index];
			const item = items[index];
			if (item.dataset.snappeeId !== String(snappee.id)) {
				this.render(model, context);
				return;
			}
			item.classList.toggle("is-selected", Boolean(snappee.selected));
			item.classList.toggle("is-inactive", snappee.active === false);
			item.tabIndex = context.readOnly ? -1 : 0;
			item.setAttribute("aria-disabled", String(Boolean(context.readOnly)));
			item.setAttribute("aria-pressed", String(Boolean(snappee.selected)));
			const toggle = item.querySelector("[data-snappee-action='toggle']");
			if (toggle) {
				this.#syncToggle(toggle, snappee);
			}
		}
	}

	#item(snappee, index, model, readOnly) {
		const item = document.createElement("div");
		item.dataset.snappeeId = String(snappee.id);
		item.className = listItemClassName("snappee-item", {
			selected: snappee.selected,
			inactive: snappee.active === false,
		});
		item.tabIndex = readOnly ? -1 : 0;
		item.setAttribute("aria-disabled", String(readOnly));
		item.setAttribute("role", "button");
		item.setAttribute("aria-pressed", String(Boolean(snappee.selected)));
		const preview = makeSnappeePreview(document, snappee, 24);
		const name = document.createElement("span");
		name.className = "snappee-name";
		name.textContent = snappee.name;
		const actions = makeInlineActionRow(
			document,
			this.i18n,
			this.tooltip,
			snappeeMenuItems(this, snappee, index, model, readOnly),
		);
		actions.hidden = snappee.expanded !== true;
		const expansion = makeExpansionButton(
			document,
			this.i18n,
			this.tooltip,
			snappee.expanded === true,
			expanded => this.onToggleExpanded(snappee.id, expanded),
		);
		item.append(
			preview,
			name,
			this.#action(
				snappee.active === false ? "activate" : "deactivate",
				snappee.active === false ? "panel.snappee.activate" : "panel.snappee.deactivate",
				() => this.onToggle(snappee.id),
				false,
				"toggle",
			),
			expansion,
			actions,
		);
		item.addEventListener("click", () => {
			if (!readOnly && snappee.active !== false) {
				this.onSelect(snappee.id);
			}
		});
		item.addEventListener("dblclick", () => {
			if (!readOnly) {
				this.onEdit(snappee.id);
			}
		});
		item.addEventListener("keydown", event => {
			if (!readOnly && event.key === "Enter") {
				this.onEdit(snappee.id);
			}
		});
		this.cleanup.push(this.tooltip?.register(item, "panel.snappee.edit"));
		return item;
	}

	render(model, context = {}) {
		const readOnly = Boolean(context.readOnly);
		const scrollTop = Number(this.element.scrollTop) || 0;
		const scrollLeft = Number(this.element.scrollLeft) || 0;
		this.cleanup.forEach(dispose => dispose?.());
		this.cleanup = [];
		clear(this.element);
		if (!model.snappees.length) {
			const empty = document.createElement("div");
			empty.className = "empty-panel";
			empty.textContent = this.i18n.t("panel.noSnappees");
			this.element.append(empty);
			this.element.scrollTop = scrollTop;
			this.element.scrollLeft = scrollLeft;
			return;
		}
		model.snappees.forEach((snappee, index) => {
			this.element.append(this.#item(snappee, index, model, readOnly));
		});
		this.element.scrollTop = scrollTop;
		this.element.scrollLeft = scrollLeft;
	}
}

export class ChannelsPanel {
	constructor(options = {}) {
		this.element = options.element || document.getElementById("channels-panel");
		this.i18n = options.i18n;
		this.tooltip = options.tooltip;
		this.onSelect = options.onSelect || (() => {});
		this.onToggle = options.onToggle || (() => {});
		this.onSetHidden = options.onSetHidden || (() => {});
		this.onCreate = options.onCreate || (() => {});
		this.onDuplicate = options.onDuplicate || (() => {});
		this.onDelete = options.onDelete || (() => {});
		this.onEdit = options.onEdit || (() => {});
		this.onMove = options.onMove || (() => {});
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

	#item(channel, index, model, readOnly) {
		const item = document.createElement("div");
		item.className = listItemClassName("snappee-item channel-item", {
			selected: channel.id === model.editor.currentChannel,
			inactive: channel.active === false,
		});
		item.classList.toggle("is-hidden", channel.hidden === true);
		item.tabIndex = 0;
		item.setAttribute("role", "button");
		item.setAttribute("aria-pressed", String(channel.id === model.editor.currentChannel));
		const ordinal = document.createElement("span");
		ordinal.className = "channel-index";
		ordinal.textContent = String(index + 1);
		const name = document.createElement("span");
		name.className = "snappee-name";
		name.textContent = String(channel.name || `Channel ${index + 1}`);
		const actions = makeInlineActionRow(
			document,
			this.i18n,
			this.tooltip,
			channelMenuItems(this, channel, index, model, readOnly),
		);
		actions.hidden = channel.expanded !== true;
		const expansion = makeExpansionButton(
			document,
			this.i18n,
			this.tooltip,
			channel.expanded === true,
			expanded => this.onToggleExpanded(channel.id, expanded),
		);
		item.append(
			ordinal,
			name,
			this.#action(
				channel.active === false ? "activate" : "deactivate",
				channel.active === false ? "panel.channel.activate" : "panel.channel.deactivate",
				() => this.onToggle(channel.id),
				false,
			),
			expansion,
			actions,
		);
		item.addEventListener("click", () => {
			if (channel.active !== false) {
				this.onSelect(channel.id);
			}
		});
		item.addEventListener("dblclick", () => {
			if (!readOnly) {
				this.onEdit(channel.id);
			}
		});
		item.addEventListener("keydown", event => {
			if (!readOnly && event.key === "Enter") {
				this.onEdit(channel.id);
			}
		});
		this.cleanup.push(this.tooltip?.register(item, "panel.channel.edit"));
		return item;
	}

	render(model, context = {}) {
		const readOnly = Boolean(context.readOnly);
		this.cleanup.forEach(dispose => dispose?.());
		this.cleanup = [];
		clear(this.element);
		model.channels.forEach((channel, index) => {
			this.element.append(this.#item(channel, index, model, readOnly));
		});
	}
}
