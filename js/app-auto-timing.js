// Automatic timing (FMP Chapter 6 pipeline) and the offset adjustment mode.

import { composeTraits } from "./mixin.js";
import { i18n } from "./i18n.js";
import { Rational } from "./core/rational.js";
import { AUTO_TIMING_DEFAULTS } from "./dsp/auto-timing.js";
import { autoTimingFields, readAutoTimingOptions } from "./auto-timing-form.js";

const MAX_BPM_CHANGE_DENOMINATOR = 192;

function monoSamples(buffer) {
	if (buffer.numberOfChannels === 1) {
		return buffer.getChannelData(0);
	}
	const mono = new Float32Array(buffer.length);
	for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
		const data = buffer.getChannelData(channel);
		for (let index = 0; index < buffer.length; index += 1) {
			mono[index] += data[index] / buffer.numberOfChannels;
		}
	}
	return mono;
}

class AutoTimingTrait {
	// The heavy DSP runs in a worker; when workers are unavailable (tests, exotic
	// embeddings) the pipeline is imported directly instead.
	async runAutoTimingAnalysis(samples, sampleRate, options) {
		if (typeof globalThis.Worker !== "function") {
			const { runAutoTiming } = await import("./dsp/auto-timing.js");
			return runAutoTiming(samples, sampleRate, options);
		}
		const worker = new Worker(new URL("./dsp/auto-timing-worker.js", import.meta.url), { type: "module" });
		const id = `auto-timing-${Date.now()}`;
		try {
			return await new Promise((resolve, reject) => {
				worker.addEventListener("message", event => {
					const data = event.data;
					if (data?.id !== id) {
						return;
					}
					if (data.type === "sviber-auto-timing-result") {
						resolve(data);
					} else {
						reject(new Error(data?.message || "auto timing failed"));
					}
				});
				worker.addEventListener("error", error => reject(error));
				const copy = samples.slice();
				worker.postMessage({ type: "sviber-auto-timing", id, samples: copy, sampleRate, options }, [
					copy.buffer,
				]);
			});
		} finally {
			worker.terminate();
		}
	}

	#timingPreviewText(timing) {
		const lines = [i18n.t("dialog.autoTimingOffset", { value: timing.offset.toFixed(4) })];
		lines.push(i18n.t("dialog.autoTimingInitialBpm", { value: timing.initialBpm.toFixed(4) }));
		if (!timing.bpmChanges.length) {
			lines.push(i18n.t("dialog.autoTimingNoChanges"));
			return lines.join("\n");
		}
		for (const change of timing.bpmChanges) {
			lines.push(
				i18n.t("dialog.autoTimingChange", {
					beat: Number(change.beat).toFixed(3),
					time: Number(change.time).toFixed(4),
					bpm: Number(change.bpm).toFixed(4),
				}),
			);
		}
		return lines.join("\n");
	}

	#applyTiming(model, timing) {
		model.timing.setOffset(timing.offset);
		model.timing.setInitialBpm(timing.initialBpm);
		model.timing.setBpmChanges(
			timing.bpmChanges.map(change => ({
				time: Rational.fromNumber(change.beat, MAX_BPM_CHANGE_DENOMINATOR),
				bpm: change.bpm,
			})),
		);
	}

	#applyAutoTiming(timing) {
		this.commit(i18n.t("history.autoTiming"), model => this.#applyTiming(model, timing));
	}

	async #previewAutoTiming(timing) {
		this.autoTimingPreview ||= this.model.timing.toJSON();
		this.#applyTiming(this.model, timing);
		this.model.editor.metronome = true;
		this.seekBeat(Rational.from(0));
		this.refresh();
		await this.togglePlayback();
	}

	#restoreAutoTimingPreview() {
		if (!this.autoTimingPreview) {
			return;
		}
		if (this.audio.playing) {
			this.audio.pause();
		}
		this.model.timing.setOffset(this.autoTimingPreview.offset);
		this.model.timing.setInitialBpm(this.autoTimingPreview.initialBpm);
		this.model.timing.setBpmChanges(this.autoTimingPreview.bpmChanges || []);
		this.model.timing.setBarLines(this.autoTimingPreview.barLines || []);
		this.autoTimingPreview = null;
		this.refresh();
	}

	async showAutoTimingResult(result) {
		const timing = result.timing;
		const confirmed = await this.dialogs.confirm({
			titleKey: "dialog.autoTimingResult",
			message: this.#timingPreviewText(timing),
			confirmLabelKey: "dialog.apply",
			buttons: [
				{
					id: "preview",
					labelKey: "dialog.preview",
					validate: false,
					value: false,
					onClick: async () => {
						await this.#previewAutoTiming(timing);
						return false;
					},
				},
				{ id: "confirm", labelKey: "dialog.apply", primary: true, value: true, validate: false },
				{ id: "cancel", labelKey: "dialog.cancel", cancel: true, value: false, validate: false },
			],
		});
		this.#restoreAutoTimingPreview();
		if (!confirmed) {
			return null;
		}
		this.#applyAutoTiming(timing);
		this.toast.show("toast.autoTimingApplied");
		return timing;
	}

	async showAutoTimingDialog() {
		this.exitModes();
		if (!this.audio.buffer) {
			return null;
		}
		const values = await this.dialogs.form({
			titleKey: "command.timing.automatic",
			messageKey: "dialog.autoTimingMessage",
			dialogClass: "is-wide",
			values: this.autoTimingValues || undefined,
			fields: autoTimingFields(),
		});
		if (!values) {
			return null;
		}
		this.autoTimingValues = values;
		const options = readAutoTimingOptions(values, AUTO_TIMING_DEFAULTS);
		const samples = monoSamples(this.audio.buffer);
		this.toast.show("toast.autoTimingRunning");
		try {
			const result = await this.runAutoTimingAnalysis(samples, this.audio.buffer.sampleRate, options);
			return await this.showAutoTimingResult(result);
		} catch (error) {
			this.toast.error("toast.autoTimingFailed", { message: String(error?.message || error) });
			return null;
		}
	}

	// Offset adjustment mode: dragging the waveform moves the beat grid instead of
	// the current time. Handled by the timeline, applied here.
	toggleOffsetAdjustment() {
		const next = !this.offsetAdjustment;
		this.offsetAdjustment = next;
		this.timeline.setOffsetAdjustment(next);
		this.registry.setChecked("timing.adjustOffset", next);
		this.requestStatusUpdate();
		return next;
	}

	exitOffsetAdjustment() {
		if (!this.offsetAdjustment) {
			return false;
		}
		this.offsetAdjustment = false;
		this.timeline.setOffsetAdjustment(false);
		this.registry.setChecked("timing.adjustOffset", false);
		this.requestStatusUpdate();
		return true;
	}

	previewOffsetAdjustment(payload) {
		const { offset, bpm, beat, final } = payload || {};
		const label = bpm == null ? i18n.t("history.adjustOffset") : i18n.t("history.adjustBpm");
		const mutate = model => {
			if (offset != null) {
				model.timing.setOffset(offset);
			}
			if (bpm == null) {
				return;
			}
			if (beat == null) {
				model.timing.setInitialBpm(bpm);
				return;
			}
			model.timing.addBpmChange(beat, bpm);
		};
		if (final) {
			this.commit(label, mutate);
			return;
		}
		this.preview(label, mutate, { lightweight: false });
	}
}

export const withAutoTiming = composeTraits("AutoTimingLayer", AutoTimingTrait);
