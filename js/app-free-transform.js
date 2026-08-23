import { clampAffineToChartBounds, resolveAttachedPosition, sampleSnappee } from "./core/geometry.js";
import { snapshotsEqual, captureHistoryView } from "./core/history.js";

export const withFreeTransform = Base => class extends Base {
	_refreshLightweight(options = {}) {
		if (options.selectionOnly && !options.selectionSynced) this.renderIndex?.syncSelection?.();
		if (options.activeChannels) this.renderIndex?.setActiveChannels?.(this.model.channels);
		this.refreshInteractionPreview?.({ rebuildIndex: options.rebuildIndex !== false, stageOnly: options.stageOnly });
		if (options.snappeeOnly || options.viewOnly) {
			this.snappeesPanel?.syncFlags?.(this.model, { readOnly: this.model.editor.readOnly });
		}
		if (options.channelOnly) {
			this.channelsPanel?.render?.(this.model, { readOnly: this.model.editor.readOnly });
		}
		if (options.channelLayout) {
			const height = 88 + Math.min(3, Math.max(1, this.model.channels.length)) * 48;
			document.querySelector(".workspace")?.style.setProperty("--timeline-height", `${height}px`);
		}
		if (!options.skipInspector) {
			this.inspectorPanel?.render(this.model, {
				transform: this.freeTransform?.matrix || null,
				selectedEvents: options.selectionOnly ? this.renderIndex?.selectedEvents : null,
			});
		}
		if (!options.skipHistory) this.historyPanel?.render(this.history, { readOnly: this.model.editor.readOnly });
		if (!options.skipCommands) this._syncCheckedCommands?.();
		document.title = `${this.dirty ? "* " : ""}${this.model.metadata.title} ${this.model.metadata.difficultyName} - sviber`;
	}
	previewFreeTransform(transform) {
		if (!this.freeTransform || !Array.isArray(transform) || transform.length !== 6) return false;
		const requested = transform.map(Number);
		if (requested.some(value => !Number.isFinite(value))) return false;
		const previousSnapshot = this.model.snapshot();
		const previousMatrix = this.freeTransform.matrix;
		this.model.restore(this.freeTransform.base);
		const matrix = this.model.editor?.allowOutOfBound
			? requested
			: clampAffineToChartBounds(this._freeTransformAnchorPoints(this.model), requested, previousMatrix);
		if (!this._applyTransformMutation(this.model, matrix)) {
			this.model.restore(previousSnapshot);
			return false;
		}
		this.freeTransform.matrix = matrix;
		this.refreshInteractionPreview({ rebuildIndex: false, positions: true,
			positionEvents: this.transformationTargets(this.model).affectedEvents });
		return true;
	}
	_finishCommit(label, mutation, options = {}, previewScheduleDirty = false) {
		const patchCommit = typeof options.historyPatch === "function";
		const viewOnly = !patchCommit && Boolean(options.selectionOnly || options.viewOnly);
		const selectionBefore = this.stageMoveAttachmentException
			? new Set(this.model.allEvents().filter(event => event.selected).map(event => event.id))
			: null;
		const before = viewOnly || patchCommit ? null : this.model.snapshot();
		const result = mutation(this.model);
		this._normalizeGroupSelectionScope?.();
		if (selectionBefore) this._reconcileStageMoveAttachmentException?.(selectionBefore);
		let recorded = true;
		if (viewOnly) {
			recorded = this.history.recordView(captureHistoryView(this.model,
				{ selectedEventIds: options.selectedEventIds }), label, options.metadata ?? null);
		} else if (patchCommit) {
			recorded = this.history.recordPatch(options.historyPatch(result, this.model), label, options.metadata ?? null);
		} else {
			const after = this.model.snapshot();
			if (snapshotsEqual(after, before)) {
				if (previewScheduleDirty) this._invalidatePlaybackSchedule();
				if (options.lightweight) this._refreshLightweight(options); else this.refresh();
				return result;
			}
			recorded = this.history.record(after, label, options.metadata ?? null, { force: true, owned: true });
		}
		if (!recorded) {
			if (previewScheduleDirty) this._invalidatePlaybackSchedule();
			if (!viewOnly) {
				if (options.lightweight) this._refreshLightweight(options); else this.refresh();
			}
			return result;
		}
		if (options.dirty !== false) {
			if (viewOnly) this.dirty = true;
			else { this.syncActiveDifficultyState?.(); this.dirty = true; }
		}
		if (previewScheduleDirty || options.scheduleDirty === true
			|| options.scheduleDirty !== false && !viewOnly) this._invalidatePlaybackSchedule();
		if (!viewOnly) this.broadcastLiveChartUpdate?.();
		if (options.lightweight) this._refreshLightweight(options); else this.refresh();
		return result;
	}
	refreshInteractionPreview(options = {}) {
		if (typeof this._rebuildRenderIndex !== "function" || !this.timeline) return this.refresh?.();
		const rebuildIndex = options.rebuildIndex !== false;
		if (!rebuildIndex && options.positions) this.renderIndex?.refreshPositions?.(options.positionEvents);
		if (rebuildIndex) {
			this._rebuildRenderIndex();
			const view = this.viewState();
			this.timeline.setState(view, { render: false });
			this.stage.setState(view, { render: false });
			this.scrollView?.setState(view, { render: false });
		}
		if (options.stageOnly) this.stage.requestRender();
		else {
			this.timeline.requestRender();
			this.stage.requestRender();
			this.scrollView?.requestRender();
		}
		this.requestStatusUpdate();
		this._flushInvalidatedPlaybackSchedule?.();
	}
	startFreeTransform() {
		if (this.freeTransform) { this.finishFreeTransform(); return true; }
		this.exitModes();
		const bounds = this.transformSelectionBounds();
		if (!bounds) return false;
		const rawPoints = this._freeTransformAnchorPoints();
		const xs = rawPoints.map(point => point.x);
		const ys = rawPoints.map(point => point.y);
		const hasSelectedGroup = this.model.allEvents().some(event => event.selected && event.type === "group");
		if (!rawPoints.length || !hasSelectedGroup && (Math.max(...xs) - Math.min(...xs) <= 1e-9
			|| Math.max(...ys) - Math.min(...ys) <= 1e-9)) return false;
		const anchorLocal = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
		this.freeTransform = {
			base: this.model.snapshot(), bounds, anchor: { ...anchorLocal }, anchorLocal,
			anchorFollows: true, anchorPoints: rawPoints, matrix: [1, 0, 0, 1, 0, 0],
		};
		this.refresh();
		return true;
	}
	_freeTransformAnchorPoints(model = this.model) {
		const { attachedIds, directEvents } = this.transformationTargets(model);
		const points = directEvents.map(event => resolveAttachedPosition(event, model.snappees)).filter(Boolean);
		for (const snappee of model.snappees) {
			if (!attachedIds.has(snappee.id)) continue;
			try { points.push(...sampleSnappee(snappee)); } catch { /* Ignore an invalid draft snappee. */ }
		}
		return points.map(point => ({ x: Number(point.x), y: Number(point.y) }))
			.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
	}
	previewFreeTransformAnchor(anchor) {
		if (!this.freeTransform || !anchor?.point) return false;
		const point = { x: Number(anchor.point.x), y: Number(anchor.point.y) };
		if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
		this.freeTransform.anchor = point;
		this.freeTransform.anchorFollows = Boolean(anchor.follows);
		if (this.freeTransform.anchorFollows && anchor.local) {
			this.freeTransform.anchorLocal = { x: Number(anchor.local.x), y: Number(anchor.local.y) };
		}
		this.refreshInteractionPreview({ rebuildIndex: false });
		return true;
	}
};
