// DOM wiring for the status bar controls and the hidden file inputs. Split out of
// app-core.js so the mapping from a checkbox id to the editor property (and to the views
// that need re-rendering when it flips) lives next to the listeners that use it.

import { i18n } from "./i18n.js";

const STATUS_TOGGLE_PROPERTIES = Object.freeze({
	"lock-visible-range": "lockVisibleRange",
	"play-se": "playSe",
	"play-bg-note-se": "playBgNoteSe",
	"seek-back-after-playing": "seekBackAfterPlaying",
	metronome: "metronome",
	"show-grouping-in-timeline": "showGroupingInTimeline",
	"show-grouping-in-main-field": "showGroupingInMainField",
	"show-tip-points": "showTipPoints",
	"show-bg-events-in-timeline": "showBgEventsInTimeline",
	"show-bg-events-in-main-field": "showBgEventsInMainField",
	"show-hud": "showHud",
	"show-chart-boundary": "showChartBoundary",
	"show-rulers": "showRulers",
	"allow-out-of-bound": "allowOutOfBound",
});

const STATUS_TOGGLE_VIEWS = Object.freeze({
	"show-grouping-in-timeline": { timeline: true },
	"show-grouping-in-main-field": { stage: true },
	"show-tip-points": { timeline: true, stage: true, scroll: true },
	"show-bg-events-in-timeline": { timeline: true, scroll: true },
	"show-bg-events-in-main-field": { stage: true },
	"show-hud": { stage: true },
	"show-chart-boundary": { stage: true },
	"show-rulers": { stage: true },
});

const STATUS_TOGGLE_IDS = Object.freeze(Object.keys(STATUS_TOGGLE_PROPERTIES));

export const withStatusBindings = Base =>
	class extends Base {
		_bindInputs() {
			this._bindFileInputs();
			document
				.getElementById("difficulty-select")
				?.addEventListener("change", event => void this.switchDifficulty(event.target.value));
			document.getElementById("difficulty-add")?.addEventListener("click", () => void this.newDifficulty());
			document.getElementById("difficulty-delete")?.addEventListener("click", () => void this.deleteDifficulty());
			for (const id of STATUS_TOGGLE_IDS) {
				document.getElementById(id)?.addEventListener("change", event => {
					if (id === "allow-out-of-bound") {
						// Out-of-bound tolerance is chart data rather than a view flag, so
						// flipping it goes through history — as a stage-only refresh.
						const checked = Boolean(event.target.checked);
						this.commit(
							i18n.t("history.allowOutOfBounds"),
							model => {
								model.editor.allowOutOfBound = checked;
							},
							{
								lightweight: true,
								viewOnly: true,
								dirty: false,
								rebuildIndex: false,
								stageOnly: true,
								skipInspector: true,
								skipCommands: true,
							},
						);
						return;
					}
					this.model.editor[STATUS_TOGGLE_PROPERTIES[id]] = Boolean(event.target.checked);
					this.refreshStatusViews(STATUS_TOGGLE_VIEWS[id] || {});
				});
			}
			document
				.getElementById("read-only")
				?.addEventListener("change", event => this.setReadOnly(event.target.checked));
			document
				.getElementById("fullscreen")
				?.addEventListener("change", event => void this.setFullscreen(event.target.checked));
			document
				.getElementById("live-hosting")
				?.addEventListener("change", event => void this.setLiveHosting(event.target.checked));
			document
				.getElementById("reset-main-field-view")
				?.addEventListener("click", () => this.resetMainFieldView?.());
		}

		// The four hidden <input type="file"> elements are reset after every pick so that
		// choosing the same file twice in a row still fires a change event.
		_bindFileInputs() {
			for (const id of ["open-file-input", "chart-file-input"]) {
				document.getElementById(id).addEventListener("change", event => {
					const options = { offerAddToProject: true };
					void this.openFile(event.target.files[0], options).finally(() => {
						event.target.value = "";
					});
				});
			}
			document.getElementById("music-file-input").addEventListener("change", event => {
				void this.loadMusic(event.target.files[0]).finally(() => {
					event.target.value = "";
				});
			});
			document.getElementById("background-file-input").addEventListener("change", event => {
				void this.loadBackground(event.target.files[0]).finally(() => {
					event.target.value = "";
				});
			});
		}
	};
