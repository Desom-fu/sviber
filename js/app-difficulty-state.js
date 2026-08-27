// The difficulty entries of a project: installing them from an opened document, tracking
// which one is active, and keeping the difficulty switcher <select> in sync. Split out of
// app-core.js.

import { i18n } from "./i18n.js";
import { ChartModel } from "./core/chart-model.js";
import { uniqueChartFilename } from "./core/project.js";
import { History } from "./core/history.js";

// Difficulty ids look like `difficulty-<n>`; adopting an imported project has to keep the
// generator ahead of every id it just installed.
function adoptDifficultyId(app, chart) {
	const id = String(chart.id || `difficulty-${app.nextDifficultyId++}`);
	const match = id.match(/^difficulty-(\d+)$/);
	if (match) {
		app.nextDifficultyId = Math.max(app.nextDifficultyId, Number(match[1]) + 1);
	}
	return id;
}

function difficultyOption(entry) {
	const option = document.createElement("option");
	const metadata = entry.model.metadata;
	const level = `${metadata.difficulty || ""}${metadata.difficultySup || ""}`.trim();
	option.value = entry.id;
	option.textContent = `${metadata.difficultyName}${level ? ` ${level}` : ""}`;
	option.style.color = String(metadata.difficultyColor || "#7f7f7f");
	return option;
}

// The switcher is only rebuilt when its contents actually change, so repainting the status
// bar every frame does not thrash the <select>.
function switcherSignature(app) {
	return JSON.stringify({
		language: i18n.language,
		active: app.activeDifficultyId,
		charts: app.difficulties.map(entry => ({
			id: entry.id,
			name: entry.model.metadata.difficultyName,
			difficulty: entry.model.metadata.difficulty,
			sup: entry.model.metadata.difficultySup,
		})),
	});
}

export const withDifficultyState = Base =>
	class extends Base {
		activeDifficultyState() {
			const active = this.difficulties.find(entry => entry.id === this.activeDifficultyId);
			return active || this.difficulties[0] || null;
		}

		syncActiveDifficultyState() {
			const entry = this.activeDifficultyState();
			if (!entry) {
				return;
			}
			entry.model = this.model;
			entry.history = this.history;
			entry.savedSignature = this.savedSignature;
		}

		installProject(charts, options = {}) {
			if (!charts?.length) {
				throw new Error("A project must contain at least one difficulty.");
			}
			this.groupSelectionScope = null;
			this.nextDifficultyId = 1;
			const knownFiles = charts.map(item => item.file).filter(Boolean);
			this.difficulties = charts.map(chart => this._installedDifficulty(chart, knownFiles, options));
			const known = this.difficulties.some(entry => entry.id === options.activeChart);
			this.activeDifficultyId = known ? options.activeChart : this.difficulties[0].id;
			const active = this.activeDifficultyState();
			this.model = active.model;
			this.history = active.history;
			this.savedSignature = active.savedSignature;
			this.projectName = String(options.name || this.model.metadata.title || "Untitled");
			this.projectTitle = String(options.title ?? this.model.metadata.title ?? "Untitled");
			this.projectArtist = String(options.artist ?? this.model.metadata.artist ?? "");
			this.projectMusic = String(this.model.music ?? "");
			this.projectImage = String(this.model.image ?? "");
			this.syncProjectSharedFields();
			this.syncProjectHistorySharedFields();
			if (options.saved !== false) {
				this.difficulties.forEach(entry => (entry.savedSignature = this.modelSignature(entry.model)));
			}
			this.projectDirty = options.saved === false;
			this.difficultyUiSignature = "";
			this.updateDirty();
		}

		_installedDifficulty(chart, knownFiles, options) {
			const model = chart.model instanceof ChartModel ? chart.model : ChartModel.import(chart.document);
			const id = adoptDifficultyId(this, chart);
			const history = new History(model.snapshot(), { initialLabel: i18n.t("history.initial"), limit: 1000 });
			return {
				id,
				file: String(chart.file || uniqueChartFilename(model.metadata.difficultyName, knownFiles)),
				model,
				history,
				savedSignature: options.saved === false ? null : this.modelSignature(model),
			};
		}

		_refreshDifficultyUi() {
			const select = document.getElementById("difficulty-select");
			if (!select) {
				return;
			}
			select.closest(".difficulty-switcher").hidden = !(globalThis.nw && this.editingProject);
			const signature = switcherSignature(this);
			if (signature !== this.difficultyUiSignature) {
				select.replaceChildren(...this.difficulties.map(entry => difficultyOption(entry)));
				select.value = this.activeDifficultyId;
				this.difficultyUiSignature = signature;
			}
			const active = this.activeDifficultyState();
			select.style.color = String(active?.model.metadata.difficultyColor || "#7f7f7f");
			const labelLength = select.selectedOptions[0]?.textContent?.length || 12;
			select.style.width = `${Math.min(30, Math.max(12, labelLength + 3))}ch`;
			select.title = i18n.t("difficulty.select");
			select.setAttribute("aria-label", i18n.t("difficulty.select"));
			select.disabled = this.audio.playing || Boolean(this.freeTransform);
		}
	};
