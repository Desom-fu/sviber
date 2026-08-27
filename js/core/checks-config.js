// Declarative description of the chart checks: their ids, their parameters and
// where clicking a violation in the checks panel navigates to. Kept dependency-free
// so that both the chart model and the check engine can import it.

// `target` is either "chartProperties" (opens the metadata popup form) or "event"
// (selects the offending events).
export const CHECK_DEFINITIONS = Object.freeze([
	Object.freeze({ id: "emptyMetadata", target: "chartProperties", parameters: Object.freeze([]) }),
	Object.freeze({ id: "irregularDifficulty", target: "chartProperties", parameters: Object.freeze([]) }),
	Object.freeze({
		id: "requiredFingers",
		target: "event",
		parameters: Object.freeze([Object.freeze({ id: "fingers", type: "integer", default: 2, min: 1 })]),
	}),
	Object.freeze({ id: "outOfBoundaryNotes", target: "event", parameters: Object.freeze([]) }),
	Object.freeze({ id: "outOfBoundaryBgNotes", target: "event", parameters: Object.freeze([]) }),
	Object.freeze({
		id: "shortHold",
		target: "event",
		parameters: Object.freeze([Object.freeze({ id: "seconds", type: "number", default: 0.1, min: 0 })]),
	}),
	Object.freeze({
		id: "shortBgPattern",
		target: "event",
		parameters: Object.freeze([Object.freeze({ id: "seconds", type: "number", default: 0.1, min: 0 })]),
	}),
	Object.freeze({
		id: "shortTipPoint",
		target: "event",
		parameters: Object.freeze([Object.freeze({ id: "seconds", type: "number", default: 0.3, min: 0 })]),
	}),
	Object.freeze({ id: "sharpTipPointTurn", target: "event", parameters: Object.freeze([]) }),
	Object.freeze({ id: "teleportingTipPoint", target: "event", parameters: Object.freeze([]) }),
	Object.freeze({ id: "multiCharacterCjk", target: "event", parameters: Object.freeze([]) }),
	Object.freeze({ id: "eventsOutsideMusic", target: "event", parameters: Object.freeze([]) }),
]);

export const CHECK_IDS = Object.freeze(CHECK_DEFINITIONS.map(definition => definition.id));

export function defaultChecks() {
	const result = {};
	for (const definition of CHECK_DEFINITIONS) {
		result[definition.id] = { enabled: true };
		for (const parameter of definition.parameters) {
			result[definition.id][parameter.id] = parameter.default;
		}
	}
	return result;
}

export function normalizeChecks(source) {
	const defaults = defaultChecks();
	if (!source || typeof source !== "object") {
		return defaults;
	}
	for (const definition of CHECK_DEFINITIONS) {
		const provided = source[definition.id];
		if (!provided || typeof provided !== "object") {
			continue;
		}
		defaults[definition.id].enabled = provided.enabled !== false;
		for (const parameter of definition.parameters) {
			const value = Number(provided[parameter.id]);
			if (!Number.isFinite(value)) {
				continue;
			}
			if (parameter.type === "integer" && !Number.isSafeInteger(value)) {
				continue;
			}
			defaults[definition.id][parameter.id] = Math.max(parameter.min ?? -Infinity, value);
		}
	}
	return defaults;
}
