// Editor preferences, autosave interval, import-option dialogs and media loading.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
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

class PreferencesMediaTrait {
	async showPreferences() {
		const values = await this.dialogs.form({
			titleKey: "dialog.preferences",
			values: this.preferences,
			fields: [
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
						{ value: "en-US", labelKey: "option.language.english" },
						{ value: "zh-CN", labelKey: "option.language.chinese" },
					],
				},
				{
					id: "noteSpeed",
					type: "number",
					labelKey: "field.noteSpeed",
					positive: true,
					min: 0.01,
					step: "any",
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
				{ id: "autoSaveInterval", type: "number", labelKey: "field.autoSaveInterval", min: 0, step: 1 },
			],
		});
		if (!values) {
			return null;
		}
		this.preferences = storePreferences(values);
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
		const values = await this.dialogs.form({
			titleKey: "dialog.importTiming",
			values: { offset: 0, initialBpm: 120, largestDenominator: 192, bpmChanges: [] },
			fields: [
				{ id: "offset", type: "number", labelKey: "field.offset", step: "any" },
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
