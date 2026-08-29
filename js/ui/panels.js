// The side panels: the inspector for the current selection, plus the clips list.
//
// The inspector is the interesting one. It renders a single form for a whole multi-item
// selection, so every field asks `commonValue` what the selected items agree on and shows a
// blank when they disagree, and it decides which rows to show from what the selection can
// carry (a position only for movable types, a duration only for the types that have one, and
// so on). Rows that do not apply are hidden rather than dropped so the form does not jump
// about as the selection changes.
//
// The pieces that are useful on their own live in sibling modules and are re-exported here so
// existing importers of this path keep working:
//   ./panel-controls.js - the form controls every row is built from
//   ./panel-clips.js    - the clips panel and its thumbnails
//   ./panel-history.js  - the undo-history panel
//   ./panel-lists.js    - the snappee and channel list panels (v22)

import { Rational } from "../core/rational.js";
import { eventTime } from "../core/grouping.js";
import { AFFINE_MATRIX_GRID, resolveAttachedPosition } from "../core/geometry.js";
import {
	MIXED,
	bindEscapeRestore,
	clear,
	commonValue,
	makeAngleControl,
	makeExpressionControl,
	makeInput,
	makeRadioControl,
	makeRationalControl,
	makeSelect,
	rememberInitialValues,
	setControlDisabled,
	setControlHidden,
} from "./panel-controls.js";

import { ZERO_DURATION_TYPES } from "../render/timeline-helpers.js";
import { makeSnappeePreview } from "./panel-lists.js";

export { bindEscapeRestore, rememberInitialValues };
export { ClipsPanel, drawClipThumbnail } from "./panel-clips.js";
export { HistoryPanel } from "./panel-history.js";
export { ChannelsPanel, SnappeesPanel } from "./panel-lists.js";

const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote"]);
const DURATION_TYPES = new Set([
	"hold",
	"bgNote",
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
	"comment",
]);
const TEXT_TYPES = new Set(["tap", "hold", "flick", "bgNote", "bigText", "comment"]);
const TIP_TYPES = new Set(["tap", "hold", "drag", "flick"]);
const EVENT_TYPE_CHOICES = [
	"tap",
	"hold",
	"drag",
	"flick",
	"bgNote",
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
	"comment",
];
const MATRIX_LABEL_KEYS = [
	"field.matrixA",
	"field.matrixB",
	"field.matrixC",
	"field.matrixD",
	"field.matrixTx",
	"field.matrixTy",
];

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
		if (control?.dataset?.hidden === "true") {
			row.hidden = true;
		}
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

	// Which events the inspector is editing. Selecting a group edits the group rather than its
	// members, so groups win whenever any are selected.
	#selectionOf(model, context) {
		let source = model.events;
		if (Array.isArray(context.selectedEvents)) {
			source = context.selectedEvents;
		} else if (model.allEvents) {
			source = model.allEvents();
		}
		const allSelected = source.filter(event => event.selected);
		const selectedGroups = allSelected.filter(event => event.type === "group");
		return { allSelected, selectedGroups, selected: selectedGroups.length ? selectedGroups : allSelected };
	}

	// The free-transform matrix, laid out as two rows of three. Rejecting an out-of-bounds
	// value is the transform owner's job, so an input snaps back to whatever it applied.
	#renderTransformGroup(transform) {
		const transformGroup = this.#group("field.transform");
		const wrapper = document.createElement("div");
		wrapper.className = "matrix-input";
		const inputs = transform.map((value, index) => {
			const input = makeInput(
				document,
				"number",
				value,
				next => {
					const applied = this.onTransformChange(index, next);
					if (Number.isFinite(applied) && applied !== next) {
						input.value = applied;
					}
				},
				{ step: "any" },
			);
			input.setAttribute("aria-label", this.i18n.t(MATRIX_LABEL_KEYS[index]));
			input.title = this.i18n.t(MATRIX_LABEL_KEYS[index]);
			return input;
		});
		for (const index of AFFINE_MATRIX_GRID) {
			wrapper.append(inputs[index]);
		}
		transformGroup.append(this.#row("field.transform", wrapper));
		this.element.append(transformGroup);
	}

	#renderTypeRow(group, selected) {
		const types = commonValue(selected, event => event.type);
		const typeControl = makeSelect(
			document,
			EVENT_TYPE_CHOICES.map(type => ({ value: type, label: this.i18n.t(`event.${type}`) })),
			types,
			value => this.onChange("type", value),
		);
		group.append(this.#row("field.type", typeControl));
		return typeControl;
	}

	// A pair of expression inputs for a chart position, disabled while the events are attached
	// to a snappee (their position then comes from the snappee).
	#positionPair(model, selected, locked) {
		const position = commonValue(selected, event => {
			const resolved = resolveAttachedPosition(event, model.snappees);
			return resolved ? [resolved.x, resolved.y] : [event.x, event.y];
		});
		const pair = document.createElement("div");
		pair.className = "pair-input";
		pair.append(
			makeExpressionControl(document, position === MIXED ? MIXED : position[0], value =>
				this.onChange("x", value),
			),
			makeExpressionControl(document, position === MIXED ? MIXED : position[1], value =>
				this.onChange("y", value),
			),
		);
		if (locked) {
			pair.querySelectorAll("input").forEach(input => (input.disabled = true));
		}
		return pair;
	}

	// Groups carry only a colour and the position of the whole group, so they get their own
	// short form instead of the per-event rows below.
	#renderGroupProperties(group, model, selected) {
		const color = commonValue(selected, event => event.color);
		group.append(
			this.#row(
				"field.color",
				makeInput(document, "color", color === MIXED ? "#ff9d3d" : color || "#ff9d3d", value =>
					this.onChange("color", value),
				),
			),
		);
		const position = commonValue(selected, event => {
			const resolved = resolveAttachedPosition(event, model.snappees);
			return resolved ? [resolved.x, resolved.y] : [event.x || 0, event.y || 0];
		});
		const positionWrapper = document.createElement("div");
		positionWrapper.className = "pair-input";
		positionWrapper.append(
			makeExpressionControl(document, position === MIXED ? MIXED : position[0], value =>
				this.onChange("x", value),
			),
			makeExpressionControl(document, position === MIXED ? MIXED : position[1], value =>
				this.onChange("y", value),
			),
		);
		if (selected.some(event => event.attached)) {
			positionWrapper.querySelectorAll("input").forEach(input => (input.disabled = true));
		}
		group.append(this.#row("field.position", positionWrapper));
	}

	// Muted channels are not offered, but the label still shows the channel's own name so the
	// dropdown matches the channel list.
	#renderChannelRow(group, model, selected) {
		const channel = commonValue(selected, event => event.channel);
		group.append(
			this.#row(
				"field.channel",
				makeSelect(
					document,
					model.channels
						.map((item, index) => ({ item, index }))
						.filter(({ item }) => item.active !== false)
						.map(({ item, index }) => ({
							value: item.id,
							label: String(item.name || `Channel ${index + 1}`),
						})),
					channel,
					value => this.onChange("channel", Number(value)),
				),
			),
		);
	}

	#renderPositionRow(group, model, selected) {
		const attached = commonValue(selected, event => event.attached);
		const attachedSnappee = commonValue(selected, event => (event.attached ? event.snappee : null));
		const wrapper = document.createElement("div");
		wrapper.className = "attached-input";
		if (attached === true && attachedSnappee !== MIXED) {
			const snappee = model.snappees.find(item => item.id === attachedSnappee);
			if (snappee) {
				wrapper.append(makeSnappeePreview(document, snappee, 22));
			}
		}
		wrapper.append(this.#positionPair(model, selected, attached === true));
		group.append(this.#row("field.position", wrapper));
	}

	// Duration and end time are two views of the same value, so both reject an edit that would
	// make the event end before it starts (or at the same beat, unless the type allows that).
	#renderDurationRows(group, selected) {
		group.append(
			this.#row(
				"field.duration",
				makeRationalControl(
					document,
					commonValue(selected, event => event.duration),
					value => {
						const comparison = Rational.from(value).compare(0);
						if (
							comparison > 0 ||
							(comparison === 0 && selected.every(event => ZERO_DURATION_TYPES.has(event.type)))
						) {
							this.onChange("duration", value);
						}
					},
				),
			),
		);
		group.append(
			this.#row(
				"field.endTime",
				makeRationalControl(
					document,
					commonValue(selected, event =>
						Rational.from(event.time)
							.add(event.duration || 0)
							.toJSON(),
					),
					value => {
						const end = Rational.from(value);
						const valid = selected.every(event => {
							const comparison = end.compare(event.time);
							return comparison > 0 || (comparison === 0 && ZERO_DURATION_TYPES.has(event.type));
						});
						if (valid) {
							this.onChange("endTime", value);
						}
					},
				),
			),
		);
	}

	// Everything the tip-point rows below share. Each row is hidden rather than dropped when it
	// does not apply, so all of these are needed even when the spawn fields are inactive.
	#tipPointState(selected) {
		const spawnType = commonValue(selected, event => event.tipPointSpawnType);
		return {
			spawnType,
			spawnFieldsEnabled: spawnType === "chain" || spawnType === "drop",
			absolute: commonValue(selected, event => event.tipPointSpawnAbsolutePosition),
			attached: commonValue(selected, event => event.tipPointSpawnAttached),
			spawnSnappeeId: commonValue(selected, event => event.tipPointSpawnSnappee),
			timeInBeats: commonValue(selected, event => event.tipPointSpawnTimeBeats),
			spawnTime: commonValue(selected, event => event.tipPointSpawnTime),
		};
	}

	// Where the tip point starts: either an absolute point (optionally snapped to a snappee) or
	// a distance and direction away from the note, which is what the offset rows below cover.
	#renderSpawnPositionRows(group, model, selected, state) {
		const { spawnFieldsEnabled, absolute, attached, spawnSnappeeId } = state;
		const spawnPositionControl = makeRadioControl(
			document,
			[
				{ value: "absolute", label: this.i18n.t("field.absolute") },
				{ value: "relative", label: this.i18n.t("field.relative") },
			],
			absolute === MIXED ? MIXED : absolute ? "absolute" : "relative",
			value => this.onChange("tipPointSpawnAbsolutePosition", value === "absolute"),
		);
		setControlHidden(spawnPositionControl, !spawnFieldsEnabled);
		group.append(this.#row("field.spawnPosition", spawnPositionControl));

		const attachedControl = makeInput(document, "checkbox", attached, value =>
			this.onChange("tipPointSpawnAttached", value),
		);
		attachedControl.indeterminate = attached === MIXED;
		setControlHidden(attachedControl, !spawnFieldsEnabled || absolute !== true || !model.snappees.length);
		group.append(this.#row("field.attached", attachedControl));

		const absolutePosition = commonValue(selected, event => [event.tipPointSpawnX, event.tipPointSpawnY]);
		const absoluteWrapper = document.createElement("div");
		absoluteWrapper.className = "attached-input";
		if (absolute === true && attached === true && spawnSnappeeId !== MIXED) {
			const snappee = model.snappees.find(item => item.id === spawnSnappeeId);
			if (snappee) {
				absoluteWrapper.append(makeSnappeePreview(document, snappee, 22));
			}
		}
		const absolutePair = document.createElement("div");
		absolutePair.className = "pair-input";
		absolutePair.append(
			makeExpressionControl(document, absolutePosition === MIXED ? MIXED : absolutePosition[0], value =>
				this.onChange("tipPointSpawnX", value),
			),
			makeExpressionControl(document, absolutePosition === MIXED ? MIXED : absolutePosition[1], value =>
				this.onChange("tipPointSpawnY", value),
			),
		);
		absoluteWrapper.append(absolutePair);
		setControlHidden(absoluteWrapper, !spawnFieldsEnabled || absolute !== true || attached === true);
		group.append(this.#row("field.absolute", absoluteWrapper));
	}

	// A snap point is a pair of indices on a mesh snappee and a single index on a curve.
	#renderSnapPointRow(group, targetSnappee, snapPoint, hidden) {
		if (targetSnappee?.type.endsWith("Mesh")) {
			const pair = Array.isArray(snapPoint) ? snapPoint : [0, 0];
			const wrapper = document.createElement("div");
			wrapper.className = "pair-input";
			const update = (index, value) => {
				const next = [...pair];
				next[index] = Math.round(value);
				this.onChange("tipPointSpawnSnapPoint", next);
			};
			wrapper.append(
				makeInput(document, "number", snapPoint === MIXED ? MIXED : pair[0], value => update(0, value), {
					step: "1",
				}),
				makeInput(document, "number", snapPoint === MIXED ? MIXED : pair[1], value => update(1, value), {
					step: "1",
				}),
			);
			setControlHidden(wrapper, hidden);
			group.append(this.#row("field.snapPoint", wrapper));
			return;
		}
		const control = makeInput(
			document,
			"number",
			snapPoint,
			value => this.onChange("tipPointSpawnSnapPoint", Math.round(value)),
			{ step: "1" },
		);
		setControlHidden(control, hidden);
		group.append(this.#row("field.snapPoint", control));
	}

	#renderSpawnSnappeeRows(group, model, selected, state) {
		const { spawnFieldsEnabled, absolute, spawnSnappeeId } = state;
		const snappeeControl = makeSelect(
			document,
			model.snappees.map(snappee => ({ value: snappee.id, label: snappee.name })),
			spawnSnappeeId,
			value => this.onChange("tipPointSpawnSnappee", Number(value)),
		);
		setControlHidden(snappeeControl, !spawnFieldsEnabled || absolute !== true);
		group.append(this.#row("field.snappee", snappeeControl));
		const targetSnappee =
			spawnSnappeeId === MIXED ? null : model.snappees.find(snappee => snappee.id === spawnSnappeeId);
		const snapPoint = commonValue(selected, event => event.tipPointSpawnSnapPoint);
		this.#renderSnapPointRow(group, targetSnappee, snapPoint, !spawnFieldsEnabled || absolute !== true);
	}

	#renderSpawnOffsetRows(group, selected, state) {
		const { spawnFieldsEnabled, absolute } = state;
		const distanceControl = makeExpressionControl(
			document,
			commonValue(selected, event => event.tipPointSpawnDistance),
			value => this.onChange("tipPointSpawnDistance", Math.max(0, value)),
		);
		setControlHidden(distanceControl, !spawnFieldsEnabled || absolute !== false);
		group.append(this.#row("field.spawnDistance", distanceControl));
		const directionControl = makeAngleControl(
			document,
			commonValue(selected, event => event.tipPointSpawnAngle),
			value => this.onChange("tipPointSpawnAngle", value),
			this.i18n,
		);
		setControlHidden(directionControl, !spawnFieldsEnabled || absolute !== false);
		group.append(this.#row("field.spawnDirection", directionControl));
	}

	// How long before the note the tip point appears, in seconds or in beats. Only the row
	// matching the chosen unit is visible, and the hidden one is left blank.
	#renderSpawnTimeRows(group, state) {
		const { spawnFieldsEnabled, timeInBeats, spawnTime } = state;
		const spawnUnitControl = makeRadioControl(
			document,
			[
				{ value: "seconds", label: this.i18n.t("field.seconds") },
				{ value: "beats", label: this.i18n.t("field.beats") },
			],
			timeInBeats === MIXED ? MIXED : timeInBeats ? "beats" : "seconds",
			value => this.onChange("tipPointSpawnTimeBeats", value === "beats"),
		);
		setControlHidden(spawnUnitControl, !spawnFieldsEnabled);
		group.append(this.#row("field.spawnUnit", spawnUnitControl));
		const secondsControl = makeExpressionControl(
			document,
			timeInBeats === false ? spawnTime : timeInBeats === MIXED ? MIXED : "",
			value => this.onChange("tipPointSpawnTime", Math.max(0, value)),
		);
		setControlHidden(secondsControl, !spawnFieldsEnabled || timeInBeats !== false);
		group.append(this.#row("field.spawnTimeSeconds", secondsControl));
		const beatsControl = makeRationalControl(
			document,
			timeInBeats === true ? spawnTime : timeInBeats === MIXED ? MIXED : [0, 0, 1],
			value => this.onChange("tipPointSpawnTime", value),
		);
		setControlHidden(beatsControl, !spawnFieldsEnabled || timeInBeats !== true);
		group.append(this.#row("field.spawnTimeBeats", beatsControl));
	}

	#renderTipPointRows(group, model, selected) {
		const modes = ["inherit", "chain", "drop", "none"].map(value => ({
			value,
			label: this.i18n.t(`tipPoint.${value}`),
		}));
		const state = this.#tipPointState(selected);
		group.append(
			this.#row(
				"field.spawnType",
				makeSelect(document, modes, state.spawnType, value => this.onChange("tipPointSpawnType", value)),
			),
		);
		this.#renderSpawnPositionRows(group, model, selected, state);
		if (state.attached === true) {
			this.#renderSpawnSnappeeRows(group, model, selected, state);
		}
		this.#renderSpawnOffsetRows(group, selected, state);
		this.#renderSpawnTimeRows(group, state);
	}

	// The rows a mixed-type selection may still share, appended in a fixed order so the form
	// keeps its shape as the selection changes.
	#renderEventProperties(group, model, selected) {
		this.#renderChannelRow(group, model, selected);
		if (selected.every(event => MOVABLE_TYPES.has(event.type))) {
			this.#renderPositionRow(group, model, selected);
		}
		if (selected.every(event => DURATION_TYPES.has(event.type))) {
			this.#renderDurationRows(group, selected);
		}
		if (selected.every(event => TEXT_TYPES.has(event.type))) {
			group.append(
				this.#row(
					"field.text",
					makeInput(
						document,
						"text",
						commonValue(selected, event => event.text),
						value => this.onChange("text", value),
					),
				),
			);
		}
		if (selected.every(event => event.type === "flick")) {
			const radians = commonValue(selected, event => event.angle);
			group.append(
				this.#row(
					"field.direction",
					makeAngleControl(document, radians, value => this.onChange("angle", value), this.i18n),
				),
			);
		}
		if (selected.every(event => TIP_TYPES.has(event.type))) {
			this.#renderTipPointRows(group, model, selected);
		}
	}

	#renderEmpty() {
		const empty = document.createElement("p");
		empty.className = "panel-empty-message is-muted";
		empty.textContent = this.i18n.t("panel.noSelection");
		this.element.append(empty);
		rememberInitialValues(this.element);
	}

	render(model, context = {}) {
		this.cleanup.forEach(dispose => dispose?.());
		this.cleanup = [];
		clear(this.element);
		this.escapeBound ||= Boolean((this.cleanupEscape = bindEscapeRestore(this.element)));
		const { selectedGroups, selected } = this.#selectionOf(model, context);
		const commentsOnly = selected.length > 0 && selected.every(event => event.type === "comment");
		const groupsOnly = selectedGroups.length > 0;
		if (Array.isArray(context.transform)) {
			this.#renderTransformGroup(context.transform);
		}
		if (!selected.length) {
			this.#renderEmpty();
			return;
		}

		let titleKey = "panel.commonProperties";
		if (selected.every(event => event.type === selected[0].type)) {
			titleKey = `event.${selected[0].type}`;
		}
		const group = this.#group(titleKey);
		let typeControl = null;
		if (!groupsOnly) {
			typeControl = this.#renderTypeRow(group, selected);
		}

		const time = commonValue(selected, event => eventTime(event));
		const timeControl = makeRationalControl(document, time, value => this.onChange("time", value));
		if (groupsOnly) {
			setControlDisabled(timeControl, true);
		}
		group.append(this.#row("field.time", timeControl));
		if (groupsOnly) {
			this.#renderGroupProperties(group, model, selected);
			if (model.editor.readOnly) {
				setControlDisabled(group, true);
			}
			this.element.append(group);
			return;
		}
		this.#renderEventProperties(group, model, selected);
		if (model.editor.readOnly) {
			if (!commentsOnly) {
				group.disabled = true;
			} else if (typeControl) {
				setControlDisabled(typeControl, true);
			}
		}
		this.element.append(group);
		rememberInitialValues(this.element);
	}
}
