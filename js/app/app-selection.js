import { i18n } from "../ui/i18n.js";
import { Rational } from "../core/rational.js";
import { selected } from "./app-helpers.js";
import { eventUsesChannel, findEvent } from "../core/grouping.js";

// Committing selections: clicking events, stepping into a group, and range-selecting a
// rectangle of beats and channels. Split out of app-event-editing.js. The live rubber-band
// preview that precedes a box selection lives in app-selection-preview.js.

export class SelectionTrait {

	selectEvents(ids, mode = "replace") {
		this.cancelSelectionPreview();
		const indexIsCurrent = this.renderIndex?.eventSource === this.model.events && !this.renderQueued;
		let activeChannels = this.renderIndex?.activeChannelIds;
		if (!indexIsCurrent) {
			activeChannels = new Set(
				this.model.channels.filter(channel => channel.active !== false).map(channel => channel.id),
			);
		}
		let eventById = this.renderIndex?.eventById;
		if (!indexIsCurrent) {
			eventById = new Map(this.model.allEvents().map(event => [event.id, event]));
		}
		const targets = new Set(
			[...ids].filter(id => mode === "remove" || eventUsesChannel(eventById.get(id), activeChannels)),
		);
		const directSelection = indexIsCurrent? this.renderIndex.selectedEvents.filter(event => event.selected): null;
		const directIds = directSelection ? new Set(directSelection.map(event => event.id)) : null;
		if (mode === "replace" && directIds?.size === targets.size && [...targets].every(id => directIds.has(id))) {
			return;
		}
		let nextSelection = null;
		if (indexIsCurrent) {
			const targetEvents = [...targets].map(id => eventById.get(id)).filter(Boolean);
			if (mode === "replace") {
				nextSelection = targetEvents;
			} else if (mode === "add") {
				nextSelection = [...directSelection, ...targetEvents.filter(event => !directIds.has(event.id))];
			} else {
				nextSelection = directSelection.filter(event => !targets.has(event.id));
			}
		}
		this.commit(
			i18n.t("history.selection"),
			model => {
				if (indexIsCurrent) {
					if (mode === "replace") {
						for (const event of directSelection) {
							event.selected = false;
						}
					}
					for (const id of targets) {
						const event = eventById.get(id);
						if (event) {
							event.selected = mode !== "remove";
						}
					}
					this.renderIndex.replaceSelection(nextSelection);
				} else {
					for (const event of model.allEvents()) {
						if (mode === "replace") {
							event.selected = targets.has(event.id);
						} else if (mode === "add" && targets.has(event.id)) {
							event.selected = true;
						} else if (mode === "remove" && targets.has(event.id)) {
							event.selected = false;
						}
					}
				}
			},
			{
				dirty: false,
				allowPlaying: true,
				allowReadOnly: true,
				scheduleDirty: false,
				lightweight: true,
				selectionOnly: true,
				selectionSynced: indexIsCurrent,
				selectedEventIds: nextSelection?.map(event => event.id),
				rebuildIndex: false,
				skipCommands: true,
			},
		);
	}

	enterGroupSelection(id) {
		const event = this.model.findEvent(id);
		const ancestors = event ? this.model.ancestorsOf(id) : [];
		if (!event || !ancestors.length) {
			return false;
		}
		const scopeIndex =
			this.groupSelectionScope == null? -1: ancestors.findIndex(group => group.id === this.groupSelectionScope);
		if (this.groupSelectionScope != null && scopeIndex < 0) {
			return false;
		}
		const nextGroup = scopeIndex < 0 ? ancestors[0] : ancestors[scopeIndex + 1];
		const target = nextGroup ? ancestors[ancestors.indexOf(nextGroup) + 1] || event : event;
		this.groupSelectionScope = nextGroup?.id ?? this.groupSelectionScope;
		this.commit(
			i18n.t("history.selection"),
			model => {
				for (const candidate of model.allEvents()) {
					candidate.selected = candidate.id === target.id;
				}
			},
			{
				dirty: false,
				allowReadOnly: true,
				scheduleDirty: false,
				lightweight: true,
				selectionOnly: true,
				rebuildIndex: true,
				skipCommands: true,
			},
		);
		return true;
	}

	rangeSelect(targetBeat, targetChannel, mode) {
		const beginningBeat = this.currentBeat();
		const endingBeat = Rational.from(targetBeat);
		const beginningChannel = this.model.channels.findIndex(
			channel => channel.id === this.model.editor.currentChannel,
		);
		const endingChannel = this.model.channels.findIndex(channel => channel.id === targetChannel);
		const minimumBeat = beginningBeat.compare(endingBeat) <= 0 ? beginningBeat : endingBeat;
		const maximumBeat = beginningBeat.compare(endingBeat) <= 0 ? endingBeat : beginningBeat;
		const channelIds = new Set(
			this.model.channels
				.slice(Math.min(beginningChannel, endingChannel), Math.max(beginningChannel, endingChannel) + 1)
				.filter(channel => channel.active !== false)
				.map(channel => channel.id),
		);
		const ids = this.model
			.allEvents({ includeGroups: false })
			.filter(
				event =>
					channelIds.has(event.channel) &&
					Rational.from(event.time).compare(minimumBeat) >= 0 &&
					Rational.from(event.time).compare(maximumBeat) < 0,
			)
			.map(event => this.renderIndex?.selectionTarget(event)?.id || event.id)
			.filter((id, index, values) => values.indexOf(id) === index);
		this.commit(
			i18n.t("history.selection"),
			model => {
				model.editor.currentTime = endingBeat.toJSON();
				model.editor.currentChannel = targetChannel;
				const targets = new Set(ids);
				for (const event of model.allEvents()) {
					if (mode === "replace") {
						event.selected = targets.has(event.id);
					} else if (mode === "add" && targets.has(event.id)) {
						event.selected = true;
					} else if (mode === "remove" && targets.has(event.id)) {
						event.selected = false;
					}
				}
			},
			{
				dirty: false,
				allowReadOnly: true,
				scheduleDirty: false,
				lightweight: true,
				selectionOnly: true,
				rebuildIndex: false,
				skipCommands: true,
			},
		);
	}

}
