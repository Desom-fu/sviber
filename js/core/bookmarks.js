// Chart bookmarks stored in editor.bookmarks (PROMPT-v26). A bookmark is a named
// (possibly empty) beat; empty names are allowed.

import { Rational } from "./rational.js";

export function normalizeBookmarks(source) {
	if (!Array.isArray(source)) {
		return [];
	}
	const result = [];
	const seen = new Set();
	for (const item of source) {
		if (!item || typeof item !== "object") {
			continue;
		}
		let time;
		try {
			time = Rational.from(item.time).toJSON();
		} catch {
			continue;
		}
		const key = `${time[0]}/${time[1]}/${time[2]}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push({ time, name: String(item.name ?? "") });
	}
	result.sort((left, right) => Rational.compare(left.time, right.time));
	return result;
}

export function bookmarkAtTime(bookmarks, time) {
	const target = Rational.from(time);
	return (bookmarks || []).find(item => Rational.from(item.time).equals(target)) || null;
}

export function upsertBookmark(bookmarks, time, name) {
	const beat = Rational.from(time).toJSON();
	const next = normalizeBookmarks(bookmarks).filter(item => Rational.compare(item.time, beat) !== 0);
	next.push({ time: beat, name: String(name ?? "") });
	return normalizeBookmarks(next);
}

export function deleteBookmark(bookmarks, time) {
	const beat = Rational.from(time);
	return normalizeBookmarks(bookmarks).filter(item => !Rational.from(item.time).equals(beat));
}
