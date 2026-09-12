import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { Rational } from "../core/rational.js";
import { bookmarkAtTime, deleteBookmark, upsertBookmark } from "../core/bookmarks.js";
import { visibleRangeAfterSeek } from "../core/seek-to.js";

class BookmarksTrait {
	async showSeekToDialog() {
		const bookmarks = this.model.editor.bookmarks || [];
		const values = await this.dialogs.form({
			titleKey: "dialog.seekTo",
			values: { time: this.currentBeat().toJSON() },
			fields: [
				{ id: "time", type: "rational", labelKey: "field.time" },
				{
					id: "bookmarks",
					type: "custom",
					hideLabel: true,
					render: ({ document: documentRef, onChange }) => {
						const element = documentRef.createElement("div");
						element.className = "seek-bookmark-list";
						for (const item of bookmarks) {
							const button = documentRef.createElement("button");
							button.type = "button";
							const seconds = this.timing().beatToSeconds(item.time);
							const stamp = `${seconds.toFixed(3)}s`;
							button.textContent = item.name ? `${item.name} (${stamp})` : stamp;
							button.addEventListener("click", () => {
								const tuple = Rational.from(item.time).toJSON();
								const root = element.closest(".dialog-body");
								const inputs = root?.querySelectorAll(".rational-input input");
								if (inputs && inputs.length >= 3) {
									inputs[0].value = String(tuple[0]);
									inputs[1].value = String(tuple[1]);
									inputs[2].value = String(tuple[2]);
								}
								onChange?.({ id: "time", value: tuple });
							});
							element.append(button);
						}
						return { element, read: () => null };
					},
				},
			],
		});
		if (!values) {
			return;
		}
		this.seekToBeat(values.time);
	}

	seekToBeat(time) {
		const editor = this.model.editor;
		const currentSeconds = this.currentSeconds();
		const target = this.timing().beatToSeconds(time);
		const nextRange = visibleRangeAfterSeek(
			{
				visibleRangeBeginning: editor.visibleRangeBeginning,
				visibleRangeEnd: editor.visibleRangeEnd,
				currentSeconds,
			},
			target,
		);
		this.seekBeat(Rational.from(time).toJSON());
		if (
			nextRange.beginning !== editor.visibleRangeBeginning ||
			nextRange.ending !== editor.visibleRangeEnd
		) {
			this.setVisibleRange(nextRange.beginning, nextRange.ending, true);
		}
	}

	async showBookmarkDialog() {
		const beat = this.currentBeat();
		const existing = bookmarkAtTime(this.model.editor.bookmarks, beat);
		const result = await this.dialogs.open({
			titleKey: "dialog.bookmark",
			values: { name: existing?.name || "" },
			fields: [{ id: "name", type: "text", labelKey: "field.bookmarkName", required: false }],
			buttons: [
				{ id: "ok", labelKey: "dialog.ok", primary: true, submit: true },
				{ id: "delete", labelKey: "dialog.delete", value: "delete", validate: false },
				{ id: "cancel", labelKey: "dialog.cancel", value: null, cancel: true, validate: false },
			],
		});
		if (!result || result.button === "cancel") {
			return;
		}
		if (result.button === "delete") {
			this.commit(i18n.t("history.bookmarkDelete"), model => {
				model.editor.bookmarks = deleteBookmark(model.editor.bookmarks, beat);
			});
			return;
		}
		this.commit(i18n.t("history.bookmark"), model => {
			model.editor.bookmarks = upsertBookmark(model.editor.bookmarks, beat, result.values.name);
		});
	}
}

export const withBookmarks = composeTraits("BookmarksLayer", BookmarksTrait);
