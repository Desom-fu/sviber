import { Rational } from "./core/rational.js";
import { resolveAttachedPosition, sampleSnappee } from "./core/geometry.js";

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
	controls.forEach(input => input.addEventListener("change", emit));
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
	input.addEventListener("change", () => {
		if (type === "checkbox") onChange(input.checked);
		else if (type === "number") {
			const number = Number(input.value);
			if (Number.isFinite(number)) onChange(number);
		} else onChange(input.value);
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
	input.addEventListener("change", () => {
		const number = evaluateExpression(input.value);
		if (number != null) onChange(number);
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
		y: offsetY + (point.y - minY) * scale,
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
		const selected = model.events.filter(event => event.selected);
		if (!selected.length) {
			return;
		}
		if (Array.isArray(context.transform)) {
			const transformGroup = this.#group("field.transform");
			const wrapper = document.createElement("div");
			wrapper.className = "matrix-input";
			const keys = ["field.matrixA", "field.matrixB", "field.matrixC", "field.matrixD", "field.matrixTx", "field.matrixTy"];
			context.transform.forEach((value, index) => {
				const input = makeInput(document, "number", value, next => this.onTransformChange(index, next), { step: "any" });
				input.setAttribute("aria-label", this.i18n.t(keys[index]));
				input.title = this.i18n.t(keys[index]);
				wrapper.append(input);
			});
			transformGroup.append(this.#row("field.transform", wrapper));
			this.element.append(transformGroup);
		}

		const group = this.#group(selected.every(event => event.type === selected[0].type)
			? `event.${selected[0].type}` : "panel.commonProperties");
		const types = commonValue(selected, event => event.type);
		group.append(this.#row("field.type", makeSelect(document, [
			"tap", "hold", "drag", "flick", "bgNote", "bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram", "comment",
		].map(type => ({ value: type, label: this.i18n.t(`event.${type}`) })), types,
		value => this.onChange("type", value))));

		const time = commonValue(selected, event => event.time);
		group.append(this.#row("field.time", makeRationalControl(document, time,
			value => this.onChange("time", value))));
		const channel = commonValue(selected, event => event.channel);
		group.append(this.#row("field.channel", makeSelect(document,
			model.channels.map((item, index) => ({ item, index }))
				.filter(({ item }) => item.active !== false)
				.map(({ item, index }) => ({ value: item.id, label: String(index + 1) })), channel,
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
			group.append(this.#row("field.spawnType", makeSelect(document, modes,
				commonValue(selected, event => event.tipPointSpawnType),
				value => this.onChange("tipPointSpawnType", value))));
			const absolute = commonValue(selected, event => event.tipPointSpawnAbsolutePosition);
			group.append(this.#row("field.spawnPosition", makeRadioControl(document, [
				{ value: "absolute", label: this.i18n.t("field.absolute") },
				{ value: "relative", label: this.i18n.t("field.relative") },
			], absolute === MIXED ? MIXED : absolute ? "absolute" : "relative",
			value => this.onChange("tipPointSpawnAbsolutePosition", value === "absolute"))));

			const attached = commonValue(selected, event => event.tipPointSpawnAttached);
			const attachedControl = makeInput(document, "checkbox", attached,
				value => this.onChange("tipPointSpawnAttached", value));
			attachedControl.indeterminate = attached === MIXED;
			setControlDisabled(attachedControl, absolute !== true || !model.snappees.length);
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
			setControlDisabled(absoluteWrapper, absolute !== true || attached === true);
			group.append(this.#row("field.absolute", absoluteWrapper));

			if (attached === true) {
				const snappeeControl = makeSelect(document,
					model.snappees.map(snappee => ({ value: snappee.id, label: snappee.name })), spawnSnappeeId,
					value => this.onChange("tipPointSpawnSnappee", Number(value)));
				setControlDisabled(snappeeControl, absolute !== true);
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
					setControlDisabled(wrapper, absolute !== true);
					group.append(this.#row("field.snapPoint", wrapper));
				} else {
					const control = makeInput(document, "number", snapPoint,
						value => this.onChange("tipPointSpawnSnapPoint", Math.round(value)), { step: "1" });
					setControlDisabled(control, absolute !== true);
					group.append(this.#row("field.snapPoint", control));
				}
			}

			const distanceControl = makeExpressionControl(document,
				commonValue(selected, event => event.tipPointSpawnDistance),
				value => this.onChange("tipPointSpawnDistance", Math.max(0, value)));
			setControlDisabled(distanceControl, absolute !== false);
			group.append(this.#row("field.spawnDistance", distanceControl));
			const directionControl = makeAngleControl(document,
				commonValue(selected, event => event.tipPointSpawnAngle),
				value => this.onChange("tipPointSpawnAngle", value), this.i18n);
			setControlDisabled(directionControl, absolute !== false);
			group.append(this.#row("field.spawnDirection", directionControl));

			const timeInBeats = commonValue(selected, event => event.tipPointSpawnTimeBeats);
			group.append(this.#row("field.spawnUnit", makeRadioControl(document, [
				{ value: "seconds", label: this.i18n.t("field.seconds") },
				{ value: "beats", label: this.i18n.t("field.beats") },
			], timeInBeats === MIXED ? MIXED : timeInBeats ? "beats" : "seconds",
			value => this.onChange("tipPointSpawnTimeBeats", value === "beats"))));
			const spawnTime = commonValue(selected, event => event.tipPointSpawnTime);
			const secondsControl = makeExpressionControl(document,
				timeInBeats === false ? spawnTime : timeInBeats === MIXED ? MIXED : "",
				value => this.onChange("tipPointSpawnTime", Math.max(0, value)));
			setControlDisabled(secondsControl, timeInBeats !== false);
			group.append(this.#row("field.spawnTimeSeconds", secondsControl));
			const beatsControl = makeRationalControl(document,
				timeInBeats === true ? spawnTime : timeInBeats === MIXED ? MIXED : [0, 0, 1],
				value => this.onChange("tipPointSpawnTime", value));
			setControlDisabled(beatsControl, timeInBeats !== true);
			group.append(this.#row("field.spawnTimeBeats", beatsControl));
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
		this.cleanup = [];
	}

	#action(icon, tooltipKey, callback) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "snappee-action";
		button.setAttribute("aria-label", this.i18n.t(tooltipKey));
		const image = document.createElement("img");
		image.src = `svg/icons/${icon}.svg`;
		image.alt = "";
		image.draggable = false;
		button.append(image);
		button.addEventListener("click", event => {
			event.stopPropagation();
			callback();
		});
		this.cleanup.push(this.tooltip?.register(button, tooltipKey));
		return button;
	}

	render(model) {
		this.cleanup.forEach(dispose => dispose?.());
		this.cleanup = [];
		clear(this.element);
		if (!model.snappees.length) {
			const empty = document.createElement("div");
			empty.className = "empty-panel";
			empty.textContent = this.i18n.t("panel.noSnappees");
			this.element.append(empty);
			return;
		}
		for (const snappee of model.snappees) {
			const item = document.createElement("div");
			item.className = `snappee-item${snappee.selected ? " is-selected" : ""}${snappee.active === false ? " is-inactive" : ""}`;
			item.tabIndex = 0;
			item.setAttribute("role", "button");
			item.setAttribute("aria-pressed", String(Boolean(snappee.selected)));
			const preview = makeSnappeePreview(document, snappee, 24);
			const name = document.createElement("span");
			name.className = "snappee-name";
			name.textContent = snappee.name;
			item.append(preview, name,
				this.#action(snappee.active === false ? "activate" : "deactivate", snappee.active === false ? "panel.snappee.activate" : "panel.snappee.deactivate",
					() => this.onToggle(snappee.id)),
				this.#action("duplicate", "panel.snappee.duplicate", () => this.onDuplicate(snappee.id)),
				this.#action("delete", "panel.snappee.delete", () => this.onDelete(snappee.id)),
			);
			item.addEventListener("click", () => {
				if (snappee.active !== false) this.onSelect(snappee.id);
			});
			item.addEventListener("dblclick", () => this.onEdit(snappee.id));
			item.addEventListener("keydown", event => {
				if (event.key === "Enter") this.onEdit(snappee.id);
			});
			this.cleanup.push(this.tooltip?.register(item, "panel.snappee.edit"));
			this.element.append(item);
		}
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

	render(model) {
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
					() => this.onToggle(channel.id)),
				this.#action("duplicate", "panel.channel.duplicate", () => this.onDuplicate(channel.id)),
				this.#action("move-channel-up", "panel.channel.moveUp", () => this.onMove(channel.id, -1), index === 0),
				this.#action("move-channel-down", "panel.channel.moveDown", () => this.onMove(channel.id, 1), index === model.channels.length - 1),
				this.#action("edit", "panel.channel.rename", () => this.onEdit(channel.id)),
				this.#action("delete", "panel.channel.delete", () => this.onDelete(channel.id), model.channels.length <= 1),
			);
			item.addEventListener("click", () => {
				if (channel.active !== false) this.onSelect(channel.id);
			});
			item.addEventListener("dblclick", () => this.onEdit(channel.id));
			item.addEventListener("keydown", event => {
				if (event.key === "Enter") this.onEdit(channel.id);
			});
			this.cleanup.push(this.tooltip?.register(item, "panel.channel.edit"));
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
	}

	render(history) {
		this.cleanup.forEach(dispose => dispose?.());
		this.cleanup = [];
		clear(this.element);
		for (const entry of history.entries) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = `history-item${entry.active ? " is-current" : ""}${entry.undone ? " is-future" : ""}`;
			const index = document.createElement("span");
			index.className = "history-index";
			index.textContent = entry.active ? "›" : "";
			const label = document.createElement("span");
			label.textContent = entry.label;
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
			this.cleanup.push(this.tooltip?.register(button, "panel.history.seek"));
			this.element.append(button);
		}
		this.element.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
	}
}
