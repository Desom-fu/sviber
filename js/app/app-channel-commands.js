// Channel list mutations: creating, selecting, activating, duplicating and
// reordering channels. Event-to-channel moves live in app-event-tools.js.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { captureHistoryView } from "../core/history.js";
import { deepClone } from "./app-helpers.js";
import { eventUsesChannel } from "../core/grouping.js";

class ChannelCommandsTrait {
	currentChannelIndex() {
		return this.model.channels.findIndex(channel => channel.id === this.model.editor.currentChannel);
	}

	currentChannelActive() {
		return this.model.channels.some(
			channel => channel.id === this.model.editor.currentChannel && channel.active !== false,
		);
	}

	canChangeCurrentChannel(direction) {
		const step = Math.sign(Number(direction));
		const current = this.currentChannelIndex();
		for (let index = current + step; index >= 0 && index < this.model.channels.length; index += step) {
			if (this.model.channels[index].active !== false) {
				return true;
			}
		}
		return false;
	}

	createChannel(relative) {
		this.exitModes();
		this.commit(
			i18n.t("history.createChannel"),
			model => {
				const index = model.channels.findIndex(channel => channel.id === model.editor.currentChannel);
				return model.addChannel(index + relative);
			},
			{
				lightweight: true,
				rebuildIndex: false,
				activeChannels: true,
				channelOnly: true,
				channelLayout: true,
				channelState: true,
				scheduleDirty: false,
				skipInspector: true,
				historyPatch: (channel, model) => ({
					kind: "addChannel",
					channel,
					index: model.channels.findIndex(candidate => candidate.id === channel?.id),
					nextChannelId: channel?.id + 1,
					view: captureHistoryView(model),
				}),
			},
		);
	}

	selectChannel(id) {
		const channel = this.model.channels.find(candidate => candidate.id === id);
		if (!channel || channel.active === false) {
			return false;
		}
		this.model.editor.currentChannel = id;
		this.timeline.revealChannel(id);
		this._refreshLightweight?.({
			rebuildIndex: false,
			channelOnly: true,
			skipInspector: true,
			skipHistory: true,
			skipCommands: true,
		});
		return true;
	}

	canSelectChannelByOrdinal(ordinal) {
		const channels = this.model.channels;
		const index = ordinal === -1 ? channels.length - 1 : ordinal - 1;
		if (index < 0 || index >= channels.length || (ordinal !== -1 && (ordinal < 1 || ordinal > 9))) {
			return false;
		}
		return channels[index].active !== false;
	}

	selectChannelByOrdinal(ordinal) {
		const channels = this.model.channels;
		const index = ordinal === -1 ? channels.length - 1 : ordinal - 1;
		const channel = channels[index];
		return channel && channel.active !== false ? this.selectChannel(channel.id) : false;
	}

	uniqueChannelName(base) {
		const name = String(base || "Channel");
		const names = new Set(this.model.channels.map(channel => channel.name));
		if (!names.has(name)) {
			return name;
		}
		let suffix = 2;
		while (names.has(`${name} ${suffix}`)) {
			suffix += 1;
		}
		return `${name} ${suffix}`;
	}

	activateAllChannels() {
		if (!this.model.channels.some(channel => channel.active === false)) {
			return false;
		}
		this.commit(i18n.t("command.channel.activateAll"), model => {
			for (const channel of model.channels) {
				channel.active = true;
			}
		});
		return true;
	}

	toggleChannel(id) {
		this.commit(
			i18n.t("history.editChannel"),
			model => {
				const index = model.channels.findIndex(channel => channel.id === id);
				const channel = model.channels[index];
				if (!channel) {
					return;
				}
				const activating = channel.active === false;
				channel.active = activating;
				if (activating) {
					if (!model.channels.some(candidate => candidate.id !== id && candidate.active !== false)) {
						model.editor.currentChannel = id;
					}
					return;
				}
				for (const event of model.allEvents()) {
					if (event.channel === id) {
						event.selected = false;
					}
				}
				const activeChannels = new Set(
					model.channels.filter(candidate => candidate.active !== false).map(candidate => candidate.id),
				);
				for (const event of model.allEvents().filter(candidate => candidate.type === "group")) {
					if (!eventUsesChannel(event, activeChannels)) {
						event.selected = false;
					}
				}
				if (model.channels.length <= 1) {
					return;
				}
				const above = model.channels
					.slice(0, index)
					.reverse()
					.find(candidate => candidate.active !== false);
				const below = model.channels.slice(index + 1).find(candidate => candidate.active !== false);
				model.editor.currentChannel = (above || below || channel).id;
			},
			{
				allowReadOnly: true,
				lightweight: true,
				activeChannels: true,
				channelOnly: true,
				rebuildIndex: false,
				selectionOnly: true,
				selectionSynced: true,
				scheduleDirty: true,
				skipCommands: true,
			},
		);
	}

	duplicateChannel(id) {
		this.commit(i18n.t("history.createChannel"), model => {
			const index = model.channels.findIndex(channel => channel.id === id);
			const source = model.channels[index];
			if (!source) {
				return;
			}
			const previousCurrent = model.editor.currentChannel;
			const duplicate = model.addChannel(index + 1, {
				name: this.uniqueChannelName(source.name),
				active: source.active !== false,
			});
			const sourceEvents = model
				.allEvents({ includeGroups: false })
				.filter(event => event.channel === id && !model.ancestorsOf(event.id).length);
			for (const event of sourceEvents) {
				model.addEvent({ ...deepClone(event), id: null, channel: duplicate.id, selected: false });
			}
			if (duplicate.active === false) {
				model.editor.currentChannel = previousCurrent;
			}
		});
	}

	async deleteChannel(id) {
		if (this.model.channels.length <= 1) {
			return;
		}
		if (
			!(await this.dialogs.confirm({
				titleKey: "dialog.deleteChannel",
				messageKey: "dialog.deleteChannelMessage",
			}))
		) {
			return;
		}
		const currentIndex = this.renderIndex?.eventSource === this.model.events ? this.renderIndex : null;
		this.commit(
			i18n.t("history.deleteChannel"),
			model => {
				const before = model.allEvents();
				const removed = model.removeChannel(id);
				if (!removed) {
					return removed;
				}
				const remaining = new Set(model.allEvents().map(event => event.id));
				currentIndex?.removeChannel?.(
					id,
					before.filter(event => !remaining.has(event.id)),
				);
				return removed;
			},
			{
				lightweight: true,
				rebuildIndex: false,
				channelOnly: true,
				channelLayout: true,
				scheduleDirty: true,
				historyPatch: (_removed, model) => ({
					kind: "removeChannel",
					channelId: id,
					view: captureHistoryView(model),
				}),
			},
		);
	}

	async editChannel(id) {
		if (this.audio.playing) {
			return;
		}
		const channel = this.model.channels.find(candidate => candidate.id === id);
		if (!channel) {
			return;
		}
		const values = await this.dialogs.form({
			titleKey: "dialog.editChannel",
			values: { name: channel.name },
			fields: [{ id: "name", type: "text", labelKey: "field.name", required: true }],
		});
		if (!values) {
			return;
		}
		this.commit(i18n.t("history.editChannel"), model => {
			const target = model.channels.find(candidate => candidate.id === id);
			if (target) {
				target.name = String(values.name);
			}
		});
	}

	async deleteCurrentChannel() {
		return this.deleteChannel(this.model.editor.currentChannel);
	}

	moveCurrentChannel(direction) {
		this.moveChannel(this.model.editor.currentChannel, direction);
	}

	moveChannel(id, direction) {
		this.commit(
			i18n.t("history.moveChannel"),
			model => {
				const index = model.channels.findIndex(channel => channel.id === id);
				const target = index + direction;
				if (index < 0 || target < 0 || target >= model.channels.length) {
					return;
				}
				[model.channels[index], model.channels[target]] = [model.channels[target], model.channels[index]];
			},
			{
				lightweight: true,
				viewOnly: true,
				channelOnly: true,
				rebuildIndex: false,
				skipInspector: true,
				scheduleDirty: false,
				skipCommands: true,
			},
		);
	}
}

export const withChannelCommands = composeTraits("ChannelCommandsLayer", ChannelCommandsTrait);
