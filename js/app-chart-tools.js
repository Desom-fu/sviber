import { i18n } from "./i18n.js";
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
import { MOVABLE_TYPES, DURATION_TYPES, PATTERN_TYPES, SNAPPEE_COLORS, loadPreferences, storePreferences, deepClone, formatTime, formatBeat, evaluateExpression, selected, allowsOutOfBounds, pointAllowed, attachedMoveAllowed, attachedNotesStayWithinBounds, mutateSnappeeWithinBounds, constrainPastedEvent, difficultyColor, eventTypeLabel, localizedErrorMessage, localizedImportWarning, metadataFields, applyPresetDifficultyColor } from "./app-helpers.js";
import { SNAPPEE_PRESETS, createPresetSnappee } from "./core/snappee-presets.js";
import { eventTime, eventUsesChannel } from "./core/grouping.js";

export const withChartTools = Base => class extends Base {
	async showSelectionFilter() {
		const values = await this.dialogs.form({
			titleKey: "dialog.selectFilter",
			values: {
				enableTypes: true, enableText: false, text: "", enableTime: false,
				timeStart: [0, 0, 1], timeEnd: [9999, 0, 1], enableDuration: false,
				durationStart: [0, 0, 1], durationEnd: [9999, 0, 1], enableSimultaneous: false,
			},
			fields: [
				{ id: "enableTypes", type: "checkbox", labelKey: "field.types" },
				...EVENT_TYPES.map(type => ({ id: `type_${type}`, type: "checkbox", labelKey: `event.${type}`, default: true,
					disabled: values => !values.enableTypes })),
				{ id: "enableTime", type: "checkbox", labelKey: "field.timeRange" },
				{ id: "timeStart", type: "rational", labelKey: "field.time", disabled: values => !values.enableTime },
				{ id: "timeEnd", type: "rational", labelKey: "field.duration", disabled: values => !values.enableTime },
				{ id: "enableText", type: "checkbox", labelKey: "field.text" },
				{ id: "text", type: "text", labelKey: "field.text", disabled: values => !values.enableText },
				{ id: "enableDuration", type: "checkbox", labelKey: "field.durationRange" },
				{ id: "durationStart", type: "rational", labelKey: "field.time", disabled: values => !values.enableDuration },
				{ id: "durationEnd", type: "rational", labelKey: "field.duration", disabled: values => !values.enableDuration },
				{ id: "enableSimultaneous", type: "checkbox", labelKey: "field.hasSimultaneous" },
				...EVENT_TYPES.map(type => ({ id: `simultaneous_${type}`, type: "checkbox", labelKey: `event.${type}`, default: true,
					disabled: values => !values.enableSimultaneous })),
			],
		});
		if (!values) return;
		const activeChannels = new Set(this.model.channels
			.filter(channel => channel.active !== false).map(channel => channel.id));
		const candidates = this.model.allEvents().filter(event => eventUsesChannel(event, activeChannels));
		const simultaneousCounts = new Map();
		if (values.enableSimultaneous) {
			for (const event of candidates) {
				if (!values[`simultaneous_${event.type}`]) continue;
				const key = Rational.from(eventTime(event)).toString();
				simultaneousCounts.set(key, (simultaneousCounts.get(key) || 0) + 1);
			}
		}
		const ids = candidates.filter(event => {
			if (values.enableTypes && !values[`type_${event.type}`]) return false;
			if (values.enableTime) {
				const beat = Rational.from(eventTime(event));
				if (beat.compare(values.timeStart) < 0 || beat.compare(values.timeEnd) > 0) return false;
			}
			if (values.enableText && !String(event.text || "").toLocaleLowerCase().includes(String(values.text).toLocaleLowerCase())) return false;
			if (values.enableDuration) {
				if (!event.duration) return false;
				const duration = Rational.from(event.duration);
				if (duration.compare(values.durationStart) < 0 || duration.compare(values.durationEnd) > 0) return false;
			}
			if (values.enableSimultaneous) {
				const key = Rational.from(eventTime(event)).toString();
				const matching = (simultaneousCounts.get(key) || 0)
					- (values[`simultaneous_${event.type}`] ? 1 : 0);
				if (matching <= 0) return false;
			}
			return true;
		}).map(event => event.id);
		this.selectEvents(ids, "replace");
	}

	async showSubdivisionDialog() {
		const values = await this.dialogs.form({
			titleKey: "dialog.subdivision",
			values: { subdivision: this.model.editor.subdivision },
			fields: [{ id: "subdivision", type: "integer", labelKey: "dialog.subdivision", positive: true, min: 1 }],
		});
		if (values) this.setSubdivision(values.subdivision);
	}

	async showBackgroundPatternDialog() {
		this.exitModes();
		const patternOptions = ["bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"];
		const values = await this.dialogs.form({
			titleKey: "dialog.backgroundPattern",
			values: { type: "grid", duration: [1, 0, 1], text: "" },
			fields: [
				{ id: "type", type: "radio", labelKey: "field.type", options: patternOptions.map(value => ({ value, labelKey: `event.${value}` })) },
				{ id: "duration", type: "rational", labelKey: "field.duration", positive: true },
				{ id: "text", type: "text", labelKey: "field.text", disabled: form => form.type !== "bigText", required: true },
			],
		});
		if (!values) return;
		this.commit(i18n.t("history.createEvent", { type: eventTypeLabel(values.type) }), model => {
			for (const event of model.events) event.selected = false;
			model.addEvent(values.type, {
				time: this.currentBeat().toJSON(),
				channel: model.editor.currentChannel,
				duration: values.duration,
				text: values.type === "bigText" ? values.text : undefined,
				selected: true,
			});
		});
	}

	async showBpmDialog(index = null) {
		this.exitModes();
		const beat = this.currentBeat();
		if (index == null) index = this.model.timing.bpmChanges.findIndex(change => Rational.from(change.time).equals(beat));
		const current = index >= 0 ? this.model.timing.bpmChanges[index] : null;
		const eventBeat = current ? Rational.from(current.time) : beat;
		const values = await this.dialogs.form({
			titleKey: "dialog.bpmChange",
			values: { bpm: current?.bpm || this.model.timing.bpmAtBeat(beat) },
			fields: [
				{ id: "bpm", type: "number", labelKey: "field.bpm", positive: true, min: 0.001, step: "any" },
			],
		});
		if (!values) return;
		this.commit(i18n.t("dialog.bpmChange"), model => {
			const changes = model.timing.toJSON().bpmChanges;
			if (index >= 0) changes.splice(index, 1);
			changes.push({ time: eventBeat.toJSON(), bpm: values.bpm });
			model.timing.setBpmChanges(changes);
		});
	}

	async showCommentDialog() {
		this.exitModes();
		const values = await this.dialogs.form({
			titleKey: "dialog.comment",
			values: { text: "", duration: [1, 0, 1] },
			fields: [
				{ id: "text", type: "textarea", rows: 5, labelKey: "field.text" },
				{ id: "duration", type: "rational", labelKey: "field.duration", nonnegative: true },
			],
		});
		if (!values) return;
		this.commit(i18n.t("history.createEvent", { type: eventTypeLabel("comment") }), model => {
			for (const event of model.events) event.selected = false;
			model.addEvent("comment", {
				time: this.currentBeat().toJSON(),
				channel: model.editor.currentChannel,
				duration: values.duration,
				text: values.text,
				selected: true,
			});
		}, { allowReadOnly: true });
	}

	uniqueSnappeeName(base) {
		const names = new Set(this.model.snappees.map(snappee => snappee.name));
		if (!names.has(base)) return base;
		let suffix = 2;
		while (names.has(`${base} ${suffix}`)) suffix += 1;
		return `${base} ${suffix}`;
	}

	defaultSnappeeName(type) {
		const base = i18n.t(`snappee.${type}`);
		let index = 1;
		const names = new Set(this.model.snappees.map(snappee => snappee.name));
		while (names.has(`${base} ${index}`)) index += 1;
		return `${base} ${index}`;
	}

	async showPresetSnappeeDialog() {
		const values = await this.dialogs.form({
			titleKey: "dialog.presetSnappee",
			values: { preset: SNAPPEE_PRESETS[0].id },
			fields: [{ id: "preset", type: "select", labelKey: "field.presetSnappee",
				options: SNAPPEE_PRESETS.map(preset => ({
					value: preset.id, labelKey: `snappee.preset.${preset.id}`,
				})) }],
		});
		if (!values) return null;
		const name = this.uniqueSnappeeName(i18n.t(`snappee.preset.${values.preset}`));
		let created = null;
		this.commit(i18n.t("command.snappee.preset"), model => {
			for (const snappee of model.snappees) snappee.selected = false;
			created = model.addSnappee(createPresetSnappee(values.preset, name));
			created.selected = true;
		});
		return created?.id ?? null;
	}

	snappeeFields(type, editing = false) {
		const fields = [
			{ id: "name", type: "text", labelKey: "field.name", required: true },
			{ id: "color", type: "color", labelKey: "field.color", required: true },
		];
		if (type === "rectangularMesh") fields.push(
			{ id: "topLeft", type: "pair", labelKey: "field.topLeft", expression: true, required: true },
			{ id: "bottomRight", type: "pair", labelKey: "field.bottomRight", expression: true, required: true },
			{ id: "tiles", type: "pair", labelKey: "field.tiles", numeric: true, integer: true },
		);
		else if (type === "radialMesh") fields.push(
			{ id: "center", type: "pair", labelKey: "field.center", expression: true, required: true },
			{ id: "radius", type: "expression", labelKey: "field.radius", required: true },
			{ id: "tiles", type: "pair", labelKey: "field.tiles", numeric: true, integer: true },
			{ id: "startingAngle", type: "angle", labelKey: "field.direction" },
		);
		else if (type === "parametricMesh") fields.push(
			{ id: "iRange", type: "range", labelKey: "field.iRange" },
			{ id: "jRange", type: "range", labelKey: "field.jRange" },
			{ id: "xExpression", type: "text", labelKey: "field.xExpression", required: true },
			{ id: "yExpression", type: "text", labelKey: "field.yExpression", required: true },
		);
		else if (type === "regularPolygonCurve") fields.push(
			{ id: "center", type: "pair", labelKey: "field.center", expression: true, required: true },
			{ id: "radius", type: "expression", labelKey: "field.radius", required: true },
			{ id: "sides", type: "integer", labelKey: "field.sides", positive: true, min: 3 },
			{ id: "angle", type: "angle", labelKey: "field.direction" },
			{ id: "segmentsPerSide", type: "integer", labelKey: "field.segmentsPerSide", positive: true, min: 1 },
		);
		else if (type === "parametricCurve") fields.push(
			{ id: "iRange", type: "range", labelKey: "field.iRange" },
			{ id: "xExpression", type: "text", labelKey: "field.xExpression", required: true },
			{ id: "yExpression", type: "text", labelKey: "field.yExpression", required: true },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
		);
		else if (type === "bezierCurve") fields.push(
			{ id: "controlPoints", type: "array", itemType: "pair", item: { expression: true, required: true },
				labelKey: "field.controlPoints", stacked: true, minItems: 2, newItem: [0, 0] },
			{ id: "segments", type: "integer", labelKey: "field.segments", positive: true, min: 1 },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
		);
		else if (type === "circularArcCurve") fields.push(
			{ id: "center", type: "pair", labelKey: "field.center", expression: true, required: true },
			{ id: "radius", type: "expression", labelKey: "field.radius", required: true },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
			{ id: "beginningAngle", type: "angle", labelKey: "field.beginningAngle", required: true },
			{ id: "endAngle", type: "angle", labelKey: "field.endAngle", required: true, disabled: values => values.closed },
			{ id: "clockwise", type: "checkbox", labelKey: "field.clockwise", disabled: values => values.closed },
			{ id: "segments", type: "integer", labelKey: "field.segments", positive: true, min: 1 },
		);
		else if (type === "penCurve") fields.push(
			{
				id: "commands", type: "array", labelKey: "field.commands", stacked: true, minItems: 2,
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
		);
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
		if (type === "rectangularMesh") Object.assign(values, {
			topLeft: [source.topLeftX ?? -100, source.topLeftY ?? 50],
			bottomRight: [source.bottomRightX ?? 100, source.bottomRightY ?? -50],
			tiles: [source.horizontalTiles ?? 16, source.verticalTiles ?? 8],
		});
		if (type === "radialMesh") Object.assign(values, {
			center: [source.centerX ?? 0, source.centerY ?? 0], radius: source.radius ?? "50",
			tiles: [source.azimuthalTiles ?? 8, source.radialTiles ?? 4],
			startingAngle: { value: (source.startingAngle ?? 0) * 180 / Math.PI, radians: false },
		});
		if (type === "parametricMesh") Object.assign(values, {
			iRange: { min: source.iRange?.[0] ?? -4, max: source.iRange?.[1] ?? 5, exclusive: source.iRangeExclusive ?? true },
			jRange: { min: source.jRange?.[0] ?? -2, max: source.jRange?.[1] ?? 3, exclusive: source.jRangeExclusive ?? true },
			xExpression: source.xExpression || "i * 25", yExpression: source.yExpression || "j * 25",
		});
		if (type === "regularPolygonCurve") Object.assign(values, {
			center: [source.centerX ?? 0, source.centerY ?? 0], radius: source.radius ?? "50", sides: source.sides ?? 5,
			angle: { value: (source.angle ?? Math.PI / 2) * 180 / Math.PI, radians: false }, segmentsPerSide: source.segmentsPerSide ?? 4,
		});
		if (type === "parametricCurve") Object.assign(values, {
			iRange: { min: source.iRange?.[0] ?? 0, max: source.iRange?.[1] ?? 16, exclusive: source.iRangeExclusive ?? true },
			xExpression: source.xExpression || "50 * cos(2 * pi * i / 16)",
			yExpression: source.yExpression || "50 * sin(2 * pi * i / 16)", closed: source.closed ?? true,
		});
		if (type === "bezierCurve") Object.assign(values, {
			controlPoints: (source.controlPoints || [{ x: -50, y: 0 }, { x: 50, y: 0 }]).map(point => [point.x, point.y]),
			segments: source.segments ?? 16,
			closed: source.closed ?? false,
		});
		if (type === "circularArcCurve") Object.assign(values, {
			center: [source.centerX ?? 0, source.centerY ?? 0],
			radius: source.radius ?? "50",
			closed: source.closed ?? false,
			beginningAngle: { value: (source.beginningAngle ?? 0) * 180 / Math.PI, radians: false },
			endAngle: { value: (source.endAngle ?? Math.PI) * 180 / Math.PI, radians: false },
			clockwise: source.clockwise ?? false,
			segments: source.segments ?? 16,
		});
		if (type === "penCurve") Object.assign(values, {
			commands: (source.commands || [{ type: "M", x: -50, y: 0 }, { type: "L", x: 50, y: 0 }]).map(command => ({
				type: String(command.type || "L").toUpperCase(),
				x: command.x ?? 0, y: command.y ?? 0,
				x1: command.x1 ?? command.x ?? 0, y1: command.y1 ?? command.y ?? 0,
				x2: command.x2 ?? command.x ?? 0, y2: command.y2 ?? command.y ?? 0,
			})),
			segments: source.segments ?? 16,
			closed: source.closed ?? false,
		});
		return values;
	}

	angleValue(value) {
		const number = evaluateExpression(value?.value, 0);
		return value?.radians ? number : number * Math.PI / 180;
	}

	formToSnappee(type, values) {
		const result = { name: values.name, color: values.color, transformation: (values.transformation || [1, 0, 0, 1, 0, 0]).map(value => evaluateExpression(value)) };
		if (type === "rectangularMesh") Object.assign(result, {
			topLeftX: evaluateExpression(values.topLeft[0]), topLeftY: evaluateExpression(values.topLeft[1]),
			bottomRightX: evaluateExpression(values.bottomRight[0]), bottomRightY: evaluateExpression(values.bottomRight[1]),
			horizontalTiles: Math.max(1, Math.floor(values.tiles[0])), verticalTiles: Math.max(1, Math.floor(values.tiles[1])),
		});
		else if (type === "radialMesh") Object.assign(result, {
			centerX: evaluateExpression(values.center[0]), centerY: evaluateExpression(values.center[1]), radius: Math.abs(evaluateExpression(values.radius, 50)),
			azimuthalTiles: Math.max(1, Math.floor(values.tiles[0])), radialTiles: Math.max(1, Math.floor(values.tiles[1])),
			startingAngle: this.angleValue(values.startingAngle),
		});
		else if (type === "parametricMesh") Object.assign(result, {
			iRange: [values.iRange.min, values.iRange.max], iRangeExclusive: values.iRange.exclusive,
			jRange: [values.jRange.min, values.jRange.max], jRangeExclusive: values.jRange.exclusive,
			xExpression: values.xExpression, yExpression: values.yExpression,
		});
		else if (type === "regularPolygonCurve") Object.assign(result, {
			centerX: evaluateExpression(values.center[0]), centerY: evaluateExpression(values.center[1]), radius: Math.abs(evaluateExpression(values.radius, 50)),
			sides: Math.max(3, Math.floor(values.sides)), angle: this.angleValue(values.angle),
			segmentsPerSide: Math.max(1, Math.floor(values.segmentsPerSide)), closed: true,
		});
		else if (type === "parametricCurve") Object.assign(result, {
			iRange: [values.iRange.min, values.iRange.max], iRangeExclusive: values.iRange.exclusive,
			xExpression: values.xExpression, yExpression: values.yExpression, closed: values.closed,
		});
		else if (type === "bezierCurve") Object.assign(result, {
			degree: Math.max(1, values.controlPoints.length - 1),
			controlPoints: values.controlPoints.map(point => ({ x: evaluateExpression(point[0]), y: evaluateExpression(point[1]) })),
			segments: Math.max(1, Math.floor(values.segments)), closed: Boolean(values.closed),
		});
		else if (type === "circularArcCurve") Object.assign(result, {
			centerX: evaluateExpression(values.center[0]), centerY: evaluateExpression(values.center[1]),
			radius: Math.abs(evaluateExpression(values.radius, 50)), closed: Boolean(values.closed),
			beginningAngle: this.angleValue(values.beginningAngle),
			endAngle: this.angleValue(values.endAngle), clockwise: Boolean(values.clockwise),
			segments: Math.max(1, Math.floor(values.segments)),
		});
		else if (type === "penCurve") Object.assign(result, {
			commands: values.commands.map((command, index) => {
				const type = index === 0 ? "M" : ["L", "Q", "C"].includes(String(command.type).toUpperCase()) ? String(command.type).toUpperCase() : "L";
				const item = { type, x: evaluateExpression(command.x), y: evaluateExpression(command.y) };
				if (type === "Q" || type === "C") Object.assign(item, { x1: evaluateExpression(command.x1), y1: evaluateExpression(command.y1) });
				if (type === "C") Object.assign(item, { x2: evaluateExpression(command.x2), y2: evaluateExpression(command.y2) });
				return item;
			}),
			segments: Math.max(1, Math.floor(values.segments)), closed: Boolean(values.closed),
		});
		return result;
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
		if (!values) return;
		const data = this.formToSnappee(type, values);
		this.commit(source ? i18n.t("history.editSnappee") : i18n.t("history.createSnappee"), model => {
			if (source) mutateSnappeeWithinBounds(model, id, snappee => { Object.assign(snappee, data); });
			else {
				const created = model.addSnappee(type, data);
				for (const snappee of model.snappees) snappee.selected = snappee.id === created.id;
			}
		});
	}

	selectSnappee(id) {
		if (this.model.editor.readOnly) return false;
		let changed = false;
		for (const snappee of this.model.snappees) {
			const selected = snappee.id === id && snappee.active !== false;
			if (snappee.selected !== selected) { snappee.selected = selected; changed = true; }
		}
		if (!changed) return true;
		this.snappeesPanel?.syncFlags?.(this.model, { readOnly: this.model.editor.readOnly });
		this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
		this._syncCheckedCommands?.();
		return true;
	}

	toggleSnappee(id) {
		this.commit(i18n.t("history.editSnappee"), model => {
			const snappee = model.snappees.find(item => item.id === id);
			if (snappee) { snappee.active = !snappee.active; if (!snappee.active) snappee.selected = false; }
		}, { allowReadOnly: true, lightweight: true, viewOnly: true, snappeeOnly: true, rebuildIndex: false, skipInspector: true, scheduleDirty: false });
	}

	duplicateSnappee(id) {
		this.commit(i18n.t("history.createSnappee"), model => {
			const source = model.snappees.find(item => item.id === id);
			if (!source) return;
			model.addSnappee({ ...deepClone(source), id: null, selected: false, name: this.uniqueSnappeeName(source.name) });
		});
	}

	moveSnappeeInList(id, direction) {
		this.commit(i18n.t("history.editSnappee"), model => {
			const index = model.snappees.findIndex(snappee => snappee.id === id);
			const target = index + Math.sign(Number(direction));
			if (index < 0 || !Number.isInteger(target) || target < 0 || target >= model.snappees.length) return;
			[model.snappees[index], model.snappees[target]] = [model.snappees[target], model.snappees[index]];
		}, { lightweight: true, viewOnly: true, snappeeOnly: true, rebuildIndex: false, skipInspector: true, scheduleDirty: false });
	}

	async deleteSnappee(id) {
		if (!await this.dialogs.confirm({ titleKey: "dialog.deleteSnappee", messageKey: "dialog.deleteSnappeeMessage" })) return;
		this.commit(i18n.t("history.editSnappee"), model => model.removeSnappee(id));
	}

	async editSnappee(id) {
		if (this.audio.playing) return;
		const snappee = this.model.snappees.find(item => item.id === id);
		if (snappee) await this.showSnappeeDialog(snappee.type, id);
	}

	startCurveDraft(type) {
		this.exitModes();
		this.curveDraft = {
			type,
			points: [],
			...(type === "penCurve" ? { penNodes: [] } : {}),
			name: this.defaultSnappeeName(type),
			color: SNAPPEE_COLORS[this.model.snappees.length % SNAPPEE_COLORS.length],
		};
		this.history.record(this.model.snapshot(), i18n.t("history.editSnappee"),
			{ curveDraft: deepClone(this.curveDraft) }, { force: true });
		this.refresh();
	}

	startPenNode(point) {
		if (this.curveDraft?.type !== "penCurve") return null;
		const first = this.curveDraft.penNodes[0];
		if (first && this.curveDraft.penNodes.length >= 2
			&& Math.hypot(first.x - point.x, first.y - point.y) < 3) {
			this.curveDraft.closed = true;
			this.recordCurveDraftAction();
			this.finishCurveDraft();
			return null;
		}
		const node = { x: Number(point.x), y: Number(point.y), incoming: null, outgoing: null };
		this.curveDraft.penNodes.push(node);
		this.curveDraft.points.push({ x: node.x, y: node.y });
		this.refresh();
		return this.curveDraft.penNodes.length - 1;
	}

	setPenNodeDrag(index, point, record = false) {
		const draft = this.curveDraft;
		const node = draft?.type === "penCurve" ? draft.penNodes?.[index] : null;
		if (!node) return;
		const outgoing = { x: Number(point.x), y: Number(point.y) };
		if (Math.hypot(outgoing.x - node.x, outgoing.y - node.y) < 0.25) {
			node.incoming = null;
			node.outgoing = null;
		} else {
			node.outgoing = outgoing;
			node.incoming = { x: node.x * 2 - outgoing.x, y: node.y * 2 - outgoing.y };
		}
		if (record) {
			this.recordCurveDraftAction();
			this.refresh();
		} else this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
	}

	setPenNodeHandle(index, kind, point, record = false) {
		const draft = this.curveDraft;
		const node = draft?.type === "penCurve" ? draft.penNodes?.[index] : null;
		if (!node || !["incoming", "outgoing"].includes(kind)) return;
		node[kind] = { x: Number(point.x), y: Number(point.y) };
		if (record) {
			this.recordCurveDraftAction();
			this.refresh();
		} else this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
	}

	recordPenNode() {
		if (this.curveDraft?.type !== "penCurve") return;
		this.recordCurveDraftAction();
		this.refresh();
	}

	addCurvePoint(point, finish = false) {
		if (!this.curveDraft) return;
		const snap = findNearestSnapPoint(point, this.model.snappees, { activeOnly: true, maxDistance: 5 });
		const finalPoint = snap ? { x: snap.x, y: snap.y } : { x: point.x, y: point.y };
		const first = this.curveDraft.points[0];
		const last = this.curveDraft.points.at(-1);
		const closesArc = this.curveDraft.type === "circularArcCurve" && this.curveDraft.points.length >= 2
			&& Math.hypot(this.curveDraft.points[1].x - finalPoint.x, this.curveDraft.points[1].y - finalPoint.y) < 3;
		if (closesArc || (this.curveDraft.type !== "circularArcCurve" && first
			&& Math.hypot(first.x - finalPoint.x, first.y - finalPoint.y) < 3 && this.curveDraft.points.length >= 2)) {
			this.curveDraft.closed = true;
			finish = true;
		} else if (!(finish && last && Math.hypot(last.x - finalPoint.x, last.y - finalPoint.y) < 3)) {
			this.curveDraft.points.push(finalPoint);
		}
		if (this.curveDraft.type === "circularArcCurve" && this.curveDraft.points.length >= 3) finish = true;
		this.recordCurveDraftAction();
		if (finish) this.finishCurveDraft(); else this.refresh();
	}

	activateCurveDraftPoint(index) {
		const draft = this.curveDraft;
		if (!draft || draft.points.length < 2) return false;
		const closes = draft.type === "circularArcCurve" ? index === 1 : index === 0;
		if (!closes) return false;
		draft.closed = true;
		this.recordCurveDraftAction();
		this.finishCurveDraft();
		return true;
	}

	recordCurveDraftAction() {
		if (!this.curveDraft) return;
		this.history.record(this.model.snapshot(), i18n.t("history.editSnappee"),
			{ curveDraft: deepClone(this.curveDraft) }, { force: true });
	}

	finishCurveDraftFromDoubleClick() {
		if (!this.curveDraft) return;
		const points = this.curveDraft.points;
		if (points.length > 2 && Math.hypot(points.at(-1).x - points.at(-2).x, points.at(-1).y - points.at(-2).y) < 3) {
			points.pop();
			if (this.curveDraft.type === "penCurve") this.curveDraft.penNodes?.pop();
			this.recordCurveDraftAction();
		}
		this.finishCurveDraft();
	}

	moveCurveDraftPoint(index, point, record = false) {
		if (!this.curveDraft?.points[index]) return;
		if (this.curveDraft.type === "penCurve" && this.curveDraft.penNodes?.[index]) {
			const node = this.curveDraft.penNodes[index];
			const dx = Number(point.x) - node.x;
			const dy = Number(point.y) - node.y;
			node.x += dx;
			node.y += dy;
			if (node.incoming) { node.incoming.x += dx; node.incoming.y += dy; }
			if (node.outgoing) { node.outgoing.x += dx; node.outgoing.y += dy; }
		}
		this.curveDraft.points[index] = { x: Number(point.x), y: Number(point.y) };
		if (record) this.recordCurveDraftAction();
		this.refresh();
	}

	finishCurveDraft() {
		const draft = this.curveDraft;
		if (!draft || draft.points.length < 2) { this.curveDraft = null; this.refresh(); return; }
		let data;
		if (draft.type === "bezierCurve") {
			data = { name: draft.name, color: draft.color, degree: draft.points.length - 1,
				controlPoints: draft.points, segments: Math.max(8, draft.points.length * 6), closed: Boolean(draft.closed) };
		} else if (draft.type === "circularArcCurve") {
			const [center, beginning, ending = beginning] = draft.points;
			data = { name: draft.name, color: draft.color, centerX: center.x, centerY: center.y,
				radius: Math.hypot(beginning.x - center.x, beginning.y - center.y),
				beginningAngle: Math.atan2(beginning.y - center.y, beginning.x - center.x),
				endAngle: Math.atan2(ending.y - center.y, ending.x - center.x), clockwise: false,
				closed: Boolean(draft.closed), segments: 24 };
		} else {
			data = { name: draft.name, color: draft.color,
				commands: penCommandsFromNodes(draft.penNodes || draft.points, Boolean(draft.closed)),
				segments: Math.max(8, draft.points.length * 4), closed: Boolean(draft.closed) };
		}
		this.curveDraft = null;
		let createdId = null;
		this.commit(i18n.t("history.createSnappee"), model => {
			createdId = model.addSnappee(draft.type, data).id;
		});
		if (createdId != null && ["bezierCurve", "penCurve"].includes(draft.type)) {
			void this.showSnappeeDialog(draft.type, createdId, { focusField: "segments" });
		}
	}

	fillSelectedCurve() {
		const snappee = this.model.snappees.find(item => item.selected && !item.type.endsWith("Mesh"));
		if (!snappee) return;
		this.commit(i18n.t("history.createEvent", { type: eventTypeLabel("drag") }), model => {
			const points = sampleSnappee(snappee).filter(point => pointAllowed(model, point));
			if (!points.length) return;
			for (const event of model.events) event.selected = false;
			points.forEach((point, index) => model.addEvent("drag", {
				time: this.currentBeat().add(new Rational(index, model.editor.subdivision)).toJSON(),
				channel: model.editor.currentChannel,
				attached: true, snappee: snappee.id, snapPoint: deepClone(point.snapPoint), selected: true,
			}));
		});
	}
};
