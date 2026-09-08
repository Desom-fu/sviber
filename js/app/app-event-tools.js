// Event tools: creation-mode toggling, converting a selection to another type,
// placing a new event, grouping, and reversing selected times.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { createEvent } from "../core/chart-model.js";
import { captureHistoryView } from "../core/history.js";
import { Rational } from "../core/rational.js";
import { clampPointToChartBounds } from "../core/geometry.js";
import {
	PATTERN_TYPES,
	SNAPPEE_COLORS,
	deepClone,
	selected,
	allowsOutOfBounds,
	pointAllowed,
	eventTypeLabel,
	groupEventLeaves,
} from "./app-helpers.js";
import { flattenEvents } from "../core/grouping.js";

export function toggledCreationMode(current, type) {
	return current === type ? null : type;
}

/** Creation+playback unmodified letter/number/symbol key shape (ignores event.repeat). */
export function matchesCreationPlaybackKeyShape(event, creationMode, playing) {
	if (!creationMode || !playing) {
		return false;
	}
	if (event?.ctrlKey || event?.altKey || event?.metaKey) {
		return false;
	}
	if (!event?.key || event.key.length !== 1) {
		return false;
	}
	return /[\p{L}\p{N}\p{S}\p{P}]/u.test(event.key);
}

class EventToolsTrait {
	rememberCreationDefaults(events) {
		for (const event of events || []) {
			if (event.type === "hold" && event.duration) {
				this.lastHoldDuration = deepClone(event.duration);
			} else if (event.type === "bgNote" && event.duration) {
				this.lastBgNoteDuration = deepClone(event.duration);
			} else if (event.type === "flick" && Number.isFinite(Number(event.angle))) {
				this.lastFlickAngle = Number(event.angle);
			}
		}
	}

	chooseEventTool(type) {
		const nextMode = toggledCreationMode(this.creationMode, type);
		if (nextMode === null) {
			this.exitCreationModes();
			return;
		}
		const alreadyCreating = Boolean(this.creationMode);
		this.curveDraft = null;
		this.cancelFreeTransform();
		this.cancelPreview();
		const chosen = selected(this.model).filter(
			event => event.type !== "group" && !PATTERN_TYPES.has(event.type) && !event.locked,
		);
		if (!alreadyCreating && chosen.length) {
			const changes = chosen.map(event => {
				const overrides = { ...event, id: event.id, selected: true };
				if (type === "hold" && event.duration == null) {
					overrides.duration = this.lastHoldDuration;
				}
				if (type === "bgNote" && event.duration == null) {
					overrides.duration = this.lastBgNoteDuration;
				}
				if (type === "flick" && event.angle == null) {
					overrides.angle = this.lastFlickAngle;
				}
				return { oldEvent: event, newEvent: createEvent(type, overrides) };
			});
			const currentIndex = this.renderIndex?.eventSource === this.model.events ? this.renderIndex : null;
			const commitOptions = {
				historyPatch: (_result, model) => ({
					kind: "replaceEvents",
					changes: changes.map(change => ({ id: change.newEvent.id, event: change.newEvent })),
					view: captureHistoryView(model),
				}),
				lightweight: true,
				rebuildIndex: false,
				scheduleDirty: true,
				skipCommands: true,
			};
			this.commit(
				i18n.t("history.editEvent", { type: eventTypeLabel(type) }),
				model => {
					for (const change of changes) {
						model.replaceEvent(change.oldEvent.id, change.newEvent);
					}
					if (!currentIndex?.replaceEvents?.(changes)) {
						commitOptions.rebuildIndex = true;
					}
					return changes;
				},
				commitOptions,
			);
			this.rememberCreationDefaults(selected(this.model));
			return;
		}
		this.creationMode = nextMode;
		this._refreshLightweight?.({ rebuildIndex: false, skipInspector: true, skipHistory: true });
	}

	placementBeat() {
		if (this.audio?.playing && this.creationMode) {
			const offset = Number(this.preferences?.inputOffset) || 0;
			return this.timing().secondsToSnappedBeat(
				this.audio.currentTime + offset,
				this.model.editor.subdivision,
			);
		}
		return this.currentBeat();
	}

	isCreationPlaybackKeyEvent(event) {
		return matchesCreationPlaybackKeyShape(event, this.creationMode, this.audio?.playing);
	}

	isCreationPlaybackKey(event) {
		// Long-press keydown repeats must not place extra notes.
		if (event.repeat) {
			return false;
		}
		return this.isCreationPlaybackKeyEvent(event);
	}

	interceptCreationPlaybackKey(event) {
		// Suppress shortcuts on shape match even for key-repeat; place only on non-repeat.
		if (!this.isCreationPlaybackKeyEvent(event)) {
			return false;
		}
		if (event.target && (event.target.closest?.("input, textarea, select, [contenteditable='true']"))) {
			return false;
		}
		if (!event.repeat) {
			const created = this.placeCreationEventFromPointer();
			// v25: a hold created by holding a key down gets its end time from the key up event.
			if (created && this.creationMode === "hold") {
				this.pendingKeyboardHold = { key: event.key, id: created.id, time: created.time };
			}
		}
		return true;
	}

	// v25: the end time of a keyboard-created hold is the subdivision closest to the key up
	// event; when that is the start time itself, the next subdivision is used instead.
	finishKeyboardHoldCreation(event) {
		const pending = this.pendingKeyboardHold;
		if (!pending || event.repeat || event.key !== pending.key) {
			return;
		}
		this.pendingKeyboardHold = null;
		if (!this.audio?.playing || this.creationMode !== "hold") {
			return;
		}
		const subdivision = this.model.editor.subdivision ?? 4;
		const offset = Number(this.preferences?.inputOffset) || 0;
		const end = this.timing().secondsToSnappedBeat(
			this.audio.currentTime + offset,
			subdivision,
		);
		const start = Rational.from(pending.time);
		let duration = end.sub(start).toJSON();
		if (end.compare(start) <= 0) {
			// The key up landed on the same subdivision as the key down: use the next one.
			duration = Rational.from(end).add(Rational.from([0, 1, subdivision])).sub(start).toJSON();
		}
		this.commit(
			i18n.t("history.editEvent", { type: eventTypeLabel("hold") }),
			model => {
				const hold = model.findEvent(pending.id);
				if (hold) {
					hold.duration = duration;
				}
			},
			{ lightweight: true, rebuildIndex: false, scheduleDirty: true, skipInspector: true, skipHistory: true },
		);
	}

	placeCreationEventFromPointer() {
		const preview = this.stage?.creationPreview;
		if (!this.creationMode || !preview) {
			return null;
		}
		return this.createPositionedEvent(this.creationMode, preview);
	}

	createPositionedEvent(type, preview) {
		const overrides = {
			time: this.placementBeat().toJSON(),
			channel: this.model.editor.currentChannel,
			selected: true,
			angle: this.lastFlickAngle,
			duration: type === "hold" ? this.lastHoldDuration : this.lastBgNoteDuration,
		};
		let position = { x: preview.x, y: preview.y };
		if (!allowsOutOfBounds(this.model)) {
			position = clampPointToChartBounds(preview);
		}
		if (preview.snappeeId != null && pointAllowed(this.model, preview)) {
			overrides.attached = true;
			overrides.snappee = preview.snappeeId;
			overrides.snapPoint = deepClone(preview.snapPoint);
		} else {
			overrides.x = position.x;
			overrides.y = position.y;
		}
		const created = this.commit(
			i18n.t("history.createEvent", { type: eventTypeLabel(type) }),
			model => {
				const currentIndex = this.renderIndex?.eventSource === model.events ? this.renderIndex : null;
				for (const event of currentIndex?.selectedEvents ||
					model.allEvents().filter(event => event.selected)) {
					event.selected = false;
				}
				const event = model.addEvent(type, overrides);
				currentIndex?.appendRootEvent?.(event);
				currentIndex?.replaceSelection?.([event]);
				return event;
			},
			{
				metadata: { creationMode: type },
				historyPatch: (event, model) => ({
					kind: "appendRootEvent",
					event,
					nextEventId: event.id + 1,
					view: captureHistoryView(model, { selectedEventIds: [event.id] }),
				}),
				lightweight: true,
				selectionOnly: true,
				selectionSynced: true,
				rebuildIndex: false,
				skipCommands: true,
			},
		);
		if (created) {
			this.rememberCreationDefaults([created]);
			// v25: the newly created event must not sound its SE right away.
			if (this.audio?.playing) {
				for (const set of ["scheduledHitIds", "scheduledBgNoteIds", "scheduledHoldReleaseIds"]) {
					this[set]?.add?.(created.id);
				}
			}
		}
		return created;
	}

	deleteSelected() {
		this.commit(
			i18n.t("history.deleteEvents"),
			model => {
				const currentIndex = this.renderIndex?.eventSource === model.events ? this.renderIndex : null;
				const removed = [];
				// v19: a locked event behaves as if it were not selected, so deletion skips
				// it; locked descendants of a deleted group are kept in the group's place.
				const removeSelected = items => {
					const kept = [];
					for (const event of items || []) {
						if (event.locked) {
							kept.push(event);
							continue;
						}
					if (event.type === "group" && event.selected) {
						const survivors = [];
						const collectLocked = children => {
							for (const child of children || []) {
								if (child.locked) {
									survivors.push(child);
								} else if (child.type === "group") {
									collectLocked(child.events);
								}
							}
						};
						collectLocked(event.events);
						const survivorSet = new Set(survivors.flatMap(item => flattenEvents([item], true)));
						removed.push(...flattenEvents([event], true).filter(item => !survivorSet.has(item)));
						kept.push(...survivors);
						continue;
					}
						if (event.type === "group") {
							const children = removeSelected(event.events);
							event.events.splice(0, event.events.length, ...children);
							if (!event.events.length) {
								removed.push(event);
								continue;
							}
						}
						if (event.selected) {
							removed.push(event);
						} else {
							kept.push(event);
						}
					}
					return kept;
				};
				const kept = removeSelected(model.events);
				model.events.splice(0, model.events.length, ...kept);
				currentIndex?.removeEvents?.(removed);
				return removed;
			},
			{
				allowReadOnly:
					this.model.editor.readOnly && selected(this.model).every(event => event.type === "comment"),
				historyPatch: (removed, model) => ({
					kind: "removeEvents",
					eventIds: (removed || []).map(event => event.id),
					view: captureHistoryView(model),
				}),
				lightweight: true,
				selectionOnly: true,
				selectionSynced: true,
				rebuildIndex: false,
				scheduleDirty: true,
			},
		);
	}

	groupSelected() {
		const used = this.model
			.allEvents()
			.filter(event => event.type === "group")
			.map(event => event.color);
		const color =
			SNAPPEE_COLORS.find(candidate => !used.includes(candidate)) ||
			SNAPPEE_COLORS[used.length % SNAPPEE_COLORS.length];
		this.commit(i18n.t("history.groupEvents"), model => model.groupSelected(color));
	}

	ungroupSelected() {
		this.commit(i18n.t("history.ungroupEvents"), model => model.ungroupSelected());
	}

	canMoveSelectedChannel(direction) {
		const moved = this._selectedChannelLeaves();
		if (!moved.length) {
			return false;
		}
		const channelIndices = new Map(this.model.channels.map((channel, index) => [channel.id, index]));
		return moved.every(event => {
			const index = channelIndices.get(event.channel);
			const target = this.model.channels[index + direction];
			return Boolean(target && target.active !== false);
		});
	}

	_selectedChannelLeaves() {
		if (this.renderIndex?.eventSource === this.model.events) {
			return this.renderIndex.selectedEvents.filter(event => event.type !== "group" && !event.locked);
		}
		const chosen = selected(this.model).filter(event => !event.locked);
		return [
			...new Set(
				chosen.flatMap(event =>
					groupEventLeaves(this.model, event).filter(item => !item.locked),
				),
			),
		];
	}

	moveSelectedChannel(direction) {
		const moved = this._selectedChannelLeaves();
		const channelIndices = new Map(this.model.channels.map((channel, index) => [channel.id, index]));
		const changes = moved
			.map(event => ({
				event,
				from: event.channel,
				to: this.model.channels[channelIndices.get(event.channel) + direction]?.id,
			}))
			.filter(
				change =>
					change.to != null &&
					this.model.channels[channelIndices.get(change.from) + direction]?.active !== false,
			);
		if (!changes.length || changes.length !== moved.length) {
			return false;
		}
		const currentIndex = this.renderIndex?.eventSource === this.model.events ? this.renderIndex : null;
		const commitOptions = {
			historyPatch: (updates, model) => ({
				kind: "setEventChannels",
				changes: updates,
				view: captureHistoryView(model),
			}),
			lightweight: true,
			rebuildIndex: false,
			scheduleDirty: false,
			skipCommands: true,
		};
		const result = this.commit(
			i18n.t("history.moveEvents"),
			() => {
				for (const change of changes) {
					change.event.channel = change.to;
				}
				try {
					if (!currentIndex?.moveEventsToChannels?.(changes)) {
						commitOptions.rebuildIndex = true;
					}
				} catch {
					commitOptions.rebuildIndex = true;
				}
				return changes.map(change => ({ id: change.event.id, channel: change.to }));
			},
			commitOptions,
		);
		const target = changes[0]?.to;
		if (target != null) {
			this.timeline?.revealChannel?.(target);
		}
		this.registry.notify("events.moveChannelAbove");
		this.registry.notify("events.moveChannelBelow");
		return result;
	}

	lockSelected() {
		this.commit(i18n.t("history.lockEvents"), model => {
			for (const event of model.allEvents()) {
				if (event.selected) {
					event.locked = true;
				}
			}
		});
	}

	unlockSelected() {
		this.commit(i18n.t("history.unlockEvents"), model => {
			for (const event of model.allEvents()) {
				if (event.selected) {
					event.locked = false;
				}
			}
		});
	}

	// v25: Activate/Deactivate toggle the event-level active flag of the whole selection
	// (including groups). Inactive events leave the main field and the scroll view, stay
	// translucent and selectable in the timeline, never sound their SE, and cannot be
	// connected by a tip point.
	setEventsActive(active) {
		this.commit(i18n.t(active ? "history.activateEvents" : "history.deactivateEvents"), model => {
			for (const event of model.allEvents()) {
				if (event.selected) {
					event.active = active;
				}
			}
		});
	}

	canSetEventsActive(active) {
		return selected(this.model).some(event => Boolean(event.active) !== active);
	}

	reverseSelectedTime() {
		this.commit(i18n.t("history.moveEvents"), model => {
			const chosen = model.allEvents().filter(event => event.selected && !event.locked);
			if (!chosen.length) {
				return;
			}
			const moved = [
				...new Set(
					chosen.flatMap(event =>
						groupEventLeaves(model, event).filter(item => !item.locked),
					),
				),
			];
			const beats = moved.map(event => Rational.from(event.time));
			const minimum = beats.reduce((left, right) => (left.compare(right) <= 0 ? left : right));
			const maximum = beats.reduce((left, right) => (left.compare(right) >= 0 ? left : right));
			for (const event of moved) {
				event.time = minimum.add(maximum).sub(event.time).toJSON();
			}
		});
	}
}

export const withEventTools = composeTraits("EventToolsLayer", EventToolsTrait);
