// Scrollbar overlay colours and drawing order (PROMPT-v26).
// Heat map < snappee marks < selected-event lines < visible range < A-B and bookmarks < current time.

export const SCROLLBAR_OVERLAY_LAYERS = Object.freeze([
	"heatmap",
	"snappeeMarks",
	"selectedEventLines",
	"visibleRange",
	"abLoopAndBookmarks",
	"currentTime",
]);

export const SELECTED_EVENT_LINE_UNLOCKED = "#ff1a1a";
export const SELECTED_EVENT_LINE_LOCKED = "#ff00ff";
export const BOOKMARK_LINE_COLOR = "#ff8c00";

export function selectedEventLineColor(event) {
	return event?.locked ? SELECTED_EVENT_LINE_LOCKED : SELECTED_EVENT_LINE_UNLOCKED;
}

export function selectedEventOverlayTimes(events, toSeconds) {
	const times = [];
	for (const event of events || []) {
		if (!event?.selected) {
			continue;
		}
		const time = toSeconds(event);
		if (Number.isFinite(time)) {
			times.push({ time, color: selectedEventLineColor(event) });
		}
	}
	return times;
}

export function bookmarkOverlayTimes(bookmarks, toSeconds) {
	return (bookmarks || [])
		.map(item => ({ time: toSeconds(item), color: BOOKMARK_LINE_COLOR }))
		.filter(item => Number.isFinite(item.time));
}
