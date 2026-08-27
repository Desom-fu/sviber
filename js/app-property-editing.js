import { i18n } from "./i18n.js";
import { connectSelectedTipPointChain, createEvent } from "./core/chart-model.js";
import { fillInheritedTipPointParams } from "./core/tip-point.js";
import { Rational } from "./core/rational.js";
import { clampPointToChartBounds, resolveAttachedPosition } from "./core/geometry.js";
import { MOVABLE_TYPES, DURATION_TYPES, deepClone, selected, allowsOutOfBounds } from "./app-helpers.js";
import { findEvent } from "./core/grouping.js";
import { unifyTipPointModes } from "./app-tip-point-modes.js";

// Editing a property of every selected event from the inspector. One inspector change can
// mean very different things depending on the property: plain fields are assigned, positions
// and tip-point spawns are validated against the playfield bounds, durations are clamped, and
// changing the event type rewrites the event. Split out of app-event-editing.js.

function applyEndTime(chosen, value) {
	const end = Rational.from(value);
	const zeroAllowed = new Set(["bgNote", "comment"]);
	if (
		!chosen.every(event => {
			const comparison = end.compare(event.time);
			const zeroOk = comparison === 0 && zeroAllowed.has(event.type);
			return DURATION_TYPES.has(event.type) && (comparison > 0 || zeroOk);
		})
	) {
		return false;
	}
	for (const event of chosen) {
		event.duration = end.sub(event.time).toJSON();
	}
	return true;
}

function applyTypeChange(model, chosen, value, defaults) {
	for (const event of chosen) {
		const overrides = { ...event, id: event.id, selected: true };
		if (value === "hold" && event.duration == null) {
			overrides.duration = defaults.lastHoldDuration;
		}
		if (value === "bgNote" && event.duration == null) {
			overrides.duration = defaults.lastBgNoteDuration;
		}
		if (value === "flick" && event.angle == null) {
			overrides.angle = defaults.lastFlickAngle;
		}
		model.replaceEvent(event.id, createEvent(value, overrides));
	}
}

function shiftGroupCoordinate(model, event, property, nextValue) {
	if (event.attached) {
		return;
	}
	const current = Number(event[property]) || 0;
	const delta = Number(nextValue) - current;
	if (!Number.isFinite(delta)) {
		return;
	}
	for (const descendant of model.groupDescendants(event.id)) {
		if (!MOVABLE_TYPES.has(descendant.type)) {
			continue;
		}
		if (descendant.attached) {
			const resolved = resolveAttachedPosition(descendant, model.snappees);
			if (resolved) {
				descendant.attached = false;
				descendant.x = resolved.x;
				descendant.y = resolved.y;
				delete descendant.snappee;
				delete descendant.snapPoint;
			}
		}
		descendant[property] = (Number(descendant[property]) || 0) + delta;
	}
	event[property] = Number(nextValue);
}

function applyOneEventProperty(model, event, property, value) {
	if (
		property === "tipPointSpawnType" &&
		(value === "chain" || value === "drop") &&
		(event.tipPointSpawnType || "inherit") === "inherit"
	) {
		fillInheritedTipPointParams(event, model.allEvents());
		event.tipPointSpawnType = value;
		return;
	}
	let nextValue = value;
	if ((property === "x" || property === "y") && event.type === "group") {
		shiftGroupCoordinate(model, event, property, nextValue);
		return;
	}
	if ((property === "x" || property === "y") && event.attached) {
		return;
	}
	if ((property === "x" || property === "y") && !allowsOutOfBounds(model)) {
		const point = clampPointToChartBounds({
			x: property === "x" ? nextValue : event.x,
			y: property === "y" ? nextValue : event.y,
		});
		nextValue = point[property];
	}
	if (property === "duration" || property.startsWith("tipPoint")) {
		model.replaceEvent(
			event.id,
			createEvent(event.type, { ...event, [property]: deepClone(nextValue), id: event.id, selected: true }),
		);
		return;
	}
	event[property] = deepClone(nextValue);
}

function applySelectedPropertyMutation(model, property, value, defaults) {
	const chosen = model.allEvents().filter(event => event.selected);
	const channelExists = model.channels.some(
		channel => channel.id === Number(value) && channel.active !== false,
	);
	if (property === "channel" && !channelExists) {
		return;
	}
	if (property === "endTime") {
		applyEndTime(chosen, value);
		return;
	}
	if (property === "type") {
		applyTypeChange(model, chosen, value, defaults);
		return;
	}
	for (const event of chosen) {
		applyOneEventProperty(model, event, property, value);
	}
	if (property === "tipPointSpawnType") {
		unifyTipPointModes(model, chosen);
	}
}

export class PropertyEditingTrait {

	editSelectedProperty(property, value) {
		const historyLabel = i18n.t("history.editEvent", { type: "" });
		const commentProperties = new Set(["time", "channel", "duration", "endTime", "text"]);
		const allowReadOnly =
			this.model.editor.readOnly &&
			selected(this.model).length > 0 &&
			selected(this.model).every(event => event.type === "comment") &&
			commentProperties.has(property);
		if (
			property === "tipPointSpawnType" &&
			value === "chain" &&
			this.model.allEvents().filter(event => event.selected).length > 1
		) {
			const selectedEvent = this.model.allEvents().find(event => event.selected);
			const scopeGroup =
				(this.groupSelectionScope && this.model.findEvent(this.groupSelectionScope)) ||
				(selectedEvent && this.model.ancestorsOf(selectedEvent.id).at(-1));
			const scope = scopeGroup?.events || this.model.events;
			const result = this.commit(historyLabel, model => connectSelectedTipPointChain(scope));
			if (!result?.ok) {
				this.toast.error("toast.tipPointChainSelection");
			}
			return result;
		}
		const result = this.commit(
			historyLabel,
			model =>
				applySelectedPropertyMutation(model, property, value, {
					lastHoldDuration: this.lastHoldDuration,
					lastBgNoteDuration: this.lastBgNoteDuration,
					lastFlickAngle: this.lastFlickAngle,
				}),
			{ allowReadOnly },
		);
		if (property === "duration" || property === "endTime" || property === "angle" || property === "type") {
			this.rememberCreationDefaults(selected(this.model));
		}
		return result;
	}

}
