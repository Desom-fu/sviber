// Bulk editing of textable event texts: either the texts of all selected textable events
// (PROMPT-v25 "Bulk edit texts...") or the texts of one channel at a time
// ("Bulk edit texts by channel..."), with per-option draft and caret memory.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import {
	bulkEditableEventsInChannel,
	bulkEditableSelectedEvents,
	eventTextsToString,
	stringToEventTexts,
} from "../core/bulk-edit-texts.js";
import { Rational } from "../core/rational.js";

class BulkEditTextsTrait {
	// v25: edits the texts of all selected textable events except `comment`, sorted by
	// time and then by channel; there is no channel `<select>` in this popup form.
	async showBulkEditTextsDialog() {
		const events = bulkEditableSelectedEvents(this.model);
		if (!events.length) {
			return false;
		}
		const initial = eventTextsToString(events);
		const values = await this.dialogs.form({
			titleKey: "dialog.bulkEditTexts",
			values: { text: initial },
			fields: [{ id: "text", type: "textarea", labelKey: "field.eventTexts", stacked: true, rows: 12 }],
		});
		if (!values || values.text === initial) {
			return false;
		}
		this.commit(i18n.t("history.bulkEditTexts"), model => {
			stringToEventTexts(values.text, bulkEditableSelectedEvents(model));
		});
		return true;
	}

	canBulkEditTextsSelection() {
		return bulkEditableSelectedEvents(this.model).length > 0;
	}

	canBulkEditTextsByChannel() {
		return this.model.channels.length > 0;
	}

	async showBulkEditTextsByChannelDialog() {
		const initialDrafts = new Map();
		for (const channel of this.model.channels) {
			initialDrafts.set(channel.id, eventTextsToString(bulkEditableEventsInChannel(this.model, channel.id)));
		}
		const current = this.model.editor.currentChannel;
		let activeId = current;
		// Options edited since opening the dialog keep their own drafts and caret
		// positions; untouched options jump to the first textable event at/after the
		// current time instead.
		const drafts = new Map();
		const edited = new Set();
		const savedCaret = new Map();
		const eventsByChannel = new Map();
		for (const channel of this.model.channels) {
			eventsByChannel.set(channel.id, bulkEditableEventsInChannel(this.model, channel.id));
		}
		const values = await this.dialogs.form({
			titleKey: "dialog.bulkEditTextsByChannel",
			values: { channel: current, text: initialDrafts.get(current) || "" },
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
				if (!textControl) {
					return;
				}
				drafts.set(activeId, textControl.read());
				if (textControl.read() !== initialDrafts.get(activeId)) {
					edited.add(activeId);
					savedCaret.set(activeId, {
						start: textControl.element.selectionStart ?? 0,
						end: textControl.element.selectionEnd ?? 0,
					});
				}
				const nextId = Number(next.channel);
				if (nextId === activeId) {
					return;
				}
				activeId = nextId;
				const nextText = drafts.get(nextId) ?? initialDrafts.get(nextId) ?? "";
				textControl.element.value = nextText;
				let caret = savedCaret.get(nextId);
				if (!edited.has(nextId)) {
					caret = caretForCurrentTime(this, eventsByChannel.get(nextId) || [], nextText);
				}
				if (caret) {
					textControl.element.setSelectionRange(caret.start, caret.end ?? caret.start);
				}
			},
		});
		if (!values) {
			return;
		}
		drafts.set(Number(values.channel), values.text);
		this.commit(i18n.t("history.bulkEditTexts"), model => {
			for (const channel of model.channels) {
				let text = initialDrafts.get(channel.id) ?? "";
				if (drafts.has(channel.id)) {
					text = drafts.get(channel.id);
				}
				stringToEventTexts(text, bulkEditableEventsInChannel(model, channel.id));
			}
		});
	}

}

// Character offset in the combined string of the first textable event whose time is at or
// after the current beat.
function caretForCurrentTime(app, events, text) {
	if (!events.length) {
		return { start: text.length, end: text.length };
	}
	const current = app.currentBeat();
	let index = events.findIndex(event => Rational.from(event.time).compare(current) >= 0);
	if (index < 0) {
		index = events.length - 1;
	}
	const offset = eventTextsToString(events.slice(0, index)).length;
	return { start: offset, end: offset };
}

export const withBulkEditTexts = composeTraits("BulkEditTextsLayer", BulkEditTextsTrait);
