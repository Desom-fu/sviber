// Attachment tools: bulk attaching selected events to a curve, reattaching flips and
// snappee activation shortcuts.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { Rational } from "../core/rational.js";
import { findNearestSnapPoint, resolveAttachedPosition, sampleSnappee } from "../core/geometry.js";
import { deepClone, groupEventLeaves, selected } from "./app-helpers.js";

const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote"]);
const CURVE_TYPES = new Set(["regularPolygonCurve", "bezierCurve", "circularArcCurve", "penCurve", "parametricCurve"]);

function bigAbs(value) {
	return value < 0n ? -value : value;
}

function bigGcd(left, right) {
	let a = bigAbs(left);
	let b = bigAbs(right);
	while (b !== 0n) {
		[a, b] = [b, a % b];
	}
	return a;
}

// gcd of two rationals: gcd(p1 q2, p2 q1) / (q1 q2).
export function rationalGcd(left, right) {
	if (left.numerator === 0n) {
		return right;
	}
	if (right.numerator === 0n) {
		return left;
	}
	const numerator = bigGcd(left.numerator * right.denominator, right.numerator * left.denominator);
	const denominator = left.denominator * right.denominator;
	return new Rational(numerator, denominator);
}

// Would-be order in the exported chart: upper channels first, then the order in which
// the events are stacked in their channel lane (top first).
export function exportOrderedEvents(model, events) {
	const channelOrder = new Map(model.channels.map((channel, index) => [channel.id, index]));
	const sequence = new Map();
	model.allEvents({ includeGroups: false }).forEach((event, index) => sequence.set(event.id, index));
	return [...events].sort((left, right) => {
		const comparison = Rational.compare(left.time, right.time);
		if (comparison !== 0) {
			return comparison;
		}
		const channels = (channelOrder.get(left.channel) ?? Infinity) - (channelOrder.get(right.channel) ?? Infinity);
		if (channels !== 0) {
			return channels;
		}
		return (sequence.get(left.id) ?? 0) - (sequence.get(right.id) ?? 0);
	});
}

class AttachmentTrait {
	// The curve chosen by the user, or the only active curve when nothing is selected.
	attachmentCurve() {
		const chosen = this.model.snappees.find(snappee => snappee.selected && CURVE_TYPES.has(snappee.type));
		if (chosen) {
			return chosen;
		}
		const active = this.model.snappees.filter(
			snappee => snappee.active !== false && CURVE_TYPES.has(snappee.type),
		);
		return active.length === 1 ? active[0] : null;
	}

	selectedMovableEvents() {
		const roots = selected(this.model).filter(
			event => !this.model.ancestorsOf(event.id).some(ancestor => ancestor.selected),
		);
		const flattened = roots.flatMap(event =>
			groupEventLeaves(this.model, event),
		);
		return [...new Set(flattened)].filter(event => MOVABLE_TYPES.has(event.type));
	}

	canAttachToCurve() {
		return Boolean(this.attachmentCurve()) && this.selectedMovableEvents().length > 0;
	}

	_curveSnapPoints(curve) {
		try {
			return sampleSnappee(curve);
		} catch {
			return [];
		}
	}

	_attachAtIndices(curve, ordered, indices, label) {
		const points = this._curveSnapPoints(curve);
		if (!points.length) {
			return false;
		}
		const ids = ordered.map(event => event.id);
		this.commit(label, model => {
			const target = model.snappees.find(snappee => snappee.id === curve.id);
			if (!target) {
				return;
			}
			for (let position = 0; position < ids.length; position += 1) {
				const event = model.findEvent(ids[position]);
				if (!event) {
					continue;
				}
				const clamped = Math.max(0, Math.min(points.length - 1, indices[position]));
				event.attached = true;
				event.snappee = target.id;
				event.snapPoint = deepClone(points[clamped].snapPoint);
				delete event.x;
				delete event.y;
			}
		});
		return true;
	}

	attachSelectedToCurveByOrder() {
		const curve = this.attachmentCurve();
		const events = this.selectedMovableEvents();
		if (!curve || !events.length) {
			return false;
		}
		const ordered = exportOrderedEvents(this.model, events);
		const indices = ordered.map((_, index) => index);
		return this._attachAtIndices(curve, ordered, indices, i18n.t("command.snappee.attachCurveOrder"));
	}

	attachSelectedToCurveByTime() {
		const curve = this.attachmentCurve();
		const events = this.selectedMovableEvents();
		if (!curve || !events.length) {
			return false;
		}
		const ordered = exportOrderedEvents(this.model, events);
		const times = ordered.map(event => Rational.from(event.time));
		const origin = times[0];
		let step = new Rational(0, 1);
		for (const time of times) {
			step = rationalGcd(step, time.sub(origin));
		}
		const indices = times.map(time => {
			if (step.numerator === 0n) {
				return 0;
			}
			return Math.round(time.sub(origin).div(step).toNumber());
		});
		return this._attachAtIndices(curve, ordered, indices, i18n.t("command.snappee.attachCurveTime"));
	}

	// Flip with reattachment: detach, transform, then snap to the closest snap point of
	// the same snappee each event came from.
	flipWithReattachment(matrix) {
		const events = this.selectedMovableEvents().filter(event => event.attached);
		if (!events.length) {
			return this.applyTransformToSelection(matrix);
		}
		const origins = new Map(events.map(event => [event.id, event.snappee]));
		const label = i18n.t("history.transformReattach");
		let applied = false;
		this.commit(label, model => {
			for (const event of model.allEvents()) {
				if (!origins.has(event.id)) {
					continue;
				}
				const position = resolveAttachedPosition(event, model.snappees);
				if (!position) {
					continue;
				}
				event.attached = false;
				event.x = position.x;
				event.y = position.y;
				delete event.snappee;
				delete event.snapPoint;
			}
			applied = this._applyTransformMutation(model, matrix);
			if (!applied) {
				return;
			}
			for (const event of model.allEvents()) {
				if (!origins.has(event.id)) {
					continue;
				}
				const snappee = model.snappees.find(candidate => candidate.id === origins.get(event.id));
				if (!snappee) {
					continue;
				}
				const nearest = findNearestSnapPoint(event, [snappee], { activeOnly: false });
				if (!nearest) {
					continue;
				}
				event.attached = true;
				event.snappee = snappee.id;
				event.snapPoint = deepClone(nearest.snapPoint);
				delete event.x;
				delete event.y;
			}
		});
		return applied;
	}

	setSelectedSnappeeActive(active) {
		const snappee = this.model.snappees.find(candidate => candidate.selected);
		if (!snappee) {
			return false;
		}
		const commandKey = active ? "command.snappee.activate" : "command.snappee.deactivate";
		this.commit(
			i18n.t(commandKey),
			model => {
				const target = model.snappees.find(candidate => candidate.id === snappee.id);
				if (!target) {
					return;
				}
				target.active = Boolean(active);
				if (!active) {
					target.selected = false;
				}
			},
			{
				lightweight: true,
				viewOnly: true,
				snappeeOnly: true,
				rebuildIndex: false,
				skipInspector: true,
				scheduleDirty: false,
				skipCommands: true,
			},
		);
		return true;
	}

	setSnappeesActive(active) {
		if (selected(this.model).length) {
			this.setAttachedSnappeesActive(active);
			return true;
		}
		return this.setSelectedSnappeeActive(active);
	}

	canSetSnappeesActive() {
		return selected(this.model).length > 0 || this.model.snappees.some(snappee => snappee.selected);
	}

	deactivateAllSnappees() {
		if (!this.model.snappees.some(snappee => snappee.active !== false)) {
			return false;
		}
		this.commit(
			i18n.t("command.snappee.deactivateAll"),
			model => {
				for (const snappee of model.snappees) {
					snappee.active = false;
					snappee.selected = false;
				}
			},
			{
				lightweight: true,
				viewOnly: true,
				snappeeOnly: true,
				rebuildIndex: false,
				skipInspector: true,
				scheduleDirty: false,
				skipCommands: true,
			},
		);
		return true;
	}

	// Transform tools moved to the Transform menu in v17.
	async showTimeTranslationDialog() {
		this.exitModes();
		const values = await this.dialogs.form({
			titleKey: "command.transform.timeTranslation",
			values: { offset: [0, 0, 1] },
			fields: [{ id: "offset", type: "rational", labelKey: "field.beatOffset", required: true }],
		});
		if (!values) {
			return null;
		}
		const delta = Rational.from(values.offset);
		this.commit(i18n.t("history.timeTranslation"), model => {
			const roots = model
				.allEvents()
				.filter(
					event => event.selected && !model.ancestorsOf(event.id).some(ancestor => ancestor.selected),
				);
			const events = [
				...new Set(
					roots.flatMap(event =>
						groupEventLeaves(model, event),
					),
				),
			];
			for (const event of events) {
				event.time = Rational.from(event.time).add(delta).toJSON();
			}
		});
		return delta;
	}
}

export const withAttachment = composeTraits("AttachmentLayer", AttachmentTrait);
