// Geometry for the red triangles that mark selected events which are not visible in the
// timeline channels. Hidden-channel events that already have a bright separator mark are
// excluded.

export function selectedEventMarker(record, viewport) {
	const { event, time, channelIndex, visibleChannelCount, rangeStart, rangeEnd } = record;
	if (!event?.selected) {
		return null;
	}
	const inTime = time >= rangeStart && time <= rangeEnd;
	const inChannel = channelIndex >= 0 && channelIndex < visibleChannelCount;
	if (inTime && inChannel) {
		return null;
	}
	if (record.hiddenSeparatorVisible && inTime) {
		return null;
	}
	const earlier = time < rangeStart;
	const later = time > rangeEnd;
	const above = channelIndex < 0;
	const below = channelIndex >= visibleChannelCount;
	if (inChannel && earlier) {
		return { kind: "left", channelIndex, time };
	}
	if (inChannel && later) {
		return { kind: "right", channelIndex, time };
	}
	if (inTime && above) {
		return { kind: "up", time };
	}
	if (inTime && below) {
		return { kind: "down", time };
	}
	if (above && earlier) {
		return { kind: "up-left" };
	}
	if (above && later) {
		return { kind: "up-right" };
	}
	if (below && earlier) {
		return { kind: "down-left" };
	}
	if (below && later) {
		return { kind: "down-right" };
	}
	return null;
}

export function dedupeCornerMarkers(markers) {
	const seen = new Set();
	const result = [];
	for (const marker of markers || []) {
		if (!marker) {
			continue;
		}
		if (marker.kind.includes("-")) {
			if (seen.has(marker.kind)) {
				continue;
			}
			seen.add(marker.kind);
		}
		result.push(marker);
	}
	return result;
}

export function trianglePath(kind, size) {
	const half = size / 2;
	switch (kind) {
		case "left":
			return [
				[0, 0],
				[size, -half],
				[size, half],
			];
		case "right":
			return [
				[0, 0],
				[-size, -half],
				[-size, half],
			];
		case "up":
			return [
				[0, 0],
				[-half, size],
				[half, size],
			];
		case "down":
			return [
				[0, 0],
				[-half, -size],
				[half, -size],
			];
		case "up-left":
			return [
				[0, 0],
				[size, 0],
				[0, size],
			];
		case "up-right":
			return [
				[0, 0],
				[-size, 0],
				[0, size],
			];
		case "down-left":
			return [
				[0, 0],
				[size, 0],
				[0, -size],
			];
		case "down-right":
			return [
				[0, 0],
				[-size, 0],
				[0, -size],
			];
		default:
			return [];
	}
}
