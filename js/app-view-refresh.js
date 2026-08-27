// Targeted refresh fan-out for the editor views. Split out of app-view-controls.js so the
// "push the current view state at the timeline/stage/scroll view and the docked panels"
// concern lives on its own instead of inside one oversized view-controls mixin.

export const withViewRefresh = Base =>
	class extends Base {
		refreshStatusViews(options = {}) {
			const view = this.viewState();
			for (const [name, enabled] of [
				["timeline", options.timeline],
				["stage", options.stage],
				["scrollView", options.scroll],
			]) {
				if (!enabled || !this[name]) {
					continue;
				}
				this[name].setState(view, { render: false });
				this[name].requestRender();
			}
			this.requestStatusUpdate();
		}

		refreshReadOnlyUi(readOnly) {
			this.inspectorPanel.render(this.model, { transform: this.freeTransform?.matrix || null });
			this.snappeesPanel.render(this.model, { readOnly });
			this.channelsPanel.render(this.model, { readOnly });
			this.clipsPanel.render(this.model, { readOnly });
			this.historyPanel.render(this.history, { readOnly });
			this._refreshDifficultyUi();
			this.registry.notifyAll();
		}
	};
