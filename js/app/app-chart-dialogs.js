// Chart-level dialogs: selection filter, subdivision, speed, background
// patterns, BPM changes and comments.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { EVENT_TYPES } from "../core/chart-model.js";
import { Rational } from "../core/rational.js";
import { eventTime, eventUsesChannel } from "../core/grouping.js";
import { eventTypeLabel } from "./app-helpers.js";

function typeCheckboxes(prefix, disabledWhen) {
	return EVENT_TYPES.map(type => ({
		id: `${prefix}_${type}`,
		type: "checkbox",
		labelKey: `event.${type}`,
		default: true,
		disabled: values => !values[disabledWhen],
	}));
}

function selectionFilterFields() {
	return [
		{ id: "enableTypes", type: "checkbox", labelKey: "field.types" },
		...typeCheckboxes("type", "enableTypes"),
		{ id: "enableTime", type: "checkbox", labelKey: "field.timeRange" },
		{ id: "timeStart", type: "rational", labelKey: "field.time", disabled: values => !values.enableTime },
		{ id: "timeEnd", type: "rational", labelKey: "field.duration", disabled: values => !values.enableTime },
		{ id: "enableText", type: "checkbox", labelKey: "field.text" },
		{ id: "text", type: "text", labelKey: "field.text", disabled: values => !values.enableText },
		{ id: "enableDuration", type: "checkbox", labelKey: "field.durationRange" },
		{ id: "durationStart", type: "rational", labelKey: "field.time", disabled: values => !values.enableDuration },
		{
			id: "durationEnd",
			type: "rational",
			labelKey: "field.duration",
			disabled: values => !values.enableDuration,
		},
		{ id: "enableSimultaneous", type: "checkbox", labelKey: "field.hasSimultaneous" },
		...typeCheckboxes("simultaneous", "enableSimultaneous"),
	];
}

class ChartDialogsTrait {
	async showSelectionFilter() {
		const values = await this.dialogs.form({
			titleKey: "dialog.selectFilter",
			values: {
				enableTypes: true,
				enableText: false,
				text: "",
				enableTime: false,
				timeStart: [0, 0, 1],
				timeEnd: [9999, 0, 1],
				enableDuration: false,
				durationStart: [0, 0, 1],
				durationEnd: [9999, 0, 1],
				enableSimultaneous: false,
			},
			fields: selectionFilterFields(),
		});
		if (!values) {
			return;
		}
		const activeChannels = new Set(
			this.model.channels.filter(channel => channel.active !== false).map(channel => channel.id),
		);
		const candidates = this.model.allEvents().filter(event => eventUsesChannel(event, activeChannels));
		const simultaneousCounts = new Map();
		if (values.enableSimultaneous) {
			for (const event of candidates) {
				if (!values[`simultaneous_${event.type}`]) {
					continue;
				}
				const key = Rational.from(eventTime(event)).toString();
				simultaneousCounts.set(key, (simultaneousCounts.get(key) || 0) + 1);
			}
		}
		const ids = candidates
			.filter(event => {
				if (values.enableTypes && !values[`type_${event.type}`]) {
					return false;
				}
				if (values.enableTime) {
					const beat = Rational.from(eventTime(event));
					if (beat.compare(values.timeStart) < 0 || beat.compare(values.timeEnd) > 0) {
						return false;
					}
				}
				if (
					values.enableText &&
					!String(event.text || "")
						.toLocaleLowerCase()
						.includes(String(values.text).toLocaleLowerCase())
				) {
					return false;
				}
				if (values.enableDuration) {
					if (!event.duration) {
						return false;
					}
					const duration = Rational.from(event.duration);
					if (duration.compare(values.durationStart) < 0 || duration.compare(values.durationEnd) > 0) {
						return false;
					}
				}
				if (values.enableSimultaneous) {
					const key = Rational.from(eventTime(event)).toString();
					const matching =
						(simultaneousCounts.get(key) || 0) - (values[`simultaneous_${event.type}`] ? 1 : 0);
					if (matching <= 0) {
						return false;
					}
				}
				return true;
			})
			.map(event => event.id);
		this.selectEvents(ids, "replace");
	}

	async showSubdivisionDialog() {
		const values = await this.dialogs.form({
			titleKey: "dialog.subdivision",
			values: { subdivision: this.model.editor.subdivision },
			fields: [
				{ id: "subdivision", type: "integer", labelKey: "dialog.subdivision", positive: true, min: 1 },
			],
		});
		if (values) {
			this.setSubdivision(values.subdivision);
		}
	}

	async showSpeedDialog() {
		const values = await this.dialogs.form({
			titleKey: "dialog.speed",
			values: { speed: this.model.editor.speed },
			fields: [
				{ id: "speed", type: "number", labelKey: "dialog.speed", min: 0.1, step: "any", required: true },
			],
		});
		if (values) {
			this.setSpeed(values.speed);
		}
	}

	async showBackgroundPatternDialog() {
		this.exitModes();
		const patternOptions = [
			"bigText",
			"grid",
			"hexagon",
			"checkerboard",
			"diamondGrid",
			"pentagon",
			"turntable",
			"hexagram",
		];
		const values = await this.dialogs.form({
			titleKey: "dialog.backgroundPattern",
			values: { type: "grid", duration: [1, 0, 1], text: "" },
			fields: [
				{
					id: "type",
					type: "radio",
					labelKey: "field.type",
					options: patternOptions.map(value => ({ value, labelKey: `event.${value}` })),
				},
				{ id: "duration", type: "rational", labelKey: "field.duration", positive: true },
				{
					id: "text",
					type: "text",
					labelKey: "field.text",
					disabled: form => form.type !== "bigText",
					required: true,
				},
			],
		});
		if (!values) {
			return;
		}
		this.commit(i18n.t("history.createEvent", { type: eventTypeLabel(values.type) }), model => {
			for (const event of model.events) {
				event.selected = false;
			}
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
		if (index == null) {
			index = this.model.timing.bpmChanges.findIndex(change => Rational.from(change.time).equals(beat));
		}
		const current = index >= 0 ? this.model.timing.bpmChanges[index] : null;
		const eventBeat = current ? Rational.from(current.time) : beat;
		const result = await this.dialogs.open({
			titleKey: "dialog.bpmChange",
			values: { bpm: current?.bpm || this.model.timing.bpmAtBeat(beat) },
			fields: [{ id: "bpm", type: "number", labelKey: "field.bpm", positive: true, min: 0.001, step: "any" }],
			buttons: [
				{ id: "ok", labelKey: "dialog.ok", primary: true, submit: true },
				{ id: "delete", labelKey: "dialog.delete", value: "delete", validate: false },
				{ id: "cancel", labelKey: "dialog.cancel", value: null, cancel: true, validate: false },
			],
		});
		if (!result || result.button === "cancel") {
			return;
		}
		if (result.button === "delete") {
			if (index < 0) {
				return;
			}
			this.commit(i18n.t("dialog.bpmChange"), model => {
				const changes = model.timing.toJSON().bpmChanges;
				changes.splice(index, 1);
				model.timing.setBpmChanges(changes);
			});
			return;
		}
		const values = result.values;
		this.commit(i18n.t("dialog.bpmChange"), model => {
			const changes = model.timing.toJSON().bpmChanges;
			if (index >= 0) {
				changes.splice(index, 1);
			}
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
		if (!values) {
			return;
		}
		this.commit(
			i18n.t("history.createEvent", { type: eventTypeLabel("comment") }),
			model => {
				for (const event of model.events) {
					event.selected = false;
				}
				model.addEvent("comment", {
					time: this.currentBeat().toJSON(),
					channel: model.editor.currentChannel,
					duration: values.duration,
					text: values.text,
					selected: true,
				});
			},
			{ allowReadOnly: true },
		);
	}
}

export const withChartDialogs = composeTraits("ChartDialogsLayer", ChartDialogsTrait);
