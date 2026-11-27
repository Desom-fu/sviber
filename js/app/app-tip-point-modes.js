// The tip-point spawn mode of an event, treated as one unit. Editing the spawn type of a
// multi-event selection copies the whole mode across, not just the edited field, so that
// the events end up genuinely identical. Split out of app-event-editing.js.

import { createEvent } from "../core/chart-model.js";
import { inheritedTipPointSource } from "../core/tip-point.js";
import { deepClone, groupEventLeaves, selected } from "./app-helpers.js";

export const TIP_POINTABLE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
const DECLARED_SPAWN_TYPES = new Set(["inherit", "chain", "drop", "none"]);

export const SPAWN_DIRECTIONS = Object.freeze([
	Object.freeze({ id: "events.spawnFromRight", angle: 0, shortcut: "^", inMenu: true }),
	Object.freeze({ id: "events.spawnFromAboveRight", angle: Math.PI / 4, shortcut: "(", inMenu: false }),
	Object.freeze({ id: "events.spawnFromAbove", angle: Math.PI / 2, shortcut: "*", inMenu: true }),
	Object.freeze({ id: "events.spawnFromAboveLeft", angle: (3 * Math.PI) / 4, shortcut: "&", inMenu: false }),
	Object.freeze({ id: "events.spawnFromLeft", angle: Math.PI, shortcut: "$", inMenu: true }),
	Object.freeze({ id: "events.spawnFromBelowLeft", angle: (-3 * Math.PI) / 4, shortcut: "!", inMenu: false }),
	Object.freeze({ id: "events.spawnFromBelow", angle: -Math.PI / 2, shortcut: "@", inMenu: true }),
	Object.freeze({ id: "events.spawnFromBelowRight", angle: -Math.PI / 4, shortcut: "#", inMenu: false }),
]);

function selectedUnlockedLeaves(model) {
	const chosen = selected(model).filter(event => !event.locked);
	return [
		...new Set(
			chosen.flatMap(event => groupEventLeaves(model, event).filter(item => !item.locked)),
		),
	];
}

function relativeSpawnOwner(event, activeLeafEvents, model) {
	if (!TIP_POINTABLE_TYPES.has(event.type)) {
		return null;
	}
	const declared = DECLARED_SPAWN_TYPES.has(event.tipPointSpawnType) ? event.tipPointSpawnType : "inherit";
	if (declared === "none") {
		return null;
	}
	if (declared === "chain" || declared === "drop") {
		return event.tipPointSpawnAbsolutePosition ? null : event;
	}
	if (event.active === false) {
		return null;
	}
	const source = inheritedTipPointSource(activeLeafEvents, event, model);
	if (!source || source.locked || source.tipPointSpawnAbsolutePosition) {
		return null;
	}
	return source;
}

// v28: resolve every event whose relative spawn direction is controlled by the current
// selection (including events whose relative spawn settings are inherited).
export function relativeSpawnDirectionTargets(model) {
	const leaves = selectedUnlockedLeaves(model).filter(event => TIP_POINTABLE_TYPES.has(event.type));
	if (!leaves.length) {
		return [];
	}
	let activeLeafEvents = null;
	const owners = new Map();
	for (const event of leaves) {
		const declared = DECLARED_SPAWN_TYPES.has(event.tipPointSpawnType) ? event.tipPointSpawnType : "inherit";
		if (declared === "inherit" && !activeLeafEvents) {
			activeLeafEvents = model.allEvents({ includeGroups: false }).filter(item => item.active !== false);
		}
		const owner = relativeSpawnOwner(event, activeLeafEvents, model);
		if (owner) {
			owners.set(owner.id, owner);
		}
	}
	return [...owners.values()];
}

export function hasRelativeSpawnDirectionTarget(model) {
	const leaves = selectedUnlockedLeaves(model).filter(event => TIP_POINTABLE_TYPES.has(event.type));
	if (!leaves.length) {
		return false;
	}
	let activeLeafEvents = null;
	for (const event of leaves) {
		const declared = DECLARED_SPAWN_TYPES.has(event.tipPointSpawnType) ? event.tipPointSpawnType : "inherit";
		if (declared === "inherit" && !activeLeafEvents) {
			activeLeafEvents = model.allEvents({ includeGroups: false }).filter(item => item.active !== false);
		}
		if (relativeSpawnOwner(event, activeLeafEvents, model)) {
			return true;
		}
	}
	return false;
}

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
