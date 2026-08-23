import { i18n } from "./i18n.js";
import { Rational } from "./core/rational.js";

export const withViewControls = Base => class extends Base {
	refreshStatusViews(options = {}) {
		const view = this.viewState();
		for (const [name, enabled] of [["timeline", options.timeline], ["stage", options.stage], ["scrollView", options.scroll]]) {
			if (!enabled || !this[name]) continue;
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
	setMainFieldPan(x, y) {
		this.model.editor.mainFieldPanX = Number(x) || 0;
		this.model.editor.mainFieldPanY = Number(y) || 0;
		this.stage.requestRender();
		this._updateStatus?.();
	}
	setMainFieldZoom(factor) {
		const current = Math.max(0.1, Math.min(16, Number(this.model.editor.mainFieldZoom) || 1));
		this.model.editor.mainFieldZoom = Math.max(0.1, Math.min(16, current * (Number(factor) || 1)));
		this.stage.requestRender();
		this._updateStatus?.();
	}
	resetMainFieldView() {
		this.model.editor.mainFieldPanX = 0;
		this.model.editor.mainFieldPanY = 0;
		this.model.editor.mainFieldZoom = 1;
		this.stage.requestRender();
		this._updateStatus?.();
	}
	seekProgress(payload = {}) {
		const target = Number(payload.seconds);
		if (!Number.isFinite(target)) return;
		const editor = this.model.editor;
		if (payload.followRange && Number.isFinite(payload.beginning) && Number.isFinite(payload.end)) {
			const span = payload.end - payload.beginning;
			const ratio = (Number(payload.startSeconds) - payload.beginning) / Math.max(0.001, span);
			this.setVisibleRange(target - ratio * span, target + (1 - ratio) * span, true);
		}
		if (this.audio.playing) { editor.timeSnapped = false; editor.currentTime = target; this.audio.seek(target); }
		else { editor.timeSnapped = true; editor.currentTime = this.timing().secondsToSnappedBeat(target, editor.subdivision).toJSON(); this.audio.seek(this.currentSeconds()); }
		this.refresh();
	}
	panScrollView(seconds, final, drag = {}) {
		const target = Number(seconds);
		if (!Number.isFinite(target)) return;
		const editor = this.model.editor;
		if (drag.followRange && Number.isFinite(drag.beginning) && Number.isFinite(drag.end)) {
			const span = drag.end - drag.beginning;
			const ratio = (Number(drag.startSeconds) - drag.beginning) / Math.max(0.001, span);
			this.setVisibleRange(target - ratio * span, target + (1 - ratio) * span, true);
		}
		if (final && !this.audio.playing) { editor.timeSnapped = true; editor.currentTime = this.timing().secondsToSnappedBeat(target, editor.subdivision).toJSON(); this.audio.seek(this.currentSeconds()); }
		else { editor.timeSnapped = false; editor.currentTime = target; this.audio.seek(target); }
		this.refresh();
	}
	toggleBarLine() {
		const beat = this.currentBeat();
		this.commit(i18n.t("history.barLine"), model => { if (!model.timing.removeBarLine(beat)) model.timing.addBarLine(beat); });
	}
	async showTimeDilationDialog() {
		this.exitModes();
		const values = await this.dialogs.form({ titleKey: "dialog.timeDilation", values: { factor: [1, 0, 1], preserveDuration: false }, fields: [
			{ id: "factor", type: "rational", labelKey: "field.factor", required: true },
			{ id: "preserveDuration", type: "checkbox", labelKey: "field.preserveDuration" },
		] });
		if (!values) return;
		const factor = Rational.from(values.factor);
		this.commit(i18n.t("history.timeDilation"), model => {
			const roots = model.allEvents().filter(event => event.selected);
			const events = [...new Set(roots.flatMap(event => event.type === "group" ? model.groupDescendants(event.id).filter(item => item.type !== "group") : [event]))];
			if (!events.length) return;
			const origin = events.reduce((min, event) => { const time = Rational.from(event.time); return !min || time.compare(min) < 0 ? time : min; }, null);
			for (const event of events) {
				const time = Rational.from(event.time);
				const next = factor.mul(time.sub(origin)).add(origin);
				if (event.duration && !values.preserveDuration) { const end = factor.mul(time.add(event.duration).sub(origin)).add(origin); event.duration = end.sub(next).toJSON(); }
				event.time = next.toJSON();
			}
		});
	}
};
