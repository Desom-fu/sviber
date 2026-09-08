// The "Import lyrics/subtitle file..." dialog (PROMPT-v25): parse an LRC/SRT/WebVTT/ASS
// file, offset and quantize its times, and create `tap`/`bigText` events in the current
// channel following the playfield placement rules of the prompt.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { Rational } from "../core/rational.js";
import { quantizeBeat } from "../core/quantize.js";
import { parseLyrics, placeLyricsCues } from "../core/lyrics-import.js";
import { createEvent } from "../core/chart-events.js";

class LyricsImportTrait {
	async showImportLyricsDialog() {
		const file = await pickLyricsFile();
		if (!file) {
			return false;
		}
		const text = await file.text();
		const filename = file.name || "lyrics.txt";
		const values = await this.dialogs.form({
			titleKey: "dialog.importLyrics",
			values: { offset: "0", denominator: String(this.model.editor.subdivision ?? 4) },
			fields: [
				{ id: "offset", type: "number", labelKey: "field.lyricsOffset", step: 0.001 },
				{
					id: "denominator",
					type: "integer",
					labelKey: "field.quantizationDenominator",
					min: 1,
					step: 1,
					required: true,
				},
			],
		});
		if (!values) {
			return false;
		}
		const offset = Number(values.offset) || 0;
		const denominator = Math.max(1, Math.round(Number(values.denominator) || 1));
		const parsed = parseLyrics(filename, text);
		const cues = placeLyricsCues(parsed, { offset });
		const channelId = this.model.editor.currentChannel;
		this.commit(i18n.t("history.importLyrics"), model => {
			for (const cue of cues) {
				const time = quantizeSecondsWithTiming(this.timing(), cue.time, denominator);
				const overrides = {
					type: cue.type,
					channel: channelId,
					time,
					text: cue.text ?? "",
				};
				if (cue.type === "tap") {
					overrides.x = cue.x;
					overrides.y = cue.y;
				}
				if (cue.type === "bigText" && cue.endTime != null) {
					const end = quantizeSecondsWithTiming(this.timing(), cue.endTime, denominator);
					overrides.duration = Rational.from(end).sub(Rational.from(time)).toJSON();
				}
				model.addEvent(createEvent(overrides.type, overrides));
			}
		});
		return true;
	}

}

// The lyrics import only needs the file contents, so a plain file input works both in the
// browser and under NW.js without touching the platform file dialogue machinery.
function pickLyricsFile() {
	return new Promise(resolve => {
		const input = globalThis.document.createElement("input");
		input.type = "file";
		input.accept = ".lrc,.srt,.vtt,.ass,.ssa,.txt";
		input.addEventListener(
			"change",
			() => {
				input.remove();
				resolve(input.files?.[0] || null);
			},
			{ once: true },
		);
		input.addEventListener(
			"cancel",
			() => {
				input.remove();
				resolve(null);
			},
			{ once: true },
		);
		globalThis.document.body.append(input);
		input.click();
	});
}

function quantizeSecondsWithTiming(timing, seconds, denominator) {
	return quantizeBeat(timing.secondsToBeat(seconds), denominator, "ceil");
}

export const withLyricsImport = composeTraits("LyricsImportLayer", LyricsImportTrait);
