import { Rational } from "./rational.js";
import { normalizeTipPointFields } from "./chart-model.js";

const TIP_POINTABLE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
const TIP_SPAWN_TYPES = new Set(["inherit", "chain", "drop", "none"]);

export function inheritedTipPointSource(events, target) {
	const channelEvents = (events || [])
		.map((event, sequence) => ({ event, sequence }))
		.filter(({ event }) => TIP_POINTABLE_TYPES.has(event.type) && event.channel === target.channel)
		.toSorted(
			(left, right) => Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence,
		);
	let previousMode = "none";
	let previousSettings = null;
	for (const { event } of channelEvents) {
		const declared = TIP_SPAWN_TYPES.has(event.tipPointSpawnType) ? event.tipPointSpawnType : "inherit";
		const effective = declared === "inherit" ? previousMode : declared;
		if (event === target || (event.id != null && event.id === target.id)) {
			return effective === "none" ? null : previousSettings;
		}
		if (declared === "chain" || declared === "drop") {
			previousSettings = event;
		}
		if (declared === "none") {
			previousSettings = null;
		}
		previousMode = declared === "none" ? "none" : effective;
	}
	return null;
}

export function fillInheritedTipPointParams(event, events) {
	const source = inheritedTipPointSource(events, event);
	if (!source) {
		normalizeTipPointFields(event, { tipPointSpawnType: event.tipPointSpawnType });
		return event;
	}
	normalizeTipPointFields(event, { ...source, tipPointSpawnType: event.tipPointSpawnType });
	return event;
}
