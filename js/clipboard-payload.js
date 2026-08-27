import { eventTime } from "./core/grouping.js";
import { Rational } from "./core/rational.js";
import { constrainPastedEvent, deepClone } from "./app-helpers.js";

// Serialization format of the editor clipboard. A payload is self-contained: events are
// stored relative to the earliest beat and to the leftmost channel of the selection, and
// the channels and snappees they reference travel along so that a paste into a different
// chart can rebuild them. These helpers are deliberately free of UI concerns so that both
// the clipboard commands and the saved clips of the Clips panel can share them.

const PAYLOAD_VERSION = 1;

// Groups contribute their leaf events, every other event contributes itself.
export function leafEventsOf(model, event) {
	if (event.type !== "group") {
		return [event];
	}
	return model.groupDescendants(event.id).filter(item => item.type !== "group");
}

function clearIds(item) {
	item.id = null;
	if (item.type !== "group") {
		return;
	}
	for (const child of item.events || []) {
		clearIds(child);
	}
}

function relativizeTree(model, item, minimumBeat, minimumChannel) {
	if (item.type === "group") {
		for (const child of item.events || []) {
			relativizeTree(model, child, minimumBeat, minimumChannel);
		}
		return;
	}
	item.time = Rational.from(item.time).sub(minimumBeat).toJSON();
	const index = model.channels.findIndex(channel => channel.id === item.channel);
	item.channel = index - minimumChannel;
}

function earliestBeat(events) {
	return events
		.map(event => Rational.from(eventTime(event)))
		.reduce((left, right) => (left.compare(right) <= 0 ? left : right));
}

function channelSpan(model, channelEvents) {
	const indices = channelEvents.map(event => model.channels.findIndex(channel => channel.id === event.channel));
	const minimum = Math.min(...indices);
	const maximum = Math.max(...indices);
	const length = Math.max(0, maximum - minimum + 1);
	return { minimum, indices: Array.from({ length }, (_, offset) => minimum + offset) };
}

// Builds the payload for `chosen`, a list of selected roots without selected ancestors.
export function buildClipboardPayload(model, chosen) {
	const minimumBeat = earliestBeat(chosen);
	const channelEvents = chosen.flatMap(event => leafEventsOf(model, event));
	const { minimum: minimumChannel, indices } = channelSpan(model, channelEvents);
	const snappeeIds = new Set(
		channelEvents.flatMap(event => [event.snappee, event.tipPointSpawnSnappee]).filter(value => value != null),
	);
	const events = chosen.map(event => {
		const copy = deepClone(event);
		clearIds(copy);
		relativizeTree(model, copy, minimumBeat, minimumChannel);
		return copy;
	});
	return {
		version: PAYLOAD_VERSION,
		events,
		channels: indices.map(index => ({
			...deepClone(model.channels[index]),
			channelOffset: index - minimumChannel,
		})),
		snappees: model.snappees.filter(snappee => snappeeIds.has(snappee.id)).map(deepClone),
	};
}

// Bare arrays on the system clipboard are accepted as an event list. When they are byte
// identical with the internal clipboard the richer internal payload wins, so that channel
// and snappee information survives a copy/paste round trip inside the editor.
function payloadFromParsed(parsed, internalData) {
	if (Array.isArray(parsed)) {
		const matchesInternal =
			internalData?.version === PAYLOAD_VERSION &&
			Array.isArray(internalData.events) &&
			JSON.stringify(parsed) === JSON.stringify(internalData.events);
		if (matchesInternal) {
			return internalData;
		}
		return { version: PAYLOAD_VERSION, events: parsed, snappees: [] };
	}
	if (parsed?.version === PAYLOAD_VERSION && Array.isArray(parsed.events)) {
		return parsed;
	}
	return null;
}

export async function resolveClipboardPayload(internalData) {
	try {
		const parsed = JSON.parse(await navigator.clipboard.readText());
		return payloadFromParsed(parsed, internalData) ?? internalData;
	} catch {
		return internalData;
	}
}


function collectSnappeeReferences(event, target) {
	for (const value of [event.snappee, event.tipPointSpawnSnappee]) {
		if (value != null) {
			target.add(value);
		}
	}
	if (event.type !== "group") {
		return;
	}
	for (const child of event.events || []) {
		collectSnappeeReferences(child, target);
	}
}

function uniqueSnappeeName(names, base) {
	let suffix = 2;
	let name = `${base} ${suffix}`;
	while (names.has(name)) {
		suffix += 1;
		name = `${base} ${suffix}`;
	}
	names.add(name);
	return name;
}

// Payloads from another chart carry their snappees; payloads pasted back into the chart
// they came from reference snappees that still exist, so those are looked up by id.
function pasteSourceSnappees(model, data) {
	if (data.snappees?.length) {
		return data.snappees;
	}
	const referenced = new Set();
	for (const event of data.events) {
		collectSnappeeReferences(event, referenced);
	}
	return model.snappees.filter(snappee => referenced.has(snappee.id));
}

function duplicatePastedSnappees(model, data) {
	const names = new Set(model.snappees.map(snappee => snappee.name));
	const snappeeMap = new Map();
	for (const snappee of pasteSourceSnappees(model, data)) {
		const copy = model.addSnappee({
			...deepClone(snappee),
			id: null,
			selected: false,
			name: uniqueSnappeeName(names, snappee.name),
		});
		snappeeMap.set(snappee.id, copy.id);
	}
	return snappeeMap;
}

function channelOffsetOf(event) {
	return Math.max(0, Math.round(Number(event.channelOffset ?? event.channel) || 0));
}

function maximumChannelOffset(events) {
	const offsets = [];
	const visit = item => {
		if (item.type !== "group") {
			offsets.push(channelOffsetOf(item));
			return;
		}
		for (const child of item.events || []) {
			visit(child);
		}
	};
	for (const event of events) {
		visit(event);
	}
	return Math.max(...offsets);
}

function duplicatePastedChannels(app, model, sourceChannels, currentChannel) {
	const channelMap = new Map();
	sourceChannels.forEach((sourceChannel, index) => {
		const declared = Number(sourceChannel.channelOffset);
		const offset = Number.isFinite(declared) ? Math.max(0, Math.round(declared)) : index;
		const channelData = deepClone(sourceChannel);
		delete channelData.channelOffset;
		const duplicate = model.addChannel(currentChannel + offset, {
			...channelData,
			id: null,
			name: app.uniqueChannelName(sourceChannel.name),
		});
		channelMap.set(offset, duplicate.id);
	});
	return channelMap;
}


function remapSnappeeReferences(item, snappeeMap) {
	if (snappeeMap.has(item.snappee)) {
		item.snappee = snappeeMap.get(item.snappee);
	}
	if (snappeeMap.has(item.tipPointSpawnSnappee)) {
		item.tipPointSpawnSnappee = snappeeMap.get(item.tipPointSpawnSnappee);
	}
}

function absolutizeTree(context, item) {
	const { app, model, snappeeMap, channelMap, currentChannel } = context;
	item.selected = true;
	remapSnappeeReferences(item, snappeeMap);
	if (item.type === "group") {
		for (const child of item.events || []) {
			absolutizeTree(context, child);
		}
		return;
	}
	item.time = app
		.currentBeat()
		.add(item.time ?? item.beat ?? 0)
		.toJSON();
	const offset = channelOffsetOf(item);
	item.channel = channelMap.get(offset) ?? model.channels[currentChannel + offset].id;
}

function ensureChannelCapacity(model, currentChannel, maximumOffset) {
	while (currentChannel + maximumOffset >= model.channels.length) {
		model.addChannel(model.channels.length);
	}
}

// Applies a payload inside a history commit. `options.duplicateSnappees` copies the
// referenced snappees instead of sharing them; `options.duplicateChannels` recreates the
// source channels next to the current one instead of reusing the existing ones.
export function applyClipboardPaste(app, model, data, options = {}) {
	const snappeeMap = options.duplicateSnappees ? duplicatePastedSnappees(model, data) : new Map();
	for (const event of model.allEvents()) {
		event.selected = false;
	}
	const currentChannel = model.channels.findIndex(channel => channel.id === model.editor.currentChannel);
	const sourceChannels = Array.isArray(data.channels) ? data.channels : [];
	const duplicateChannels = options.duplicateChannels && sourceChannels.length > 0;
	let channelMap = new Map();
	if (duplicateChannels) {
		channelMap = duplicatePastedChannels(app, model, sourceChannels, currentChannel);
	}
	ensureChannelCapacity(model, currentChannel, maximumChannelOffset(data.events));
	model.editor.currentChannel = model.channels[currentChannel]?.id ?? model.channels[0].id;
	const context = { app, model, snappeeMap, channelMap, currentChannel };
	for (const source of data.events) {
		const copy = deepClone(source);
		copy.id = null;
		absolutizeTree(context, copy);
		delete copy.beat;
		delete copy.channelOffset;
		constrainPastedEvent(model, model.addEvent(copy));
	}
}
