// Convert the texts of a channel's textable events (except comments) to a single string
// and back. Movable events are space-separated; unmovable textable events are newline
// separated. Backslash escapes preserve spaces, tabs, newlines and backslashes.

import { MOVABLE_TYPES, TEXT_TYPES } from "./chart-vocabulary.js";

const ESCAPE_PAIRS = Object.freeze([
	["\\", "\\\\"],
	[" ", "\\s"],
	["\n", "\\n"],
	["\t", "\\t"],
]);

const ESCAPE_BACK = Object.freeze({
	"\\": "\\",
	s: " ",
	n: "\n",
	t: "\t",
});

export function isTextableEvent(event) {
	return TEXT_TYPES.has(event?.type);
}

export function isBulkEditableEvent(event) {
	return isTextableEvent(event) && event.type !== "comment";
}

export function convertBackslashEscapes(text) {
	return String(text ?? "").replace(/\\([\\snt])/g, (_match, token) => ESCAPE_BACK[token] ?? token);
}

export function escapeEventText(text) {
	let result = String(text ?? "");
	for (const [from, to] of ESCAPE_PAIRS) {
		result = result.replaceAll(from, to);
	}
	return result;
}

export function eventTextsToString(events) {
	const result = [];
	for (const event of events || []) {
		const text = escapeEventText(event.text);
		if (MOVABLE_TYPES.has(event.type)) {
			result.push(text, " ");
			continue;
		}
		if (result.length) {
			result[result.length - 1] = "\n";
		}
		result.push(text, "\n");
	}
	result.pop();
	return result.join("");
}

export function stringToEventTexts(string, events) {
	const tokens = String(string ?? "").split(/ |\n|\t/);
	const count = Math.max(tokens.length, (events || []).length);
	for (let index = 0; index < count; index += 1) {
		const event = events?.[index];
		if (!event) {
			break;
		}
		const text = tokens[index];
		event.text = text ? convertBackslashEscapes(text) : "";
	}
	return events;
}

export function bulkEditableEventsInChannel(model, channelId) {
	return (model?.allEvents?.({ includeGroups: false }) || model?.events || []).filter(
		event => isBulkEditableEvent(event) && event.channel === channelId,
	);
}
