import { i18n } from "../ui/i18n.js";
import { Rational } from "../core/rational.js";
import { deepClone, leafEventsOf, selected } from "./app-helpers.js";

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
		const totalBeat = Rational.from(deltaBeat),
			totalChannel = Math.round(Number(channelDelta) || 0),
			beatDelta = totalBeat.sub(state.beat);
		const channelDeltaStep = totalChannel - state.channel,
			copyStep = Boolean(copy) && !state.copied;
		this.preview(label, model => this._applyEventMove(model, beatDelta.toJSON(), channelDeltaStep, copyStep), {
			scheduleDirty: true,
			lightweight: true,
			incremental: true,
		});
		state.beat = totalBeat;
		state.channel = totalChannel;
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
			return;
		}
		const movedEvents = [
			...new Set(
				events.flatMap(event =>
					leafEventsOf(model, event).filter(item => !item.locked),
				),
			),
		];
		const channelIndices = movedEvents
			.map(event => model.channels.findIndex(channel => channel.id === event.channel))
			.filter(index => index >= 0);
		if (!channelIndices.length) {
			return;
		}
		const requestedChannelDelta = Math.round(Number(channelDelta) || 0);
		let boundedChannelDelta = Math.max(
			-Math.min(...channelIndices),
			Math.min(model.channels.length - 1 - Math.max(...channelIndices), requestedChannelDelta),
		);
		if (
			boundedChannelDelta &&
			channelIndices.some(index => model.channels[index + boundedChannelDelta]?.active === false)
		) {
			boundedChannelDelta = 0;
		}
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
			const index = model.channels.findIndex(channel => channel.id === event.channel);
			if (index >= 0) {
				event.channel = model.channels[index + boundedChannelDelta].id;
			}
		}
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
