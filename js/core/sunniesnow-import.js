// Translating a published Sunniesnow chart back into an editable sviber model.
//
// The conversion runs in two passes. The first walks the flat Sunniesnow event list and
// adds one sviber event per playable entry, collecting every entry that carries a
// `tipPoint` name into per-trail buckets. The second pass rebuilds those trails: Sunniesnow
// spells a tip point out as a `placeholder` event plus the notes sharing its name, whereas
// sviber stores the trail as a spawn offset on its first note and expects one trail per
// channel. Anything sviber cannot represent is reported through `warnings`.
//
// Split out of js/core/chart-model.js.

import { Rational } from "./rational.js";
import { DURATION_TYPES, EVENT_TYPE_SET, MOVABLE_TYPES, TEXT_TYPES, TIP_POINTABLE_TYPES } from "./chart-vocabulary.js";
import { finiteNumber, normalizeEventType } from "./chart-normalize.js";

function sunniesnowEventOverrides(model, type, properties, context) {
	const { timing, maxDenominator, effectiveSeconds, index, warnings } = context;
	const beat = timing.secondsToBeat(effectiveSeconds, maxDenominator);
	const overrides = { time: beat.toJSON(), channel: model.channels[0].id };
	if (MOVABLE_TYPES.has(type)) {
		overrides.x = finiteNumber(properties.x, 0);
		overrides.y = finiteNumber(properties.y, 0);
	}
	if (DURATION_TYPES.has(type)) {
		const durationSeconds = Math.max(0, finiteNumber(properties.duration, 0));
		overrides.duration = timing.secondsDurationToBeats(effectiveSeconds, durationSeconds, maxDenominator).toJSON();
	}
	if (TEXT_TYPES.has(type)) {
		overrides.text = String(properties.text ?? "");
	}
	if (type === "flick") {
		overrides.angle = finiteNumber(
			Array.isArray(properties.angle) ? properties.angle[0] : properties.angle,
			Math.PI / 2,
		);
		if (Array.isArray(properties.angle) && properties.angle.length > 1) {
			warnings.push(`Only the first flick angle was imported at index ${index}`);
		}
	}
	return overrides;
}

// First pass: add one sviber event per playable Sunniesnow event and bucket everything that
// names a tip point (including placeholders and unsupported types, which still anchor a
// trail) under that name for the second pass.
function collectSunniesnowEvents(model, document, context) {
	const { warnings, chartOffset } = context;
	const tipChains = new Map();
	const sourceEvents = Array.isArray(document.events) ? document.events : [];
	for (let index = 0; index < sourceEvents.length; index += 1) {
		const sourceEvent = sourceEvents[index];
		if (!sourceEvent || typeof sourceEvent !== "object" || !Number.isFinite(sourceEvent.time)) {
			warnings.push(`Ignored malformed event at index ${index}`);
			continue;
		}
		const effectiveSeconds = sourceEvent.time + chartOffset;
		const properties =
			sourceEvent.properties && typeof sourceEvent.properties === "object" ? sourceEvent.properties : {};
		const tipPoint = typeof properties.tipPoint === "string" ? properties.tipPoint : null;
		const addToChain = record => {
			if (!tipPoint) {
				return;
			}
			const list = tipChains.get(tipPoint) ?? [];
			list.push({ ...record, effectiveSeconds, index, properties });
			tipChains.set(tipPoint, list);
		};
		if (sourceEvent.type === "placeholder") {
			addToChain({ placeholder: true, sourceEvent });
			continue;
		}
		const type = normalizeEventType(sourceEvent.type);
		if (!EVENT_TYPE_SET.has(type)) {
			addToChain({ placeholder: false, tipPointable: false, sourceEvent });
			warnings.push(`Ignored unsupported event type ${sourceEvent.type} at index ${index}`);
			continue;
		}
		const overrides = sunniesnowEventOverrides(model, type, properties, { ...context, effectiveSeconds, index });
		const event = model.addEvent(type, overrides);
		if (TIP_POINTABLE_TYPES.has(type)) {
			event.tipPointSpawnType = "none";
		}
		addToChain({ placeholder: false, tipPointable: TIP_POINTABLE_TYPES.has(type), event, sourceEvent });
		if (type === "bgNote" && tipPoint) {
			warnings.push(`The bgNote tip point was omitted at index ${index}`);
		}
		if (sourceEvent.timeDependent || sourceEvent.filters) {
			warnings.push(`Visual-only data was omitted from event at index ${index}`);
		}
	}
	return tipChains;
}

// Reduces one bucket to the shape sviber needs: exactly one leading placeholder that marks
// where the trail starts, followed by the notes it visits in time order. A chart may omit
// the placeholder (the trail then starts on the first note) or repeat it, and members whose
// type sviber cannot chain are dropped.
function chainPlaceholderAndNotes(records) {
	let chain = records
		.filter(record => record.placeholder || (record.tipPointable && record.event))
		.toSorted((left, right) => left.effectiveSeconds - right.effectiveSeconds || left.index - right.index);
	if (!chain.length) {
		return null;
	}
	if (!chain[0].placeholder) {
		const first = chain[0];
		chain.unshift({
			placeholder: true,
			effectiveSeconds: first.effectiveSeconds,
			index: first.index - 0.5,
			properties: {
				x: finiteNumber(first.properties.x, 0),
				y: finiteNumber(first.properties.y, 0),
			},
		});
	}
	while (chain[0]?.placeholder && chain[1]?.placeholder) {
		chain.shift();
	}
	if (!chain[1]) {
		return null;
	}
	chain = [chain[0], ...chain.slice(1).filter(record => !record.placeholder)];
	const notes = chain.slice(1);
	if (!notes.length) {
		return null;
	}
	return { placeholder: chain[0], notes };
}

// A sviber tip-point trail owns its channel for the span it covers, so reuse the first
// channel that holds nothing inside that span and add a new channel when all are busy.
function allocateChainChannel(model, notes) {
	const beginning = Rational.from(notes[0].event.time);
	const ending = Rational.from(notes.at(-1).event.time);
	const chainEventIds = new Set(notes.map(record => record.event.id));
	const free = model.channels.find(
		candidate =>
			!model.events.some(event => {
				if (chainEventIds.has(event.id) || event.channel !== candidate.id) {
					return false;
				}
				const time = Rational.from(event.time);
				return time.compare(beginning) >= 0 && time.compare(ending) <= 0;
			}),
	);
	return free ?? model.addChannel(model.channels.length);
}

// Moves the trail onto its first note as a polar offset plus a lead time, which is how
// sviber stores it, and marks the remaining notes as inheriting that trail.
function applyChainSpawn(placeholder, notes) {
	const first = notes[0];
	first.event.tipPointSpawnType = notes.length === 1 ? "drop" : "chain";
	for (const record of notes.slice(1)) {
		record.event.tipPointSpawnType = "inherit";
	}
	const dx = finiteNumber(placeholder.properties.x, 0) - finiteNumber(first.properties.x, 0);
	const dy = finiteNumber(placeholder.properties.y, 0) - finiteNumber(first.properties.y, 0);
	first.event.tipPointSpawnAbsolutePosition = false;
	first.event.tipPointSpawnDistance = Math.hypot(dx, dy);
	first.event.tipPointSpawnAngle = Math.atan2(dy, dx);
	first.event.tipPointSpawnTimeBeats = false;
	first.event.tipPointSpawnTime = Math.max(0, first.effectiveSeconds - placeholder.effectiveSeconds);
	delete first.event.tipPointSpawnAttached;
	delete first.event.tipPointSpawnX;
	delete first.event.tipPointSpawnY;
	delete first.event.tipPointSpawnSnappee;
	delete first.event.tipPointSpawnSnapPoint;
}

// Second pass: turn every collected bucket back into a sviber tip-point trail.
function rebuildTipPointChains(model, tipChains) {
	for (const records of tipChains.values()) {
		const chain = chainPlaceholderAndNotes(records);
		if (!chain) {
			continue;
		}
		const channel = allocateChainChannel(model, chain.notes);
		for (const record of chain.notes) {
			record.event.channel = channel.id;
		}
		applyChainSpawn(chain.placeholder, chain.notes);
	}
}

// Fills `model` from a parsed Sunniesnow chart document and returns the warning list.
// `context` supplies the TimingMap to convert seconds to beats with, the largest snap
// denominator to allow, and the chart-level offset already folded into every event time.
export function importSunniesnowEvents(model, document, context) {
	const warnings = context.warnings ?? [];
	if (document.filters && Object.keys(document.filters).length) {
		warnings.push("Chart filters are not editable in sviber and were omitted");
	}
	const tipChains = collectSunniesnowEvents(model, document, { ...context, warnings });
	rebuildTipPointChains(model, tipChains);
	model.editor.currentChannel = model.channels[0].id;
	return warnings;
}
