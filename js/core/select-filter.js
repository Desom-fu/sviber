// Selection-filter matching for "Select by filter..." (PROMPT-v26): case/regex text,
// channel (active channels only), tip-point spawn type, and select/add/remove modes.

import { Rational } from "./rational.js";
import { eventTime } from "./grouping.js";
import { TIP_SPAWN_TYPES } from "./chart-vocabulary.js";

export const FILTER_SELECTION_MODES = Object.freeze(["select", "add", "remove"]);

export function matchFilterText(text, query, options = {}) {
	const haystack = String(text ?? "");
	const needle = String(query ?? "");
	if (!needle) {
		return true;
	}
	if (options.regex) {
		try {
			return new RegExp(needle, options.caseSensitive ? "" : "i").test(haystack);
		} catch {
			return false;
		}
	}
	if (options.caseSensitive) {
		return haystack.includes(needle);
	}
	return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

export function eventSpawnType(event) {
	const value = event?.tipPointSpawnType;
	return TIP_SPAWN_TYPES.has(value) ? value : "inherit";
}

export function matchEventFilter(event, values, context = {}) {
	if (values.enableTypes && !values[`type_${event.type}`]) {
		return false;
	}
	if (values.enableTime) {
		const beat = Rational.from(eventTime(event));
		if (beat.compare(values.timeStart) < 0 || beat.compare(values.timeEnd) > 0) {
			return false;
		}
	}
	if (values.enableText && !matchFilterText(event.text, values.text, values)) {
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
	if (values.enableChannel) {
		const channelId = Number(values.channel);
		if (event.channel !== channelId) {
			return false;
		}
	}
	if (values.enableSpawnType && !values[`spawn_${eventSpawnType(event)}`]) {
		return false;
	}
	if (values.enableSimultaneous) {
		const counts = context.simultaneousCounts;
		if (!counts) {
			return false;
		}
		const key = Rational.from(eventTime(event)).toString();
		const matching = (counts.get(key) || 0) - (values[`simultaneous_${event.type}`] ? 1 : 0);
		if (matching <= 0) {
			return false;
		}
	}
	return true;
}

export function applyFilterSelection(currentIds, matchedIds, mode) {
	const current = new Set(currentIds || []);
	const matched = [...new Set(matchedIds || [])];
	if (mode === "add") {
		return [...new Set([...current, ...matched])];
	}
	if (mode === "remove") {
		const drop = new Set(matched);
		return [...current].filter(id => !drop.has(id));
	}
	return matched;
}

export function activeFilterChannels(channels) {
	return (channels || []).filter(channel => channel.active !== false);
}
