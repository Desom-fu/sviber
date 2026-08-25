import { Rational } from "./core/rational.js";
import { eventTime } from "./core/grouping.js";
import { AFFINE_MATRIX_GRID, resolveAttachedPosition, sampleSnappee } from "./core/geometry.js";
import { TIMELINE_EVENT_COLORS, drawTimelineEventIcon } from "./render/timeline-helpers.js";

const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote"]);
const DURATION_TYPES = new Set(["hold", "bgNote", "bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram", "comment"]);
const TEXT_TYPES = new Set(["tap", "hold", "flick", "bgNote", "bigText", "comment"]);
const TIP_TYPES = new Set(["tap", "hold", "drag", "flick"]);
const ZERO_DURATION_TYPES = new Set(["bgNote", "comment"]);
const MIXED = Symbol("mixed");

function commonValue(items, getter) {
	if (!items.length) return undefined;
	const first = getter(items[0]);
	const serialized = JSON.stringify(first);
	return items.every(item => JSON.stringify(getter(item)) === serialized) ? first : MIXED;
}

function clear(element) {
	element.replaceChildren();
}

function makeRationalControl(documentRef, value, onChange) {
	const wrapper = documentRef.createElement("div");
	wrapper.className = "rational-input";
	let tuple = [0, 0, 1];
	if (value !== MIXED) {
		try { tuple = Rational.from(value ?? 0).toJSON(); } catch { /* Keep default. */ }
	}
	const controls = [0, 1, 2].map(index => {
		const input = documentRef.createElement("input");
		input.type = "number";
		input.step = "1";
		input.value = value === MIXED ? "" : tuple[index];
		input.placeholder = value === MIXED ? "-" : "";
		if (index === 2) input.min = "1";
		return input;
	});
	wrapper.append(controls[0], "+", controls[1], "/", controls[2]);
	const emit = () => {
		const values = controls.map(input => Number(input.value));
		if (values.every(Number.isSafeInteger) && values[2] > 0) onChange(Rational.from(values).toJSON());
	};
	for (const input of controls) input.addEventListener("keydown", event => {
		if (event.key === "Enter") { event.preventDefault(); emit(); }
	});
	wrapper.addEventListener("focusout", event => {
		if (!wrapper.contains(event.relatedTarget)) emit();
	});
	return wrapper;
}

function makeInput(documentRef, type, value, onChange, options = {}) {
	const input = documentRef.createElement("input");
	input.type = type;
	if (value === MIXED) {
		input.value = "";
		input.placeholder = options.mixed || "-";
	} else if (type === "checkbox") {
		input.checked = Boolean(value);
	} else {
		input.value = value ?? "";
	}
	if (options.step) input.step = options.step;
	if (options.min != null) input.min = options.min;
	const emit = () => {
		if (type === "checkbox") onChange(input.checked);
		else if (type === "number") {
			const number = Number(input.value);
			if (Number.isFinite(number)) onChange(number);
		} else onChange(input.value);
	};
	input.addEventListener("change", emit);
	if (type !== "checkbox") input.addEventListener("keydown", event => {
		if (event.key === "Enter") { event.preventDefault(); emit(); }
	});
	return input;
}

function evaluateExpression(value) {
	try {
		const result = globalThis.math?.evaluate?.(String(value));
		const number = Number(result ?? value);
		return Number.isFinite(number) ? number : null;
	} catch {
		const number = Number(value);
		return Number.isFinite(number) ? number : null;
	}
}

function makeExpressionControl(documentRef, value, onChange, options = {}) {
	const input = documentRef.createElement("input");
	input.type = "text";
	input.inputMode = "decimal";
	input.value = value === MIXED ? "" : String(value ?? "");
	input.placeholder = value === MIXED ? options.mixed || "-" : "";
	const emit = () => {
		const number = evaluateExpression(input.value);
		if (number != null) onChange(number);
	};
	input.addEventListener("change", emit);
	input.addEventListener("keydown", event => {
		if (event.key === "Enter") { event.preventDefault(); emit(); }
	});
	return input;
}

function makeAngleControl(documentRef, value, onChange, i18n) {
	const wrapper = documentRef.createElement("div");
	wrapper.className = "angle-input";
	const input = documentRef.createElement("input");
	input.type = "text";
	input.inputMode = "decimal";
	input.value = value === MIXED ? "" : String((Number(value) || 0) * 180 / Math.PI);
	input.placeholder = value === MIXED ? "-" : "";
	const radiansLine = documentRef.createElement("label");
	radiansLine.className = "checkbox-line";
	const radians = documentRef.createElement("input");
	radians.type = "checkbox";
	const text = documentRef.createElement("span");
	text.textContent = i18n.t("field.radians");
	radiansLine.append(radians, text);
	const emit = () => {
		const number = evaluateExpression(input.value);
		if (number != null) onChange(radians.checked ? number : number * Math.PI / 180);
	};
	input.addEventListener("change", emit);
	input.addEventListener("keydown", event => {
		if (event.key === "Enter") { event.preventDefault(); emit(); }
	});
	radians.addEventListener("change", () => {
		const number = evaluateExpression(input.value);
		if (number == null) return;
		input.value = String(radians.checked ? number * Math.PI / 180 : number * 180 / Math.PI);
	});
	wrapper.append(input, radiansLine);
	return wrapper;
}

function makeRadioControl(documentRef, options, value, onChange) {
	const wrapper = documentRef.createElement("div");
	wrapper.className = "choice-grid compact-choice-grid";
	const name = `inspector-choice-${Math.random().toString(36).slice(2)}`;
	for (const option of options) {
		const line = documentRef.createElement("label");
		line.className = "radio-line";
		const input = documentRef.createElement("input");
		input.type = "radio";
		input.name = name;
		input.value = String(option.value);
		input.checked = value !== MIXED && String(value) === input.value;
		input.addEventListener("change", () => {
			if (input.checked) onChange(option.value);
		});
		line.append(input, option.label);
		wrapper.append(line);
	}
	return wrapper;
}

function setControlDisabled(control, disabled) {
	for (const input of control.matches?.("input,select,textarea,button") ? [control] : []) input.disabled = disabled;
	for (const input of control.querySelectorAll?.("input,select,textarea,button") || []) input.disabled = disabled;
	return control;
}

function drawSnappeePreview(canvas, snappee, size) {
	const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
	canvas.width = size * ratio;
	canvas.height = size * ratio;
	canvas.style.width = `${size}px`;
	canvas.style.height = `${size}px`;
	const context = canvas.getContext("2d");
	if (!context) return;
	context.scale(ratio, ratio);
	let points;
	try {
		points = sampleSnappee(snappee);
	} catch {
		points = [];
	}
	if (!points.length) return;

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
	const project = point => ({
		x: offsetX + (point.x - minX) * scale,
		y: offsetY + (maxY - point.y) * scale,
	});
	const drawLine = (line, closed = false) => {
		if (!line.length) return;
		context.beginPath();
		line.forEach((point, index) => {
			const projected = project(point);
			if (index) context.lineTo(projected.x, projected.y);
			else context.moveTo(projected.x, projected.y);
		});
		if (closed && line.length > 2) context.closePath();
		context.stroke();
	};
	const grouped = (coordinate, sortCoordinate) => {
		const groups = new Map();
		for (const point of points) {
			if (!Array.isArray(point.snapPoint)) continue;
			const key = point.snapPoint[coordinate];
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(point);
		}
		return [...groups.values()].map(line => line.sort((left, right) => (
			left.snapPoint[sortCoordinate] - right.snapPoint[sortCoordinate]
		)));
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
		grouped(0, 1).forEach(line => drawLine(line));
		grouped(1, 0).forEach((line, index) => drawLine(line, index > 0));
	} else if (snappee.type.endsWith("Mesh")) {
		grouped(0, 1).forEach(line => drawLine(line));
		grouped(1, 0).forEach(line => drawLine(line));
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

function makeSnappeePreview(documentRef, snappee, size = 24) {
	const preview = documentRef.createElement("span");
	preview.className = "snappee-preview";
	const canvas = documentRef.createElement("canvas");
	drawSnappeePreview(canvas, snappee, size);
	preview.append(canvas);
	return preview;
}

function setControlHidden(control, hidden) {
	if (control) control.dataset.hidden = hidden ? "true" : "false";
	return control;
}

export function drawClipThumbnail(canvas, data, size = 42) {
	const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
	canvas.width = size * ratio;
	canvas.height = size * ratio;
	canvas.style.width = `${size}px`;
	canvas.style.height = `${size}px`;
	const context = canvas.getContext("2d");
	if (!context) return;
	context.scale(ratio, ratio);
	context.fillStyle = "#15181b";
	context.fillRect(0, 0, size, size);
	const events = [];
	const visit = items => (items || []).forEach(event => {
		if (event.type === "group") visit(event.events);
		else {
			const position = resolveAttachedPosition(event, data?.snappees || []);
			if (position) events.push({ event, position });
		}
	});
	visit(data?.events);
	if (!events.length) return;
	const minX = Math.min(...events.map(({ position }) => position.x));
	const maxX = Math.max(...events.map(({ position }) => position.x));
	const minY = Math.min(...events.map(({ position }) => position.y));
	const maxY = Math.max(...events.map(({ position }) => position.y));
	const span = Math.max(maxX - minX, maxY - minY, 1);
	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;
	const iconScale = size / 72;
	for (const { event, position } of events) {
		const x = size / 2 + (position.x - centerX) / span * (size - 10);
		const y = size / 2 - (position.y - centerY) / span * (size - 10);
		context.save();
		context.translate(x, y);
		context.scale(iconScale, iconScale);
		drawTimelineEventIcon(context, event, 0, 0, TIMELINE_EVENT_COLORS[event.type] || "#d5dade");
		context.restore();
	}
}

function drawActionIcon(canvas, type) {
	const size = 17;
	const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
	canvas.width = size * ratio;
	canvas.height = size * ratio;
	canvas.style.width = `${size}px`;
	canvas.style.height = `${size}px`;
	const context = canvas.getContext("2d");
	if (!context) return;
	context.scale(ratio, ratio);
	context.strokeStyle = "currentColor";
	context.lineWidth = 1.6;
	context.lineCap = "square";
	if (type === "duplicate") {
		context.strokeRect(2.5, 5.5, 9, 9);
		context.strokeRect(5.5, 2.5, 9, 9);
		return;
	}
	context.beginPath();
	context.moveTo(4, 4);
	context.lineTo(13, 13);
	context.moveTo(13, 4);
	context.lineTo(4, 13);
	context.stroke();
}

function makeSelect(documentRef, options, value, onChange) {
	const select = documentRef.createElement("select");
	if (value === MIXED) {
		const option = documentRef.createElement("option");
		option.value = "";
		option.textContent = "-";
		option.disabled = true;
		option.selected = true;
		select.append(option);
	}
	for (const item of options) {
		const option = documentRef.createElement("option");
		option.value = String(item.value);
		option.textContent = item.label;
		option.selected = value !== MIXED && String(value) === option.value;
		select.append(option);
	}
	select.addEventListener("change", () => onChange(select.value));
	return select;
}

export class InspectorPanel {
	constructor(options = {}) {
		this.element = options.element || document.getElementById("inspector-panel");
		this.i18n = options.i18n;
		this.tooltip = options.tooltip;
		this.onChange = options.onChange || (() => {});
		this.onTransformChange = options.onTransformChange || (() => {});
		this.cleanup = [];
	}

	#row(labelKey, control, tooltipKey = null) {
		const row = document.createElement("div");
		row.className = "property-row";
		if (control?.dataset?.hidden === "true") row.hidden = true;
		const label = document.createElement("label");
		label.textContent = this.i18n.t(labelKey);
		row.append(label, control);
		this.cleanup.push(this.tooltip?.register(label, tooltipKey || labelKey));
		return row;
	}

	#group(titleKey) {
		const fieldset = document.createElement("fieldset");
		fieldset.className = "property-group";
		const legend = document.createElement("legend");
		legend.textContent = this.i18n.t(titleKey);
		fieldset.append(legend);
		return fieldset;
	}

	render(model, context = {}) {
		this.cleanup.forEach(dispose => dispose?.());
		this.cleanup = [];
		clear(this.element);
		const allSelected = (Array.isArray(context.selectedEvents) ? context.selectedEvents : (model.allEvents ? model.allEvents() : model.events)).filter(event => event.selected);
		const selectedGroups = allSelected.filter(event => event.type === "group");
		const selected = selectedGroups.length ? selectedGroups : allSelected;
		const commentsOnly = selected.length > 0 && selected.every(event => event.type === "comment");
		const groupsOnly = selectedGroups.length > 0;
		if (Array.isArray(context.transform)) {
			const transformGroup = this.#group("field.transform");
			const wrapper = document.createElement("div");
			wrapper.className = "matrix-input";
			const keys = ["field.matrixA", "field.matrixB", "field.matrixC", "field.matrixD", "field.matrixTx", "field.matrixTy"];
			const inputs = context.transform.map((value, index) => {
				const input = makeInput(document, "number", value, next => {
					const applied = this.onTransformChange(index, next);
					if (Number.isFinite(applied) && applied !== next) input.value = applied;
				}, { step: "any" });
				input.setAttribute("aria-label", this.i18n.t(keys[index]));
				input.title = this.i18n.t(keys[index]);
				return input;
			});
			for (const index of AFFINE_MATRIX_GRID) wrapper.append(inputs[index]);
			transformGroup.append(this.#row("field.transform", wrapper));
			this.element.append(transformGroup);
		}
		if (!selected.length) {
			const empty = document.createElement("p");
			empty.className = "panel-empty-message is-muted";
			empty.textContent = this.i18n.t("panel.noSelection");
			this.element.append(empty);
			return;
		}

		const group = this.#group(selected.every(event => event.type === selected[0].type)
			? `event.${selected[0].type}` : "panel.commonProperties");
		let typeControl = null;
		if (!groupsOnly) {
			const types = commonValue(selected, event => event.type);
			typeControl = makeSelect(document, [
				"tap", "hold", "drag", "flick", "bgNote", "bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram", "comment",
			].map(type => ({ value: type, label: this.i18n.t(`event.${type}`) })), types,
			value => this.onChange("type", value));
			group.append(this.#row("field.type", typeControl));
		}

		const time = commonValue(selected, event => eventTime(event));
		const timeControl = makeRationalControl(document, time,
			value => this.onChange("time", value));
		if (groupsOnly) setControlDisabled(timeControl, true);
		group.append(this.#row("field.time", timeControl));
		if (groupsOnly) {
			const color = commonValue(selected, event => event.color);
			group.append(this.#row("field.color", makeInput(document, "color",
				color === MIXED ? "#ff9d3d" : color || "#ff9d3d",
				value => this.onChange("color", value))));
			const position = commonValue(selected, event => {
				const resolved = resolveAttachedPosition(event, model.snappees);
				return resolved ? [resolved.x, resolved.y] : [event.x || 0, event.y || 0];
			});
			const positionWrapper = document.createElement("div");
			positionWrapper.className = "pair-input";
			positionWrapper.append(
				makeExpressionControl(document, position === MIXED ? MIXED : position[0], value => this.onChange("x", value)),
				makeExpressionControl(document, position === MIXED ? MIXED : position[1], value => this.onChange("y", value)),
			);
			if (selected.some(event => event.attached)) positionWrapper.querySelectorAll("input").forEach(input => input.disabled = true);
			group.append(this.#row("field.position", positionWrapper));
			if (model.editor.readOnly) setControlDisabled(group, true);
			this.element.append(group);
			return;
		}
		const channel = commonValue(selected, event => event.channel);
		group.append(this.#row("field.channel", makeSelect(document,
			model.channels.map((item, index) => ({ item, index }))
				.filter(({ item }) => item.active !== false)
				.map(({ item, index }) => ({ value: item.id, label: String(item.name || `Channel ${index + 1}`) })), channel,
			value => this.onChange("channel", Number(value)))));

		if (selected.every(event => MOVABLE_TYPES.has(event.type))) {
			const attached = commonValue(selected, event => event.attached);
			const attachedSnappee = commonValue(selected, event => event.attached ? event.snappee : null);
			const position = commonValue(selected, event => {
				const resolved = resolveAttachedPosition(event, model.snappees);
				return resolved ? [resolved.x, resolved.y] : [event.x, event.y];
			});
			const wrapper = document.createElement("div");
			wrapper.className = "attached-input";
			if (attached === true && attachedSnappee !== MIXED) {
				const snappee = model.snappees.find(item => item.id === attachedSnappee);
				if (snappee) wrapper.append(makeSnappeePreview(document, snappee, 22));
			}
			const pair = document.createElement("div");
			pair.className = "pair-input";
			pair.append(
				makeExpressionControl(document, position === MIXED ? MIXED : position[0], value => this.onChange("x", value)),
				makeExpressionControl(document, position === MIXED ? MIXED : position[1], value => this.onChange("y", value)),
			);
			wrapper.append(pair);
			wrapper.querySelectorAll("input").forEach(input => input.disabled = attached === true);
			group.append(this.#row("field.position", wrapper));
		}

		if (selected.every(event => DURATION_TYPES.has(event.type))) {
			group.append(this.#row("field.duration", makeRationalControl(document,
				commonValue(selected, event => event.duration), value => {
					const comparison = Rational.from(value).compare(0);
					if (comparison > 0 || comparison === 0 && selected.every(event => ZERO_DURATION_TYPES.has(event.type))) {
						this.onChange("duration", value);
					}
			})));
			group.append(this.#row("field.endTime", makeRationalControl(document,
				commonValue(selected, event => Rational.from(event.time).add(event.duration || 0).toJSON()), value => {
					const end = Rational.from(value);
					const valid = selected.every(event => {
						const comparison = end.compare(event.time);
						return comparison > 0 || comparison === 0 && ZERO_DURATION_TYPES.has(event.type);
					});
					if (valid) this.onChange("endTime", value);
				})));
		}
		if (selected.every(event => TEXT_TYPES.has(event.type))) {
			group.append(this.#row("field.text", makeInput(document, "text",
				commonValue(selected, event => event.text), value => this.onChange("text", value))));
		}
		if (selected.every(event => event.type === "flick")) {
			const radians = commonValue(selected, event => event.angle);
			group.append(this.#row("field.direction", makeAngleControl(document, radians,
				value => this.onChange("angle", value), this.i18n)));
		}
		if (selected.every(event => TIP_TYPES.has(event.type))) {
			const modes = ["inherit", "chain", "drop", "none"].map(value => ({
				value, label: this.i18n.t(`tipPoint.${value}`),
			}));
			const spawnType = commonValue(selected, event => event.tipPointSpawnType);
			const spawnFieldsEnabled = spawnType === "chain" || spawnType === "drop";
			group.append(this.#row("field.spawnType", makeSelect(document, modes,
				spawnType,
				value => this.onChange("tipPointSpawnType", value))));
			const absolute = commonValue(selected, event => event.tipPointSpawnAbsolutePosition);
			const spawnPositionControl = makeRadioControl(document, [
				{ value: "absolute", label: this.i18n.t("field.absolute") },
				{ value: "relative", label: this.i18n.t("field.relative") },
			], absolute === MIXED ? MIXED : absolute ? "absolute" : "relative",
			value => this.onChange("tipPointSpawnAbsolutePosition", value === "absolute"));
			setControlHidden(spawnPositionControl, !spawnFieldsEnabled);
			group.append(this.#row("field.spawnPosition", spawnPositionControl));

			const attached = commonValue(selected, event => event.tipPointSpawnAttached);
			const attachedControl = makeInput(document, "checkbox", attached,
				value => this.onChange("tipPointSpawnAttached", value));
			attachedControl.indeterminate = attached === MIXED;
			setControlHidden(attachedControl, !spawnFieldsEnabled || absolute !== true || !model.snappees.length);
			group.append(this.#row("field.attached", attachedControl));

			const absolutePosition = commonValue(selected, event => [event.tipPointSpawnX, event.tipPointSpawnY]);
			const absoluteWrapper = document.createElement("div");
			absoluteWrapper.className = "attached-input";
			const spawnSnappeeId = commonValue(selected, event => event.tipPointSpawnSnappee);
			if (absolute === true && attached === true && spawnSnappeeId !== MIXED) {
				const snappee = model.snappees.find(item => item.id === spawnSnappeeId);
				if (snappee) absoluteWrapper.append(makeSnappeePreview(document, snappee, 22));
			}
			const absolutePair = document.createElement("div");
			absolutePair.className = "pair-input";
			absolutePair.append(
				makeExpressionControl(document, absolutePosition === MIXED ? MIXED : absolutePosition[0], value => this.onChange("tipPointSpawnX", value)),
				makeExpressionControl(document, absolutePosition === MIXED ? MIXED : absolutePosition[1], value => this.onChange("tipPointSpawnY", value)),
			);
			absoluteWrapper.append(absolutePair);
			setControlHidden(absoluteWrapper, !spawnFieldsEnabled || absolute !== true || attached === true);
			group.append(this.#row("field.absolute", absoluteWrapper));

			if (attached === true) {
				const snappeeControl = makeSelect(document,
					model.snappees.map(snappee => ({ value: snappee.id, label: snappee.name })), spawnSnappeeId,
					value => this.onChange("tipPointSpawnSnappee", Number(value)));
				setControlHidden(snappeeControl, !spawnFieldsEnabled || absolute !== true);
				group.append(this.#row("field.snappee", snappeeControl));
				const targetSnappee = spawnSnappeeId === MIXED ? null : model.snappees.find(snappee => snappee.id === spawnSnappeeId);
				const snapPoint = commonValue(selected, event => event.tipPointSpawnSnapPoint);
				if (targetSnappee?.type.endsWith("Mesh")) {
					const pair = Array.isArray(snapPoint) ? snapPoint : [0, 0];
					const wrapper = document.createElement("div");
					wrapper.className = "pair-input";
					const update = (index, value) => {
						const next = [...pair];
						next[index] = Math.round(value);
						this.onChange("tipPointSpawnSnapPoint", next);
					};
					wrapper.append(makeInput(document, "number", snapPoint === MIXED ? MIXED : pair[0], value => update(0, value), { step: "1" }),
						makeInput(document, "number", snapPoint === MIXED ? MIXED : pair[1], value => update(1, value), { step: "1" }));
					setControlHidden(wrapper, !spawnFieldsEnabled || absolute !== true);
					group.append(this.#row("field.snapPoint", wrapper));
				} else {
					const control = makeInput(document, "number", snapPoint,
						value => this.onChange("tipPointSpawnSnapPoint", Math.round(value)), { step: "1" });
					setControlHidden(control, !spawnFieldsEnabled || absolute !== true);
					group.append(this.#row("field.snapPoint", control));
				}
			}

			const distanceControl = makeExpressionControl(document,
				commonValue(selected, event => event.tipPointSpawnDistance),
				value => this.onChange("tipPointSpawnDistance", Math.max(0, value)));
			setControlHidden(distanceControl, !spawnFieldsEnabled || absolute !== false);
			group.append(this.#row("field.spawnDistance", distanceControl));
			const directionControl = makeAngleControl(document,
				commonValue(selected, event => event.tipPointSpawnAngle),
				value => this.onChange("tipPointSpawnAngle", value), this.i18n);
			setControlHidden(directionControl, !spawnFieldsEnabled || absolute !== false);
			group.append(this.#row("field.spawnDirection", directionControl));

			const timeInBeats = commonValue(selected, event => event.tipPointSpawnTimeBeats);
			const spawnUnitControl = makeRadioControl(document, [
				{ value: "seconds", label: this.i18n.t("field.seconds") },
				{ value: "beats", label: this.i18n.t("field.beats") },
			], timeInBeats === MIXED ? MIXED : timeInBeats ? "beats" : "seconds",
			value => this.onChange("tipPointSpawnTimeBeats", value === "beats"));
			setControlHidden(spawnUnitControl, !spawnFieldsEnabled);
			group.append(this.#row("field.spawnUnit", spawnUnitControl));
			const spawnTime = commonValue(selected, event => event.tipPointSpawnTime);
			const secondsControl = makeExpressionControl(document,
				timeInBeats === false ? spawnTime : timeInBeats === MIXED ? MIXED : "",
				value => this.onChange("tipPointSpawnTime", Math.max(0, value)));
			setControlHidden(secondsControl, !spawnFieldsEnabled || timeInBeats !== false);
			group.append(this.#row("field.spawnTimeSeconds", secondsControl));
			const beatsControl = makeRationalControl(document,
				timeInBeats === true ? spawnTime : timeInBeats === MIXED ? MIXED : [0, 0, 1],
				value => this.onChange("tipPointSpawnTime", value));
			setControlHidden(beatsControl, !spawnFieldsEnabled || timeInBeats !== true);
			group.append(this.#row("field.spawnTimeBeats", beatsControl));
		}
		if (model.editor.readOnly) {
			if (!commentsOnly) group.disabled = true;
			else if (typeControl) setControlDisabled(typeControl, true);
		}
		this.element.append(group);
	}
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
		this.cleanup = [];
	}

	#action(icon, tooltipKey, callback, disabled = false, action = null) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "snappee-action";
		button.disabled = disabled;
		if (action) button.dataset.snappeeAction = action;
		button.setAttribute("aria-label", this.i18n.t(tooltipKey));
		const image = document.createElement("img");
		image.src = `svg/icons/${icon}.svg`;
		image.alt = "";
		image.draggable = false;
		button.append(image);
		button.addEventListener("click", event => {
			event.stopPropagation();
			if (!button.disabled) callback();
		});
		this.cleanup.push(this.tooltip?.register(button, tooltipKey));
		return button;
	}

	#syncToggle(button, snappee) {
		const icon = snappee.active === false ? "activate" : "deactivate";
		const tooltipKey = snappee.active === false ? "panel.snappee.activate" : "panel.snappee.deactivate";
		const image = button.querySelector("img");
		if (image) image.src = `svg/icons/${icon}.svg`;
		button.setAttribute("aria-label", this.i18n.t(tooltipKey));
		this.tooltip?.register(button, tooltipKey);
	}

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
			if (toggle) this.#syncToggle(toggle, snappee);
		}
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
			const item = document.createElement("div");
			item.dataset.snappeeId = String(snappee.id);
			item.className = `snappee-item${snappee.selected ? " is-selected" : ""}${snappee.active === false ? " is-inactive" : ""}`;
			item.tabIndex = readOnly ? -1 : 0;
			item.setAttribute("aria-disabled", String(readOnly));
			item.setAttribute("role", "button");
			item.setAttribute("aria-pressed", String(Boolean(snappee.selected)));
			const preview = makeSnappeePreview(document, snappee, 24);
			const name = document.createElement("span");
			name.className = "snappee-name";
			name.textContent = snappee.name;
			item.append(preview, name,
				this.#action(snappee.active === false ? "activate" : "deactivate", snappee.active === false ? "panel.snappee.activate" : "panel.snappee.deactivate",
					() => this.onToggle(snappee.id), false, "toggle"),
				this.#action("duplicate", "panel.snappee.duplicate", () => this.onDuplicate(snappee.id), readOnly),
				this.#action("up", "panel.snappee.moveUp", () => this.onMove(snappee.id, -1), readOnly || index === 0),
				this.#action("down", "panel.snappee.moveDown", () => this.onMove(snappee.id, 1), readOnly || index === model.snappees.length - 1),
				this.#action("edit", "panel.snappee.edit", () => this.onEdit(snappee.id), readOnly),
				this.#action("delete", "panel.snappee.delete", () => this.onDelete(snappee.id), readOnly),
			);
			item.addEventListener("click", () => {
				if (!readOnly && snappee.active !== false) this.onSelect(snappee.id);
			});
			item.addEventListener("dblclick", () => { if (!readOnly) this.onEdit(snappee.id); });
			item.addEventListener("keydown", event => {
				if (!readOnly && event.key === "Enter") this.onEdit(snappee.id);
			});
			this.cleanup.push(this.tooltip?.register(item, "panel.snappee.edit"));
			this.element.append(item);
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
		this.onDuplicate = options.onDuplicate || (() => {});
		this.onDelete = options.onDelete || (() => {});
		this.onEdit = options.onEdit || (() => {});
		this.onMove = options.onMove || (() => {});
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
			if (!button.disabled) callback();
		});
		this.cleanup.push(this.tooltip?.register(button, tooltipKey));
		return button;
	}

	render(model, context = {}) {
		const readOnly = Boolean(context.readOnly);
		this.cleanup.forEach(dispose => dispose?.());
		this.cleanup = [];
		clear(this.element);
		model.channels.forEach((channel, index) => {
			const item = document.createElement("div");
			item.className = `snappee-item channel-item${channel.id === model.editor.currentChannel ? " is-selected" : ""}${channel.active === false ? " is-inactive" : ""}`;
			item.tabIndex = 0;
			item.setAttribute("role", "button");
			item.setAttribute("aria-pressed", String(channel.id === model.editor.currentChannel));
			const ordinal = document.createElement("span");
			ordinal.className = "channel-index";
			ordinal.textContent = String(index + 1);
			const name = document.createElement("span");
			name.className = "snappee-name";
			name.textContent = String(channel.name || `Channel ${index + 1}`);
			item.append(ordinal, name,
				this.#action(channel.active === false ? "activate" : "deactivate",
					channel.active === false ? "panel.channel.activate" : "panel.channel.deactivate",
					() => this.onToggle(channel.id), false),
				this.#action("duplicate", "panel.channel.duplicate", () => this.onDuplicate(channel.id), readOnly),
				this.#action("up", "panel.channel.moveUp", () => this.onMove(channel.id, -1), readOnly || index === 0),
				this.#action("down", "panel.channel.moveDown", () => this.onMove(channel.id, 1), readOnly || index === model.channels.length - 1),
				this.#action("edit", "panel.channel.rename", () => this.onEdit(channel.id), readOnly),
				this.#action("delete", "panel.channel.delete", () => this.onDelete(channel.id), readOnly || model.channels.length <= 1),
			);
			item.addEventListener("click", () => {
				if (channel.active !== false) this.onSelect(channel.id);
			});
			item.addEventListener("dblclick", () => { if (!readOnly) this.onEdit(channel.id); });
			item.addEventListener("keydown", event => {
				if (!readOnly && event.key === "Enter") this.onEdit(channel.id);
			});
			this.cleanup.push(this.tooltip?.register(item, "panel.channel.edit"));
			this.element.append(item);
		});
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
		button.addEventListener("click", event => { event.stopPropagation(); if (!button.disabled) callback(); });
		this.cleanup.push(this.tooltip?.register(button, tooltipKey));
		return button;
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
			const item = document.createElement("div");
			item.className = "snappee-item clip-item";
			item.tabIndex = 0;
			const canvas = document.createElement("canvas");
			canvas.className = "clip-thumbnail";
			drawClipThumbnail(canvas, clip.data);
			const name = document.createElement("span");
			name.className = "snappee-name";
			name.textContent = clip.name;
			item.append(canvas, name,
				this.#action("paste", "panel.clip.paste", () => this.onPaste(index), readOnly),
				this.#action("up", "panel.clip.moveUp", () => this.onMove(index, -1), readOnly || index === 0),
				this.#action("down", "panel.clip.moveDown", () => this.onMove(index, 1), readOnly || index === model.clips.length - 1),
				this.#action("edit", "panel.clip.edit", () => this.onEdit(index), readOnly),
				this.#action("delete", "panel.clip.delete", () => this.onDelete(index), readOnly),
			);
			item.addEventListener("dblclick", () => { if (!readOnly) this.onEdit(index); });
			this.element.append(item);
		});
	}
}

export class HistoryPanel {
	constructor(options = {}) {
		this.element = options.element || document.getElementById("history-list");
		this.i18n = options.i18n;
		this.tooltip = options.tooltip;
		this.onGoTo = options.onGoTo || (() => {});
		this.cleanup = [];
		this.language = null;
	}

	#entries(history) {
		return typeof history.panelEntries === "function" ? history.panelEntries() : history.entries;
	}

	#makeItem(entry, context = {}) {
		const readOnly = Boolean(context.readOnly);
		const button = document.createElement("button");
		button.type = "button";
		button.dataset.historyId = String(entry.id);
		button.disabled = readOnly;
		button.setAttribute("aria-disabled", String(readOnly));
		button.className = `history-item${entry.active ? " is-current" : ""}${entry.undone ? " is-future" : ""}`;
		const index = document.createElement("span");
		index.className = "history-index";
		index.textContent = entry.active ? "›" : "";
		const label = document.createElement("span");
		label.className = "history-label";
		label.textContent = this.i18n.localize(entry.label);
		const markers = document.createElement("span");
		markers.className = "history-markers";
		for (const kind of ["save", "autosave"]) {
			if (!entry.metadata?.historyMarkers?.[kind]) continue;
			const image = document.createElement("img");
			image.src = `svg/icons/${kind === "save" ? "save" : "auto-save"}.svg`;
			image.className = `history-marker is-${kind}`;
			image.alt = this.i18n.t(`history.marker.${kind}`);
			markers.append(image);
		}
		const time = document.createElement("time");
		time.className = "history-time";
		time.dateTime = new Date(entry.timestamp).toISOString();
		time.textContent = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		button.append(index, label, markers, time);
		button.addEventListener("click", () => this.onGoTo(entry.index));
		const dispose = this.tooltip?.register(button, "panel.history.seek");
		button._disposeTooltip = dispose;
		this.cleanup.push(dispose);
		return button;
	}

	#paint(entries, context = {}, relocalize = false) {
		const readOnly = Boolean(context.readOnly);
		let current = null;
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const button = this.element.children[index];
			if (!button) continue;
			button.disabled = readOnly;
			button.setAttribute("aria-disabled", String(readOnly));
			button.classList.toggle("is-current", Boolean(entry.active));
			button.classList.toggle("is-future", Boolean(entry.undone));
			const marker = button.querySelector(".history-index");
			if (marker) marker.textContent = entry.active ? "›" : "";
			if (relocalize) {
				const label = button.querySelector(".history-label");
				if (label) label.textContent = this.i18n.localize(entry.label);
			}
			const markers = button.querySelector(".history-markers");
			if (markers) {
				markers.replaceChildren();
				for (const kind of ["save", "autosave"]) {
					if (!entry.metadata?.historyMarkers?.[kind]) continue;
					const image = document.createElement("img");
					image.src = `svg/icons/${kind === "save" ? "save" : "auto-save"}.svg`;
					image.className = `history-marker is-${kind}`;
					image.alt = this.i18n.t(`history.marker.${kind}`);
					markers.append(image);
				}
			}
			if (entry.active) current = button;
		}
		current?.scrollIntoView({ block: "nearest" });
	}

	render(history, context = {}) {
		this.sync(history, context);
	}

	sync(history, context = {}) {
		const entries = this.#entries(history);
		const relocalize = this.language !== this.i18n.language;
		this.language = this.i18n.language;
		let prefix = 0;
		const limit = Math.min(this.element.children.length, entries.length);
		while (prefix < limit && this.element.children[prefix].dataset.historyId === String(entries[prefix].id)) {
			prefix += 1;
		}
		for (let index = this.element.children.length - 1; index >= prefix; index -= 1) {
			const button = this.element.children[index];
			button._disposeTooltip?.();
			button.remove();
		}
		this.cleanup = this.cleanup.slice(0, prefix);
		for (let index = prefix; index < entries.length; index += 1) {
			this.element.append(this.#makeItem(entries[index], context));
		}
		this.#paint(entries, context, relocalize);
	}
}
