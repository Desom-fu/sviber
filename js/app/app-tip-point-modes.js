// The tip-point spawn mode of an event, treated as one unit. Editing the spawn type of a
// multi-event selection copies the whole mode across, not just the edited field, so that
// the events end up genuinely identical. Split out of app-event-editing.js.

import { createEvent } from "../core/chart-model.js";
import { deepClone } from "./app-helpers.js";

export const TIP_POINTABLE_TYPES = new Set(["tap", "hold", "drag", "flick"]);

const TIP_POINT_MODE_FIELDS = Object.freeze([
	"tipPointSpawnType",
	"tipPointSpawnAbsolutePosition",
	"tipPointSpawnAttached",
	"tipPointSpawnX",
	"tipPointSpawnY",
	"tipPointSpawnSnappee",
	"tipPointSpawnSnapPoint",
	"tipPointSpawnDistance",
	"tipPointSpawnAngle",
	"tipPointSpawnTimeBeats",
	"tipPointSpawnTime",
]);

// v17: copy the complete tip point mode of the first event onto the rest so that a
// bunch edit of the spawn type leaves every selected event with the same mode.
export function unifyTipPointModes(model, chosen) {
	const targets = chosen
		.map(event => model.findEvent(event.id))
		.filter(Boolean)
		.filter(event => TIP_POINTABLE_TYPES.has(event.type));
	if (targets.length < 2) {
		return targets.length;
	}
	const source = targets[0];
	for (let index = 1; index < targets.length; index += 1) {
		const event = targets[index];
		const overrides = { ...event, id: event.id, selected: true };
		for (const field of TIP_POINT_MODE_FIELDS) {
			if (Object.hasOwn(source, field)) {
				overrides[field] = deepClone(source[field]);
			} else {
				delete overrides[field];
			}
		}
		model.replaceEvent(event.id, createEvent(event.type, overrides));
	}
	return targets.length;
}
