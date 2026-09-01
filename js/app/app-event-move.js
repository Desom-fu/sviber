import { i18n } from "../ui/i18n.js";
import { Rational } from "../core/rational.js";
import { deepClone, leafEventsOf, selected } from "./app-helpers.js";

// Timeline drags count channel lanes the way they are drawn: hidden channels are collapsed,
// so a one-lane mouse move must skip them. Inactive (paused) channels stay visible but are
// not a legal landing place.

export function visibleMoveChannels(model) {
	return (model.channels || []).filter(channel => channel.hidden !== true);
}

export function boundedVisibleChannelDelta(model, events, requestedDelta) {
	const visible = visibleMoveChannels(model);
	const indices = (events || [])
		.map(event => visible.findIndex(channel => channel.id === event.channel))
		.filter(index => index >= 0);
	if (!indices.length) {
		return 0;
	}
	const requested = Math.round(Number(requestedDelta) || 0);
	const bounded = Math.max(
		-Math.min(...indices),
		Math.min(visible.length - 1 - Math.max(...indices), requested),
	);
	if (!bounded) {
		return 0;
	}
	if (indices.some(index => visible[index + bounded]?.active === false)) {
		return 0;
	}
	return bounded;
}

// Moving the selection in time and between channels: the incremental preview while a
// timeline drag is in flight, the committed move, and the keyboard nudge by one subdivision.
// Split out of app-event-editing.js.

export class EventMoveTrait {

	previewMoveEvents(deltaBeat, channelDelta, copy) {
		const label = i18n.t("history.moveEvents");
		// A drag that continues an existing preview keeps accumulating into the same state.
		if (!this.previewBase || this.previewLabel !== label) {
			this.previewMoveState = { beat: new Rational(0), channel: 0, copied: false };
		}
		const state = this.previewMoveState;
		const totalBeat = Rational.from(deltaBeat);
		const totalChannel = Math.round(Number(channelDelta) || 0);
		const beatDelta = totalBeat.sub(state.beat);
		const channelDeltaStep = totalChannel - state.channel;
		const copyStep = Boolean(copy) && !state.copied;
		let appliedChannel = 0;
		this.preview(
			label,
			model => {
				appliedChannel = this._applyEventMove(model, beatDelta.toJSON(), channelDeltaStep, copyStep);
			},
			{
				scheduleDirty: true,
				lightweight: true,
				incremental: true,
			},
		);
		state.beat = totalBeat;
		// Track the delta that actually landed, not the requested lane count. A paused
		// channel zeros the step; remembering the request would swallow the later hop.
		state.channel += Number(appliedChannel) || 0;
		state.copied ||= copyStep;
	}

	moveEvents(deltaBeat, channelDelta, copy) {
		this.commit(i18n.t("history.moveEvents"), model =>
			this._applyEventMove(model, deltaBeat, channelDelta, copy),
		);
	}

	_applyEventMove(model, deltaBeat, channelDelta, copy) {
		let events = model
			.allEvents()
			.filter(
				event =>
					event.selected &&
					!event.locked &&
					!model.ancestorsOf(event.id).some(ancestor => ancestor.selected),
			);
		if (!events.length) {
			return 0;
		}
		const movedEvents = [
			...new Set(
				events.flatMap(event =>
					leafEventsOf(model, event).filter(item => !item.locked),
				),
			),
		];
		const visible = visibleMoveChannels(model);
		const boundedChannelDelta = boundedVisibleChannelDelta(model, movedEvents, channelDelta);
		if (copy) {
			for (const event of events) {
				event.selected = false;
			}
			events = events.map(event => model.addEvent({ ...deepClone(event), id: null, selected: true }));
		}
		const delta = Rational.from(deltaBeat);
		const moved = [
			...new Set(
				events.flatMap(event =>
					leafEventsOf(model, event).filter(item => !item.locked),
				),
			),
		];
		for (const event of moved) {
			event.time = Rational.from(event.time).add(delta).toJSON();
			const index = visible.findIndex(channel => channel.id === event.channel);
			if (index >= 0 && boundedChannelDelta) {
				event.channel = visible[index + boundedChannelDelta].id;
			}
		}
		return boundedChannelDelta;
	}

	moveSelectedInTime(direction) {
		const step = Math.sign(Number(direction));
		if (!step) {
			return;
		}
		const delta = new Rational(step, this.model.editor.subdivision);
		this.commit(i18n.t("history.moveEvents"), model => {
			const roots = model
				.allEvents()
				.filter(
					event =>
						event.selected &&
						!event.locked &&
						!model.ancestorsOf(event.id).some(ancestor => ancestor.selected),
				);
			const moved = [
				...new Set(
					roots.flatMap(event =>
						leafEventsOf(model, event).filter(item => !item.locked),
					),
				),
			];
			for (const event of moved) {
				event.time = Rational.from(event.time).add(delta).toJSON();
			}
		});
	}

}
