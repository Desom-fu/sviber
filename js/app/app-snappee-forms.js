// Snappee create/edit forms: field lists, default values, conversion from
// form values, and SVG path import for pen curves.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { SNAPPEE_PRESETS, createPresetSnappee } from "../core/snappee-presets.js";
import { penPathFieldDefinition } from "../ui/pen-path-field.js";
import { createFieldControl } from "../ui/ui-fields.js";
import { SNAPPEE_COLORS, deepClone, evaluateExpression, localizedErrorMessage } from "./app-helpers.js";

function pairField(id, labelKey, extra = {}) {
	return { id, type: "pair", labelKey, expression: true, required: true, ...extra };
}

function extraSnappeeFields(type) {
	const tables = {
		rectangularMesh: () => [
			pairField("topLeft", "field.topLeft"),
			pairField("bottomRight", "field.bottomRight"),
			{ id: "tiles", type: "pair", labelKey: "field.tiles", numeric: true, integer: true },
		],
		radialMesh: () => [
			pairField("center", "field.center"),
			{ id: "radius", type: "expression", labelKey: "field.radius", required: true },
			{ id: "tiles", type: "pair", labelKey: "field.tiles", numeric: true, integer: true },
			{ id: "startingAngle", type: "angle", labelKey: "field.direction" },
		],
		parametricMesh: () => [
			{ id: "iRange", type: "range", labelKey: "field.iRange" },
			{ id: "jRange", type: "range", labelKey: "field.jRange" },
			{ id: "xExpression", type: "text", labelKey: "field.xExpression", required: true },
			{ id: "yExpression", type: "text", labelKey: "field.yExpression", required: true },
		],
		regularPolygonCurve: () => [
			pairField("center", "field.center"),
			{ id: "radius", type: "expression", labelKey: "field.radius", required: true },
			{ id: "sides", type: "integer", labelKey: "field.sides", positive: true, min: 3 },
			{ id: "angle", type: "angle", labelKey: "field.direction" },
			{ id: "segmentsPerSide", type: "integer", labelKey: "field.segmentsPerSide", positive: true, min: 1 },
		],
		parametricCurve: () => [
			{ id: "iRange", type: "range", labelKey: "field.iRange" },
			{ id: "xExpression", type: "text", labelKey: "field.xExpression", required: true },
			{ id: "yExpression", type: "text", labelKey: "field.yExpression", required: true },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
		],
		bezierCurve: () => [
			{
				id: "controlPoints",
				type: "array",
				itemType: "pair",
				item: { expression: true, required: true },
				labelKey: "field.controlPoints",
				stacked: true,
				minItems: 2,
				newItem: [0, 0],
			},
			{ id: "segments", type: "integer", labelKey: "field.segments", positive: true, min: 1 },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
		],
		circularArcCurve: () => [
			pairField("center", "field.center"),
			{ id: "radius", type: "expression", labelKey: "field.radius", required: true },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
			{ id: "beginningAngle", type: "angle", labelKey: "field.beginningAngle", required: true },
			{
				id: "endAngle",
				type: "angle",
				labelKey: "field.endAngle",
				required: true,
				disabled: values => values.closed,
			},
			{ id: "clockwise", type: "checkbox", labelKey: "field.clockwise", disabled: values => values.closed },
			{ id: "segments", type: "integer", labelKey: "field.segments", positive: true, min: 1 },
		],
	};
	return (tables[type] || (() => []))();
}

function penCommandType(command, index) {
	if (index === 0) {
		return "M";
	}
	const type = String(command.type || "L").toUpperCase();
	return ["L", "Q", "C"].includes(type) ? type : "L";
}

function degrees(radians, fallback = 0) {
	return { value: ((radians ?? fallback) * 180) / Math.PI, radians: false };
}

function assignSnappeeFormValues(type, source, values) {
	const tables = {
		rectangularMesh: () => ({
			topLeft: [source.topLeftX ?? -100, source.topLeftY ?? 50],
			bottomRight: [source.bottomRightX ?? 100, source.bottomRightY ?? -50],
			tiles: [source.horizontalTiles ?? 16, source.verticalTiles ?? 8],
		}),
		radialMesh: () => ({
			center: [source.centerX ?? 0, source.centerY ?? 0],
			radius: source.radius ?? "50",
			tiles: [source.azimuthalTiles ?? 8, source.radialTiles ?? 4],
			startingAngle: degrees(source.startingAngle),
		}),
		parametricMesh: () => ({
			iRange: {
				min: source.iRange?.[0] ?? -4,
				max: source.iRange?.[1] ?? 5,
				exclusive: source.iRangeExclusive ?? true,
			},
			jRange: {
				min: source.jRange?.[0] ?? -2,
				max: source.jRange?.[1] ?? 3,
				exclusive: source.jRangeExclusive ?? true,
			},
			xExpression: source.xExpression || "i * 25",
			yExpression: source.yExpression || "j * 25",
		}),
		regularPolygonCurve: () => ({
			center: [source.centerX ?? 0, source.centerY ?? 0],
			radius: source.radius ?? "50",
			sides: source.sides ?? 5,
			angle: degrees(source.angle, Math.PI / 2),
			segmentsPerSide: source.segmentsPerSide ?? 4,
		}),
		parametricCurve: () => ({
			iRange: {
				min: source.iRange?.[0] ?? 0,
				max: source.iRange?.[1] ?? 16,
				exclusive: source.iRangeExclusive ?? true,
			},
			xExpression: source.xExpression || "50 * cos(2 * pi * i / 16)",
			yExpression: source.yExpression || "50 * sin(2 * pi * i / 16)",
			closed: source.closed ?? true,
		}),
		bezierCurve: () => ({
			controlPoints: (source.controlPoints || [{ x: -50, y: 0 }, { x: 50, y: 0 }]).map(point => [
				point.x,
				point.y,
			]),
			segments: source.segments ?? 16,
			closed: source.closed ?? false,
		}),
		circularArcCurve: () => ({
			center: [source.centerX ?? 0, source.centerY ?? 0],
			radius: source.radius ?? "50",
			closed: source.closed ?? false,
			beginningAngle: degrees(source.beginningAngle),
			endAngle: degrees(source.endAngle, Math.PI),
			clockwise: source.clockwise ?? false,
			segments: source.segments ?? 16,
		}),
		penCurve: () => ({
			commands: (source.commands || [
				{ type: "M", x: -50, y: 0 },
				{ type: "L", x: 50, y: 0 },
			]).map(command => ({
				type: String(command.type || "L").toUpperCase(),
				x: command.x ?? 0,
				y: command.y ?? 0,
				x1: command.x1 ?? command.x ?? 0,
				y1: command.y1 ?? command.y ?? 0,
				x2: command.x2 ?? command.x ?? 0,
				y2: command.y2 ?? command.y ?? 0,
			})),
			segments: source.segments ?? 16,
			closed: source.closed ?? false,
		}),
	};
	const extra = tables[type];
	if (extra) {
		Object.assign(values, extra());
	}
}

class SnappeeFormsTrait {
	uniqueSnappeeName(base) {
		const names = new Set(this.model.snappees.map(snappee => snappee.name));
		if (!names.has(base)) {
			return base;
		}
		let suffix = 2;
		while (names.has(`${base} ${suffix}`)) {
			suffix += 1;
		}
		return `${base} ${suffix}`;
	}

	defaultSnappeeName(type) {
		const base = i18n.t(`snappee.${type}`);
		let index = 1;
		const names = new Set(this.model.snappees.map(snappee => snappee.name));
		while (names.has(`${base} ${index}`)) {
			index += 1;
		}
		return `${base} ${index}`;
	}

	async showPresetSnappeeDialog() {
		const values = await this.dialogs.form({
			titleKey: "dialog.presetSnappee",
			values: { preset: SNAPPEE_PRESETS[0].id },
			fields: [
				{
					id: "preset",
					type: "select",
					labelKey: "field.presetSnappee",
					options: SNAPPEE_PRESETS.map(preset => ({
						value: preset.id,
						labelKey: `snappee.preset.${preset.id}`,
					})),
				},
			],
		});
		if (!values) {
			return null;
		}
		const name = this.uniqueSnappeeName(i18n.t(`snappee.preset.${values.preset}`));
		let created = null;
		this.commit(i18n.t("command.snappee.preset"), model => {
			for (const snappee of model.snappees) {
				snappee.selected = false;
			}
			created = model.addSnappee(createPresetSnappee(values.preset, name));
			created.selected = true;
		});
		return created?.id ?? null;
	}

	snappeeFields(type, editing = false) {
		const fields = [
			{ id: "name", type: "text", labelKey: "field.name", required: true },
			{ id: "color", type: "color", labelKey: "field.color", required: true },
			...extraSnappeeFields(type),
		];
		if (type === "penCurve") {
			fields.push(
				{
					id: "commands",
					type: "array",
					labelKey: "field.commands",
					stacked: true,
					minItems: 2,
					newItem: { type: "L", x: 0, y: 0, x1: 0, y1: 0, x2: 0, y2: 0 },
					fields: [
						{ id: "type", type: "select", labelKey: "field.command", options: ["M", "L", "Q", "C"] },
						{ id: "x", type: "expression", labelKey: "field.endX", required: true },
						{ id: "y", type: "expression", labelKey: "field.endY", required: true },
						{ id: "x1", type: "expression", labelKey: "field.control1X", required: true },
						{ id: "y1", type: "expression", labelKey: "field.control1Y", required: true },
						{ id: "x2", type: "expression", labelKey: "field.control2X", required: true },
						{ id: "y2", type: "expression", labelKey: "field.control2Y", required: true },
					],
				},
				{ id: "segments", type: "integer", labelKey: "field.segments", positive: true, min: 1 },
				{ id: "closed", type: "checkbox", labelKey: "field.closed" },
				penPathFieldDefinition({
					readValues: () => this.dialogs.readValues(),
					onImport: parsed => this.applyPenPathImport(parsed),
					onError: error =>
						this.toast.error("toast.svgPathImportFailed", { message: localizedErrorMessage(error) }),
					onCopy: () => this.toast.show("toast.svgPathCopied"),
				}),
			);
		}
		fields.push({ id: "transformation", type: "matrix", labelKey: "field.transform", numeric: true });
		return fields;
	}

	snappeeFormValues(type, snappee = null) {
		const source = snappee || {};
		const values = {
			...deepClone(source),
			name: source.name || this.defaultSnappeeName(type),
			color: source.color || SNAPPEE_COLORS[this.model.snappees.length % SNAPPEE_COLORS.length],
			transformation: source.transformation || [1, 0, 0, 1, 0, 0],
		};
		assignSnappeeFormValues(type, source, values);
		return values;
	}

	angleValue(value) {
		const number = evaluateExpression(value?.value, 0);
		return value?.radians ? number : (number * Math.PI) / 180;
	}

	formToSnappee(type, values) {
		const result = {
			name: values.name,
			color: values.color,
			transformation: (values.transformation || [1, 0, 0, 1, 0, 0]).map(value => evaluateExpression(value)),
		};
		if (type === "rectangularMesh") {
			Object.assign(result, {
				topLeftX: evaluateExpression(values.topLeft[0]),
				topLeftY: evaluateExpression(values.topLeft[1]),
				bottomRightX: evaluateExpression(values.bottomRight[0]),
				bottomRightY: evaluateExpression(values.bottomRight[1]),
				horizontalTiles: Math.max(1, Math.floor(values.tiles[0])),
				verticalTiles: Math.max(1, Math.floor(values.tiles[1])),
			});
		} else if (type === "radialMesh") {
			Object.assign(result, {
				centerX: evaluateExpression(values.center[0]),
				centerY: evaluateExpression(values.center[1]),
				radius: Math.abs(evaluateExpression(values.radius, 50)),
				azimuthalTiles: Math.max(1, Math.floor(values.tiles[0])),
				radialTiles: Math.max(1, Math.floor(values.tiles[1])),
				startingAngle: this.angleValue(values.startingAngle),
			});
		} else if (type === "parametricMesh") {
			Object.assign(result, {
				iRange: [values.iRange.min, values.iRange.max],
				iRangeExclusive: values.iRange.exclusive,
				jRange: [values.jRange.min, values.jRange.max],
				jRangeExclusive: values.jRange.exclusive,
				xExpression: values.xExpression,
				yExpression: values.yExpression,
			});
		} else if (type === "regularPolygonCurve") {
			Object.assign(result, {
				centerX: evaluateExpression(values.center[0]),
				centerY: evaluateExpression(values.center[1]),
				radius: Math.abs(evaluateExpression(values.radius, 50)),
				sides: Math.max(3, Math.floor(values.sides)),
				angle: this.angleValue(values.angle),
				segmentsPerSide: Math.max(1, Math.floor(values.segmentsPerSide)),
				closed: true,
			});
		} else if (type === "parametricCurve") {
			Object.assign(result, {
				iRange: [values.iRange.min, values.iRange.max],
				iRangeExclusive: values.iRange.exclusive,
				xExpression: values.xExpression,
				yExpression: values.yExpression,
				closed: values.closed,
			});
		} else if (type === "bezierCurve") {
			Object.assign(result, {
				degree: Math.max(1, values.controlPoints.length - 1),
				controlPoints: values.controlPoints.map(point => ({
					x: evaluateExpression(point[0]),
					y: evaluateExpression(point[1]),
				})),
				segments: Math.max(1, Math.floor(values.segments)),
				closed: Boolean(values.closed),
			});
		} else if (type === "circularArcCurve") {
			Object.assign(result, {
				centerX: evaluateExpression(values.center[0]),
				centerY: evaluateExpression(values.center[1]),
				radius: Math.abs(evaluateExpression(values.radius, 50)),
				closed: Boolean(values.closed),
				beginningAngle: this.angleValue(values.beginningAngle),
				endAngle: this.angleValue(values.endAngle),
				clockwise: Boolean(values.clockwise),
				segments: Math.max(1, Math.floor(values.segments)),
			});
		} else if (type === "penCurve") {
			Object.assign(result, {
				commands: values.commands.map((command, index) => {
					const type = penCommandType(command, index);
					const item = { type, x: evaluateExpression(command.x), y: evaluateExpression(command.y) };
					if (type === "Q" || type === "C") {
						Object.assign(item, {
							x1: evaluateExpression(command.x1),
							y1: evaluateExpression(command.y1),
						});
					}
					if (type === "C") {
						Object.assign(item, {
							x2: evaluateExpression(command.x2),
							y2: evaluateExpression(command.y2),
						});
					}
					return item;
				}),
				segments: Math.max(1, Math.floor(values.segments)),
				closed: Boolean(values.closed),
			});
		}
		return result;
	}

	// v17: importing SVG path data replaces the command list of the open pen curve form.
	applyPenPathImport(parsed) {
		const active = this.dialogs.active;
		if (!active) {
			return false;
		}
		const commandsEntry = active.entries.find(entry => entry.field.id === "commands");
		const closedEntry = active.entries.find(entry => entry.field.id === "closed");
		if (!commandsEntry) {
			return false;
		}
		const environment = {
			document: document,
			i18n,
			tooltip: this.tooltip,
			onChange: () => this.dialogs.refreshDialogState(),
		};
		const replacement = createFieldControl({ ...commandsEntry.field }, parsed.commands, environment);
		commandsEntry.control.destroy?.();
		commandsEntry.control.element.replaceWith(replacement.element);
		commandsEntry.control = replacement;
		if (closedEntry) {
			const checkbox = closedEntry.control.element.querySelector?.("input[type=checkbox]");
			if (checkbox) {
				checkbox.checked = Boolean(parsed.closed);
			}
		}
		this.dialogs.refreshDialogState();
		for (const entry of active.entries) {
			entry.control.refresh?.();
		}
		this.toast.show("toast.svgPathImported");
		return true;
	}

	async showSnappeeDialog(type, id = null, options = {}) {
		this.exitModes();
		const source = id == null ? null : this.model.snappees.find(snappee => snappee.id === id);
		const values = await this.dialogs.form({
			titleKey: "dialog.editSnappee",
			values: this.snappeeFormValues(type, source),
			fields: this.snappeeFields(type, Boolean(source)),
			focusField: options.focusField,
		});
		if (!values) {
			return;
		}
		const data = this.formToSnappee(type, values);
		this.commit(source ? i18n.t("history.editSnappee") : i18n.t("history.createSnappee"), model => {
			if (source) {
				mutateSnappeeWithinBounds(model, id, snappee => {
					Object.assign(snappee, data);
				});
			} else {
				const created = model.addSnappee(type, data);
				for (const snappee of model.snappees) {
					snappee.selected = snappee.id === created.id;
				}
			}
		});
	}
}

export const withSnappeeForms = composeTraits("SnappeeFormsLayer", SnappeeFormsTrait);
