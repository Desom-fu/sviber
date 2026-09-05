// Editor preferences, autosave interval, import-option dialogs and media loading.

import { composeTraits } from "../core/mixin.js";
import { i18n, SUPPORTED_LANGUAGES } from "../ui/i18n.js";
import { ChartModel } from "../core/chart-model.js";
import { Rational } from "../core/rational.js";
import {
	loadPreferences,
	storePreferences,
	resolvePreferenceLanguage,
	applyThemePreference,
	applyPresetDifficultyColor,
	difficultyColor,
	trackDialogFieldEdits,
} from "./app-helpers.js";

export function importTimingDefaults(document) {
	const noteTimes = (Array.isArray(document?.events) ? document.events : [])
		.filter(event => ["tap", "flick", "hold", "drag"].includes(event?.type))
		.map(event => {
			try {
				return Array.isArray(event.time) ? Rational.from(event.time).toNumber() : Number(event.time);
			} catch {
				return NaN;
			}
		})
		.filter(Number.isFinite)
		.sort((left, right) => left - right);
	const first = noteTimes[0];
	const next = noteTimes.find(time => time > first + 1e-9);
	const interval = next == null ? 0 : next - first;
	return {
		offset: first == null ? 0 : first,
		initialBpm: interval > 0 ? 60 / interval : 120,
	};
}

function preferenceFields(app) {
	return [
		{
			id: "theme",
			type: "select",
			labelKey: "field.theme",
			options: [
				{ value: "system", labelKey: "option.theme.system" },
				{ value: "light", labelKey: "option.theme.light" },
				{ value: "dark", labelKey: "option.theme.dark" },
			],
		},
		{
			id: "language",
			type: "select",
			labelKey: "field.language",
			options: [
				{ value: "system", labelKey: "option.language.system" },
				...SUPPORTED_LANGUAGES.map(value => ({ value, labelKey: `option.language.${value}` })),
			],
		},
		{ id: "noteSpeed", type: "number", labelKey: "field.noteSpeed", positive: true, min: 0.01, step: "any" },
		{
			id: "inputOffset",
			type: "number",
			labelKey: "field.inputOffset",
			step: 0.001,
			unit: "s",
			action: {
				labelKey: "field.inputOffsetAdjust",
				onClick: input => app.adjustInputOffset(input),
			},
		},
		{
			id: "visibleChannels",
			type: "integer",
			labelKey: "field.visibleChannels",
			min: 1,
			max: 16,
		},
		{
			id: "eventIconSize",
			type: "number",
			labelKey: "field.eventIconSize",
			min: 4,
			max: 24,
			step: 0.5,
		},
		{
			id: "seVolume",
			type: "slider",
			labelKey: "field.seVolume",
			min: 0,
			max: 2,
			step: 0.05,
			formatValue: value => value.toFixed(2),
		},
		{
			id: "musicVolume",
			type: "slider",
			labelKey: "field.musicVolume",
			min: 0,
			max: 2,
			step: 0.05,
			formatValue: value => value.toFixed(2),
		},
		{
			id: "liveHostingAddress",
			type: "text",
			labelKey: "field.liveHostingAddress",
			disabled: () => !globalThis.nw,
		},
		{
			id: "liveReloadPort",
			type: "integer",
			labelKey: "field.liveReloadPort",
			min: 0,
			disabled: () => !globalThis.nw,
		},
		{ id: "autoSaveInterval", type: "number", labelKey: "field.autoSaveInterval", min: 0, step: 1, unit: "s" },
	];
}

async function runInputOffsetAdjust(app, input) {
	const origin = Number(input.value) || 0;
	const samples = [];
	const context = await app.audio.ensureContext();
	if (!context) {
		return;
	}
	const dialog = input.closest(".dialog");
	const controls = [...(dialog?.querySelectorAll("input, select, textarea, button") || [])];
	for (const control of controls) {
		control.disabled = true;
	}
	input.disabled = false;
	const button = input.parentElement?.querySelector("button");
	if (button) {
		button.disabled = false;
	}
	const beat = 0.5;
	let next = context.currentTime + 0.05;
	const ticks = [];
	const schedule = () => {
		if (stopped) {
			return;
		}
		void app.audio.playMetronome(Math.max(0, next - context.currentTime));
		ticks.push(next);
		next += beat;
		timer = setTimeout(schedule, beat * 1000);
	};
	let stopped = false;
	let timer = 0;
	const finish = restore => {
		if (stopped) {
			return;
		}
		stopped = true;
		clearTimeout(timer);
		document.removeEventListener("keydown", onKey, true);
		for (const control of controls) {
			control.disabled = false;
		}
		if (restore) {
			input.value = String(origin);
		}
	};
	const onKey = event => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopImmediatePropagation();
			finish(true);
			return;
		}
		if (event.key === " " || event.key === "Enter") {
			event.preventDefault();
			event.stopImmediatePropagation();
			finish(false);
			return;
		}
		if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) {
			return;
		}
		if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(event.key)) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		const now = context.currentTime;
		const closest = ticks.reduce((best, time) =>
			Math.abs(time - now) < Math.abs(best - now) ? time : best,
		ticks[ticks.length - 1] || now);
		samples.push(now - closest);
		const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
		input.value = average.toFixed(3);
	};
	document.addEventListener("keydown", onKey, true);
	button?.addEventListener("click", () => finish(false), { once: true });
	schedule();
}

class PreferencesMediaTrait {
	adjustInputOffset(input) {
		return runInputOffsetAdjust(this, input);
	}

	async showPreferences() {
		const values = await this.dialogs.form({
			titleKey: "dialog.preferences",
			values: this.preferences,
			fields: preferenceFields(this),
		});
		if (!values) {
			return null;
		}
		this.preferences = storePreferences({ ...this.preferences, ...values });
		this.liveHosting.address = this.preferences.liveHostingAddress;
		this.liveHosting.reloadPort = this.preferences.liveReloadPort;
		if (this.liveHosting.server) {
			this.liveHosting.stop();
		}
		applyThemePreference(this.preferences.theme);
		i18n.setLanguage(resolvePreferenceLanguage(this.preferences.language));
		this.audio.setSeVolume(this.preferences.seVolume);
		this.audio.setMusicVolume(this.preferences.musicVolume);
		this.startAutosave();
		this.refresh();
		return this.preferences;
	}

	startAutosave() {
		this.autosave.setInterval(this.preferences.autoSaveInterval * 1000);
		this.autosave.start(() => {
			if (this.modelSignature() === this.savedSignature) {
				return;
			}
			try {
				const timestamp = this.autosave.save(this.model, this.files.localSourceContext());
				this.history.markCurrent("autosave", timestamp);
				this.historyPanel.render(this.history);
				this.toast.show("toast.autosaved", {}, { duration: 1400 });
			} catch (error) {
				console.warn("Auto-save failed", error);
			}
		});
	}

	async requestLyricaImportOptions() {
		const defaults = ChartModel.createDefault().metadata;
		const tracking = trackDialogFieldEdits(["charter"], applyPresetDifficultyColor);
		const values = await this.dialogs.form({
			titleKey: "dialog.importLyrica",
			values: {
				charter: this.lastCharter() || "RNOVA",
				difficultyName: defaults.difficultyName || "Master",
				difficultyColor: defaults.difficultyColor || difficultyColor("Master"),
				difficulty: defaults.difficulty || "12",
				difficultySup: defaults.difficultySup || "",
				seed: 0,
				quantizationDenominator: 192,
			},
			fields: [
				{ id: "charter", type: "text", labelKey: "field.charter" },
				{ id: "difficultyName", type: "text", labelKey: "field.difficultyName" },
				{ id: "difficultyColor", type: "color", labelKey: "field.difficultyColor", required: true },
				{ id: "difficulty", type: "text", labelKey: "field.difficulty" },
				{ id: "difficultySup", type: "text", labelKey: "field.difficultySup" },
				{ id: "seed", type: "text", labelKey: "field.prngSeed" },
				{
					id: "quantizationDenominator",
					type: "integer",
					labelKey: "field.quantizationDenominator",
					positive: true,
					min: 1,
				},
			],
			onChange: tracking.onChange,
		});
		if (!values) {
			return null;
		}
		// v19: importing a chart does not set the next default charter.
		return {
			charter: values.charter,
			difficultyName: values.difficultyName,
			difficultyColor: difficultyColor(values.difficultyName, values.difficultyColor),
			difficulty: values.difficulty,
			difficultySup: values.difficultySup,
			seed: values.seed,
			quantizationDenominator: values.quantizationDenominator,
		};
	}

	async requestImportOptions(document) {
		if (document?.lyrica || document?.sviber) {
			return {};
		}
		const defaults = importTimingDefaults(document);
		const values = await this.dialogs.form({
			titleKey: "dialog.importTiming",
			values: { ...defaults, largestDenominator: 192, bpmChanges: [] },
			fields: [
				{ id: "offset", type: "number", labelKey: "field.offset", step: "any", unit: "s" },
				{
					id: "initialBpm",
					type: "number",
					labelKey: "field.initialBpm",
					positive: true,
					min: 0.001,
					step: "any",
				},
				{
					id: "largestDenominator",
					type: "integer",
					labelKey: "field.largestDenominator",
					positive: true,
					min: 1,
				},
				{
					id: "bpmChanges",
					type: "array",
					labelKey: "field.bpmChanges",
					stacked: true,
					newItem: { time: [0, 0, 1], bpm: 120 },
					fields: [
						{ id: "time", type: "rational", labelKey: "field.beat" },
						{
							id: "bpm",
							type: "number",
							labelKey: "field.bpm",
							positive: true,
							min: 0.001,
							step: "any",
						},
					],
				},
			],
		});
		if (!values) {
			return null;
		}
		return {
			offset: values.offset,
			initialBpm: values.initialBpm,
			bpmChanges: values.bpmChanges.map(change => ({
				time: Rational.from(change.time).toJSON(),
				bpm: Number(change.bpm),
			})),
			largestDenominator: values.largestDenominator,
		};
	}

	async clearRuntimeMedia() {
		await this.audio.unload();
		this.files.clearCurrentAssets();
		if (this.backgroundUrl) {
			URL.revokeObjectURL(this.backgroundUrl);
		}
		this.backgroundUrl = null;
		this.stage.setBackground(null);
	}

	async decodeBackground(file) {
		if (this.backgroundUrl) {
			URL.revokeObjectURL(this.backgroundUrl);
		}
		this.backgroundUrl = URL.createObjectURL(file);
		const image = new Image();
		await new Promise((resolve, reject) => {
			image.onload = resolve;
			image.onerror = () => reject(new Error("Unable to decode the selected image."));
			image.src = this.backgroundUrl;
		});
		this.stage.setBackground(image);
		return image;
	}

	async syncMediaFromModel() {
		this.syncProjectSharedFields();
		const musicReference = this.projectMusic;
		if (musicReference !== this.files.musicReference) {
			await this.audio.unload();
			this.files.musicFile = null;
			this.files.musicReference = "";
			if (musicReference) {
				try {
					const file = await this.files.fileForAsset(musicReference, "music");
					if (file) {
						await this.audio.load(file);
						this.files.rememberAsset(musicReference, file, "music");
					}
				} catch (error) {
					console.warn("Unable to restore music", error);
					this.toast.error("toast.musicRestoreFailed", { message: localizedErrorMessage(error) });
				}
			}
		}
		const imageReference = this.projectImage;
		if (imageReference !== this.files.imageReference) {
			if (this.backgroundUrl) {
				URL.revokeObjectURL(this.backgroundUrl);
			}
			this.backgroundUrl = null;
			this.stage.setBackground(null);
			this.files.imageFile = null;
			this.files.imageReference = "";
			if (imageReference) {
				try {
					const file = await this.files.fileForAsset(imageReference, "image");
					if (file) {
						await this.decodeBackground(file);
						this.files.rememberAsset(imageReference, file, "image");
					}
				} catch (error) {
					console.warn("Unable to restore background", error);
					this.toast.error("toast.backgroundRestoreFailed", { message: localizedErrorMessage(error) });
				}
			}
		}
		this.refresh();
	}

	queueMediaSync() {
		this.mediaSync = this.mediaSync.catch(() => {}).then(() => this.syncMediaFromModel());
		return this.mediaSync;
	}
}

export const withPreferencesMedia = composeTraits("PreferencesMediaLayer", PreferencesMediaTrait);
