import { Rational } from "./rational.js";

// Tree helpers are kept independent from ChartModel so renderers and commands
// can use the same traversal rules without creating a model import cycle.
export function walkEvents(events, visitor, ancestors = []) {
	for (const event of Array.isArray(events) ? events : []) {
		visitor(event, ancestors);
		if (event.type === "group") walkEvents(event.events, visitor, [...ancestors, event]);
	}
}

export function flattenEvents(events, includeGroups = true) {
	const result = [];
	walkEvents(events, event => {
		if (includeGroups || event.type !== "group") result.push(event);
	});
	return result;
}

export function findEvent(events, id) {
	let found = null;
	walkEvents(events, event => { if (found == null && event.id === id) found = event; });
	return found;
}

export function findEventContainer(events, id) {
	let container = null;
	const visit = (items, ancestors) => {
		for (const event of items || []) {
			if (event.id === id) { container = { items, ancestors }; return true; }
			if (event.type === "group" && visit(event.events, [...ancestors, event])) return true;
		}
		return false;
	};
	visit(events, []);
	return container;
}

export function replaceEvent(events, id, replacement) {
	const container = findEventContainer(events, id);
	if (!container) return false;
	const index = container.items.findIndex(event => event.id === id);
	container.items[index] = replacement;
	return true;
}

export function removeEvent(events, id) {
	const container = findEventContainer(events, id);
	if (!container) return null;
	const index = container.items.findIndex(event => event.id === id);
	return container.items.splice(index, 1)[0] || null;
}

export function eventAncestors(events, id) {
	return findEventContainer(events, id)?.ancestors || [];
}

export function groupSiblingEvents(events, ids, factory) {
	const selected = new Set(ids);
	const container = findEventContainer(events, ids[0]);
	if (!container) return null;
	// Grouping is a same-level operation. Never silently drop ids selected in
	// another nested container.
	if (ids.some(id => findEventContainer(events, id)?.items !== container.items)) return null;
	const members = container.items.filter(event => selected.has(event.id));
	if (members.length < 1) return null;
	const first = container.items.findIndex(event => selected.has(event.id));
	container.items = container.items; // Keep the returned container useful to callers.
	container.items.splice(first, 0, factory(members));
	for (let index = container.items.length - 1; index >= 0; index -= 1) {
		if (index !== first && selected.has(container.items[index].id)) container.items.splice(index, 1);
	}
	return container.items[first];
}

export function descendants(event, includeSelf = false) {
	const result = [];
	const visit = item => {
		if (includeSelf || item !== event) result.push(item);
		if (item.type === "group") for (const child of item.events || []) visit(child);
	};
	visit(event);
	return result;
}

export function eventTime(event) {
	if (event?.type !== "group") return event?.time;
	const times = descendants(event)
		.filter(item => item.type !== "group" && item.time != null)
		.map(item => Rational.from(item.time));
	if (!times.length) return [0, 0, 1];
	return times.reduce((left, right) => left.compare(right) <= 0 ? left : right).toJSON();
}

export function eventChannels(event) {
	if (event?.type !== "group") return event?.channel == null ? [] : [event.channel];
	return [...new Set(descendants(event)
		.filter(item => item.type !== "group" && item.channel != null)
		.map(item => item.channel))];
}

export function eventUsesChannel(event, channelIds) {
	const channels = channelIds instanceof Set ? channelIds : new Set(channelIds || []);
	return eventChannels(event).some(channel => channels.has(channel));
}

export function groupBounds(event, resolvePosition = item => item) {
	const points = descendants(event)
		.filter(item => item.type !== "group")
		.map(item => resolvePosition(item))
		.filter(point => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
	if (!points.length) return null;
	return {
		minX: Math.min(...points.map(point => Number(point.x))),
		maxX: Math.max(...points.map(point => Number(point.x))),
		minY: Math.min(...points.map(point => Number(point.y))),
		maxY: Math.max(...points.map(point => Number(point.y))),
	};
}

export function ungroupEvent(events, id) {
	const container = findEventContainer(events, id);
	const group = findEvent(events, id);
	if (!container || group?.type !== "group") return null;
	const index = container.items.findIndex(event => event.id === id);
	container.items.splice(index, 1, ...(group.events || []));
	return group.events || [];
}
