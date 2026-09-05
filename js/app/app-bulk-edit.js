// Bulk edit of textable event texts in one or more channels.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import {
	bulkEditableEventsInChannel,
	eventTextsToString,
	stringToEventTexts,
} from "../core/bulk-edit-texts.js";

class BulkEditTextsTrait {
	async showBulkEditTextsDialog() {
		const drafts = new Map();
		for (const channel of this.model.channels) {
			drafts.set(channel.id, eventTextsToString(bulkEditableEventsInChannel(this.model, channel.id)));
		}
		const current = this.model.editor.currentChannel;
		let activeId = current;
		const values = await this.dialogs.form({
			titleKey: "dialog.bulkEditTexts",
			values: { channel: current, text: drafts.get(current) || "" },
			fields: [
				{
					id: "channel",
					type: "select",
					labelKey: "field.channel",
					options: this.model.channels.map(channel => ({ value: channel.id, label: channel.name })),
				},
				{ id: "text", type: "textarea", labelKey: "field.eventTexts", stacked: true, rows: 12 },
			],
			onChange: (next, { entries }) => {
				const textControl = entries.find(entry => entry.field.id === "text")?.control;
				if (textControl) {
					drafts.set(activeId, textControl.read());
				}
				const nextId = Number(next.channel);
				if (nextId !== activeId && textControl) {
					activeId = nextId;
					textControl.element.value = drafts.get(nextId) || "";
				}
			},
		});
		if (!values) {
			return;
		}
		drafts.set(Number(values.channel), values.text);
		this.commit(i18n.t("history.bulkEditTexts"), model => {
			for (const channel of model.channels) {
				const events = bulkEditableEventsInChannel(model, channel.id);
				stringToEventTexts(drafts.get(channel.id) || "", events);
			}
		});
	}
}

export const withBulkEditTexts = composeTraits("BulkEditTextsLayer", BulkEditTextsTrait);
