// The editable in-memory chart: metadata, timing, channels, events, snappees, clips and
// editor state, plus the import/export bridge between sviber's own document and the
// published Sunniesnow format.
//
// The parts that are useful on their own live in sibling modules and are re-exported from
// here, so every existing importer of this path keeps working:
//   ./chart-vocabulary.js  - event types, per-type capabilities, default metadata/editor
//   ./chart-normalize.js   - coercion of untrusted chart state into canonical values
//   ./chart-events.js      - the event factory and tip-point chain wiring
//   ./chart-snappees.js    - the snappee factory and its per-shape defaults
//   ./sunniesnow-import.js - rebuilding an editable model from a published chart

import { Rational } from "./rational.js";
import { TimingMap } from "./timing.js";
import { normalizeChecks } from "./checks-config.js";
import { resolveAttachedPosition } from "./geometry.js";
import {
	descendants,
	eventAncestors,
	eventUsesChannel,
	findEvent,
	flattenEvents,
	groupBounds,
	groupSiblingEvents,
	removeEvent,
	replaceEvent,
	ungroupEvent,
	walkEvents,
} from "./grouping.js";
import {
	DEFAULT_EDITOR,
	DEFAULT_METADATA,
	DURATION_TYPES,
	MOVABLE_TYPES,
	SUNNIESNOW_SCHEMA,
	TEXT_TYPES,
	TIP_POINTABLE_TYPES,
	TIP_SPAWN_TYPES,
} from "./chart-vocabulary.js";
import {
	assignStableIds,
	clone,
	finiteNumber,
	nextCounter,
	normalizeChannels,
	normalizeEditor,
	normalizeMetadata,
	parseSource,
	positiveInteger,
	validId,
} from "./chart-normalize.js";
import { connectSelectedTipPointChain, createEvent, normalizeEventTree } from "./chart-events.js";
import { createDefaultSnappees, createSnappee } from "./chart-snappees.js";
import { importSunniesnowEvents } from "./sunniesnow-import.js";

export { DIFFICULTY_COLORS, EVENT_TYPES } from "./chart-vocabulary.js";
export { normalizeTipPointFields } from "./chart-events.js";
export { SUNNIESNOW_SCHEMA, connectSelectedTipPointChain, createEvent, createDefaultSnappees, createSnappee };

// An unknown or missing spawn mode behaves as if the note continued the previous trail.
function declaredSpawnMode(event) {
	return TIP_SPAWN_TYPES.has(event.tipPointSpawnType) ? event.tipPointSpawnType : "inherit";
}

export class ChartModel {
	constructor(state = {}) {
		this.metadata = normalizeMetadata(state);
		this.music = typeof state.music === "string" ? state.music : "";
		this.image = typeof state.image === "string" ? state.image : "";
		this.timing = state.timing instanceof TimingMap ? state.timing.clone() : new TimingMap(state.timing ?? {});
		this.channels = normalizeChannels(state.channels);
		this.editor = normalizeEditor(state.editor, this.channels);
		this.snappees = assignStableIds(state.snappees, (snappee, id) =>
			createSnappee(snappee.type, { ...snappee, id }),
		);
		for (const snappee of this.snappees) {
			if (snappee.active === false) {
				snappee.selected = false;
			}
		}
		const activeChannels = new Set(
			this.channels.filter(channel => channel.active !== false).map(channel => channel.id),
		);
		this.events = normalizeEventTree(state.events, this.channels);
		walkEvents(this.events, event => {
			if (
				event.type === "group" ? !eventUsesChannel(event, activeChannels) : !activeChannels.has(event.channel)
			) {
				event.selected = false;
			}
		});
		this.clips = (Array.isArray(state.clips) ? state.clips : []).map((clip, index) => ({
			name: String(clip?.name ?? `Clip ${index + 1}`),
			data: clone(clip?.data ?? { events: [], snappees: [] }),
		}));
		this.checks = normalizeChecks(state.checks);
		const nextIds = state.nextIds ?? {};
		this._nextChannelId = nextCounter(this.channels, nextIds.channel);
		this._nextEventId = Math.max(
			nextCounter(flattenEvents(this.events), nextIds.event),
			flattenEvents(this.events).reduce((max, event) => Math.max(max, event.id + 1), 0),
		);
		this._nextSnappeeId = nextCounter(this.snappees, nextIds.snappee);
		this.importWarnings = Array.isArray(state.importWarnings) ? [...state.importWarnings] : [];
	}

	static createDefault(overrides = {}) {
		return new ChartModel({
			metadata: DEFAULT_METADATA,
			music: "",
			image: "",
			editor: DEFAULT_EDITOR,
			timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
			channels: [{ id: 0 }],
			events: [],
			snappees: createDefaultSnappees(),
			...clone(overrides),
		});
	}

	static import(source, options = {}) {
		const document = parseSource(source);
		if (document.sviber && typeof document.sviber === "object") {
			return ChartModel._importSviber(document);
		}
		return ChartModel._importSunniesnow(document, options);
	}

	static fromJSON(source, options = {}) {
		return ChartModel.import(source, options);
	}

	static _importSviber(document) {
		return new ChartModel({
			...clone(document.sviber),
			metadata: normalizeMetadata(document),
		});
	}

	static _importSunniesnow(document, options) {
		const timingOptions = options.timing ?? options;
		const timing = new TimingMap({
			offset: timingOptions.offset ?? 0,
			initialBpm: timingOptions.initialBpm ?? 120,
			bpmChanges: timingOptions.bpmChanges ?? [],
		});
		const model = ChartModel.createDefault({
			metadata: normalizeMetadata(document),
			timing: timing.toJSON(),
		});
		model.importWarnings = importSunniesnowEvents(model, document, {
			timing,
			maxDenominator: positiveInteger(options.maxDenominator ?? options.largestDenominator, 192),
			chartOffset: finiteNumber(document.offset, 0),
			warnings: [],
		});
		return model;
	}

	_allocate(kind) {
		const field = `_next${kind[0].toUpperCase()}${kind.slice(1)}Id`;
		const id = this[field];
		this[field] += 1;
		return id;
	}

	createEvent(type, overrides = {}) {
		return createEvent(type, {
			...overrides,
			id: this._allocate("event"),
			channel: validId(overrides.channel) ? overrides.channel : this.editor.currentChannel,
		});
	}

	addEvent(typeOrEvent, overrides = {}) {
		const source = typeof typeOrEvent === "string" ? null : clone(typeOrEvent);
		const clearIds = event => {
			event.id = null;
			if (event.type === "group") {
				for (const child of event.events || []) {
					clearIds(child);
				}
			}
			return event;
		};
		let event;
		if (typeof typeOrEvent === "string") {
			event = this.createEvent(typeOrEvent, overrides);
		} else {
			event = createEvent(source.type, { ...clearIds(source), id: this._allocate("event") });
		}
		const assignChildIds = item => {
			if (!validId(item.id)) {
				item.id = this._allocate("event");
			}
			if (item.type === "group") {
				for (const child of item.events || []) {
					assignChildIds(child);
				}
			}
		};
		if (event.type === "group") {
			for (const child of event.events || []) {
				assignChildIds(child);
			}
		}
		if (event.type !== "group") {
			if (!this.channels.some(({ id }) => id === event.channel)) {
				event.channel = this.editor.currentChannel;
			}
			if (this.channels.find(channel => channel.id === event.channel)?.active === false) {
				event.selected = false;
			}
		} else if (
			!eventUsesChannel(
				event,
				new Set(this.channels.filter(channel => channel.active !== false).map(channel => channel.id)),
			)
		) {
			event.selected = false;
		}
		this.events.push(event);
		return event;
	}

	removeEvent(id) {
		return removeEvent(this.events, id);
	}

	allEvents(options = {}) {
		return flattenEvents(this.events, options.includeGroups !== false);
	}

	findEvent(id) {
		return findEvent(this.events, id);
	}

	replaceEvent(id, replacement) {
		return replaceEvent(this.events, id, replacement);
	}

	ancestorsOf(id) {
		return eventAncestors(this.events, id);
	}

	groupSelected(color = "#ff9d3d") {
		const firstSelected = this.allEvents().find(event => event.selected && !event.locked);
		const container = firstSelected && eventAncestors(this.events, firstSelected.id);
		const siblings = firstSelected ? container.at(-1)?.events || this.events : [];
		// v19: locked events behave as if they were not selected, so they stay out of the group.
		const selectedIds = new Set(siblings.filter(event => event.selected && !event.locked).map(event => event.id));
		const members = siblings.filter(event => selectedIds.has(event.id));
		if (!members.length) {
			return null;
		}
		const ids = members.map(event => event.id);
		const positions = members
			.filter(event => MOVABLE_TYPES.has(event.type))
			.map(event => resolveAttachedPosition(event, this.snappees) || event);
		const x = positions.length ? positions.reduce((sum, point) => sum + Number(point.x), 0) / positions.length : 0;
		const y = positions.length ? positions.reduce((sum, point) => sum + Number(point.y), 0) / positions.length : 0;
		const group = groupSiblingEvents(this.events, ids, selected =>
			createEvent("group", {
				id: this._allocate("event"),
				events: selected.map(event => {
					const copy = clone(event);
					const detach = item => {
						if (MOVABLE_TYPES.has(item.type) && item.attached) {
							const position = resolveAttachedPosition(item, this.snappees) || { x: 0, y: 0 };
							item.attached = false;
							item.x = position.x;
							item.y = position.y;
							delete item.snappee;
							delete item.snapPoint;
						}
						item.selected = false;
						if (item.type === "group") {
							for (const child of item.events || []) {
								detach(child);
							}
						}
					};
					detach(copy);
					return copy;
				}),
				x,
				y,
				color,
				selected: true,
			}),
		);
		return group;
	}

	groupDescendants(id, includeSelf = false) {
		const event = this.findEvent(id);
		return event?.type === "group" ? descendants(event, includeSelf) : event ? [event] : [];
	}

	groupBounds(id) {
		const event = this.findEvent(id);
		if (!event || event.type !== "group") {
			return null;
		}
		return groupBounds(event, item => resolveAttachedPosition(item, this.snappees) || item);
	}

	ungroupSelected() {
		const groups = this.allEvents()
			.filter(event => event.type === "group" && event.selected && !event.locked)
			.sort((left, right) => this.ancestorsOf(right.id).length - this.ancestorsOf(left.id).length);
		let changed = false;
		for (const group of groups) {
			if (this.findEvent(group.id)?.type === "group") {
				changed = Boolean(ungroupEvent(this.events, group.id)) || changed;
			}
		}
		return changed;
	}

	addClip(data, name = `Clip ${this.clips.length + 1}`) {
		const clip = { name: String(name), data: clone(data ?? { events: [], snappees: [] }) };
		this.clips.push(clip);
		return clip;
	}

	addChannel(index = this.channels.length, data = {}) {
		const names = new Set(this.channels.map(channel => channel.name));
		let ordinal = this.channels.length + 1;
		while (names.has(`Channel ${ordinal}`)) {
			ordinal += 1;
		}
		const channel = {
			...clone(data),
			id: this._allocate("channel"),
			name: String(data.name ?? `Channel ${ordinal}`),
			active: data.active !== false,
			hidden: data.hidden === true,
		};
		const insertion = Math.max(0, Math.min(this.channels.length, Number(index) || 0));
		this.channels.splice(insertion, 0, channel);
		this.editor.currentChannel = channel.id;
		return channel;
	}

	removeChannel(id) {
		if (this.channels.length <= 1) {
			return null;
		}
		const index = this.channels.findIndex(channel => channel.id === id);
		if (index < 0) {
			return null;
		}
		const [removed] = this.channels.splice(index, 1);
		const prune = items =>
			(items || []).flatMap(event => {
				if (event.channel === id) {
					return [];
				}
				if (event.type === "group") {
					event.events = prune(event.events);
					if (!event.events.length) {
						return [];
					}
				}
				return [event];
			});
		this.events.splice(0, this.events.length, ...prune(this.events));
		if (this.editor.currentChannel === id) {
			const above = this.channels
				.slice(0, index)
				.reverse()
				.find(channel => channel.active !== false);
			const below = this.channels.slice(index).find(channel => channel.active !== false);
			this.editor.currentChannel = (above || below || this.channels[Math.max(0, index - 1)]).id;
		}
		return removed;
	}

	addSnappee(typeOrSnappee, overrides = {}) {
		const source = typeof typeOrSnappee === "string" ? overrides : typeOrSnappee;
		const type = typeof typeOrSnappee === "string" ? typeOrSnappee : typeOrSnappee.type;
		const snappee = createSnappee(type, { ...source, id: this._allocate("snappee") });
		this.snappees.push(snappee);
		return snappee;
	}

	removeSnappee(id, options = {}) {
		const index = this.snappees.findIndex(snappee => snappee.id === id);
		if (index < 0) {
			return null;
		}
		for (const event of this.allEvents()) {
			if (event.attached && event.snappee === id) {
				const position = resolveAttachedPosition(event, this.snappees, options);
				event.attached = false;
				event.x = position?.x ?? 0;
				event.y = position?.y ?? 0;
				delete event.snappee;
				delete event.snapPoint;
			}
			if (
				event.tipPointSpawnAbsolutePosition &&
				event.tipPointSpawnAttached &&
				event.tipPointSpawnSnappee === id
			) {
				const position = resolveAttachedPosition(event, this.snappees, { ...options, prefix: "tipPointSpawn" });
				event.tipPointSpawnAttached = false;
				event.tipPointSpawnX = position?.x ?? 0;
				event.tipPointSpawnY = position?.y ?? 100;
				delete event.tipPointSpawnSnappee;
				delete event.tipPointSpawnSnapPoint;
			}
		}
		return this.snappees.splice(index, 1)[0];
	}

	serializeSviber() {
		const editor = clone(this.editor);
		return {
			music: this.music,
			image: this.image,
			editor,
			timing: this.timing.toJSON(),
			channels: clone(this.channels),
			events: clone(this.events),
			snappees: clone(this.snappees),
			clips: clone(this.clips),
			checks: clone(this.checks),
			nextIds: {
				channel: this._nextChannelId,
				event: this._nextEventId,
				snappee: this._nextSnappeeId,
			},
		};
	}

	snapshot() {
		return { metadata: clone(this.metadata), ...this.serializeSviber() };
	}

	restore(snapshot) {
		const restored = new ChartModel(snapshot);
		Object.assign(this, restored);
		return this;
	}

	_exportEvent(event) {
		const time = this.timing.beatToSeconds(event.time);
		const properties = {};
		if (MOVABLE_TYPES.has(event.type)) {
			const position = resolveAttachedPosition(event, this.snappees) ?? {
				x: finiteNumber(event.x, 0),
				y: finiteNumber(event.y, 0),
			};
			properties.x = position.x;
			properties.y = position.y;
		}
		if (DURATION_TYPES.has(event.type)) {
			properties.duration = Math.max(0, this.timing.durationToSeconds(event.time, event.duration));
		}
		if (TEXT_TYPES.has(event.type)) {
			properties.text = String(event.text ?? "");
		}
		if (event.type === "flick") {
			properties.angle = finiteNumber(event.angle, Math.PI / 2);
		}
		return { type: event.type, time, properties };
	}

	_spawnPosition(event, targetPosition) {
		if (!event.tipPointSpawnAbsolutePosition) {
			const distance = Math.max(0, finiteNumber(event.tipPointSpawnDistance, 100));
			const angle = finiteNumber(event.tipPointSpawnAngle, Math.PI / 2);
			return {
				x: targetPosition.x + distance * Math.cos(angle),
				y: targetPosition.y + distance * Math.sin(angle),
			};
		}
		return (
			resolveAttachedPosition(event, this.snappees, { prefix: "tipPointSpawn" }) ?? {
				x: finiteNumber(event.tipPointSpawnX, 0),
				y: finiteNumber(event.tipPointSpawnY, 100),
			}
		);
	}

	// The spawn lead time is stored either as a rational number of beats or as seconds.
	_spawnTime(targetEvent, spawnSettings, targetTime) {
		if (spawnSettings.tipPointSpawnTimeBeats) {
			const beat = Rational.from(targetEvent.time).sub(spawnSettings.tipPointSpawnTime ?? 1);
			return this.timing.beatToSeconds(beat);
		}
		return targetTime - Math.max(0, finiteNumber(spawnSettings.tipPointSpawnTime, 1));
	}

	_makePlaceholder(targetEvent, spawnSettings, tipPoint, sequence, channelIndex) {
		const targetPosition = resolveAttachedPosition(targetEvent, this.snappees) ?? {
			x: finiteNumber(targetEvent.x, 0),
			y: finiteNumber(targetEvent.y, 0),
		};
		const spawnPosition = this._spawnPosition(spawnSettings, targetPosition);
		const targetTime = this.timing.beatToSeconds(targetEvent.time);
		const spawnTime = this._spawnTime(targetEvent, spawnSettings, targetTime);
		return {
			exported: {
				type: "placeholder",
				time: spawnTime,
				properties: { x: spawnPosition.x, y: spawnPosition.y, tipPoint },
			},
			sequence,
			placeholder: true,
			channelIndex,
		};
	}

	// Walks one channel in time order and turns sviber's per-note spawn modes into the
	// shared `tipPoint` names Sunniesnow uses, appending the placeholder that anchors each
	// trail to `placeholders`.
	_assignChannelTipPoints(records, channel, placeholders, nextTipPointName) {
		const channelEvents = records
			.filter(({ event }) => event.channel === channel.id && TIP_POINTABLE_TYPES.has(event.type))
			.toSorted(
				(left, right) => Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence,
			);
		let previousMode = "none";
		let previousSettings = null;
		let chainTipPoint = null;
		for (const record of channelEvents) {
			const declaredMode = declaredSpawnMode(record.event);
			const effectiveMode = declaredMode === "inherit" ? previousMode : declaredMode;
			if (effectiveMode === "chain") {
				if (declaredMode === "chain" || !chainTipPoint) {
					previousSettings = record.event;
					chainTipPoint = nextTipPointName(record.event);
					placeholders.push(
						this._makePlaceholder(
							record.event,
							previousSettings,
							chainTipPoint,
							record.sequence,
							record.channelIndex,
						),
					);
				}
				record.exported.properties.tipPoint = chainTipPoint;
			} else if (effectiveMode === "drop") {
				if (declaredMode === "drop" || !previousSettings) {
					previousSettings = record.event;
				}
				const tipPoint = nextTipPointName(record.event);
				record.exported.properties.tipPoint = tipPoint;
				placeholders.push(
					this._makePlaceholder(
						record.event,
						previousSettings,
						tipPoint,
						record.sequence,
						record.channelIndex,
					),
				);
				chainTipPoint = null;
			} else {
				chainTipPoint = null;
				if (effectiveMode === "none") {
					previousSettings = null;
				}
			}

			previousMode = effectiveMode;
			if (declaredMode === "chain" || declaredMode === "drop") {
				previousSettings = record.event;
			}
			if (declaredMode === "none") {
				previousMode = "none";
				previousSettings = null;
			}
		}
	}

	generateSunniesnowEvents() {
		const channelOrder = new Map(this.channels.map((channel, index) => [channel.id, index]));
		const activeChannels = new Set(
			this.channels.filter(channel => channel.active !== false).map(channel => channel.id),
		);
		const records = this.allEvents({ includeGroups: false })
			.filter(event => event.type !== "comment" && activeChannels.has(event.channel))
			.map((event, sequence) => ({
				event,
				exported: this._exportEvent(event),
				channelIndex: channelOrder.get(event.channel) ?? Infinity,
				sequence,
				placeholder: false,
			}));
		const placeholders = [];
		let guideSerial = 0;
		const nextTipPointName = event => `sviber-tip-${event.id}-${guideSerial++}`;
		for (const channel of this.channels) {
			this._assignChannelTipPoints(records, channel, placeholders, nextTipPointName);
		}
		return [...records, ...placeholders]
			.toSorted(
				(left, right) =>
					left.channelIndex - right.channelIndex ||
					left.exported.time - right.exported.time ||
					Number(right.placeholder) - Number(left.placeholder) ||
					left.sequence - right.sequence,
			)
			.map(({ exported }) => exported);
	}

	exportSunniesnow(options = {}) {
		const result = {
			...clone(this.metadata),
			events: this.generateSunniesnowEvents(),
		};
		if (options.sscharterVersion) {
			result.sscharter = { version: String(options.sscharterVersion) };
		}
		if (options.includeSchema ?? true) {
			result.$schema = SUNNIESNOW_SCHEMA;
		}
		return result;
	}

	toJSON(options = {}) {
		if (options.includeGeneratedEvents === false) {
			const metadataOnly = { ...clone(this.metadata), $schema: SUNNIESNOW_SCHEMA };
			return { ...metadataOnly, sviber: this.serializeSviber() };
		}
		return { ...this.exportSunniesnow(), sviber: this.serializeSviber() };
	}

	serialize(space = 2, options = {}) {
		return JSON.stringify(this.toJSON(options), null, space);
	}

	clone() {
		return ChartModel.import(this.toJSON());
	}
}

export function createDefaultChartState(overrides = {}) {
	return ChartModel.createDefault(overrides).snapshot();
}

export function importChart(source, options = {}) {
	return ChartModel.import(source, options);
}

export function exportSunniesnowChart(model, options = {}) {
	return (model instanceof ChartModel ? model : new ChartModel(model)).exportSunniesnow(options);
}

export default ChartModel;
