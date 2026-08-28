// Snappee list mutations and live curve drafting (Bézier, arc, pen).

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { Rational } from "../core/rational.js";
import { findNearestSnapPoint, sampleSnappee } from "../core/geometry.js";
import { captureHistoryView } from "../core/history.js";
import { SNAPPEE_COLORS, deepClone, eventTypeLabel, pointAllowed } from "./app-helpers.js";

class CurveDraftTrait {
	selectSnappee(id) {
		if (this.model.editor.readOnly) {
			return false;
		}
		let changed = false;
		for (const snappee of this.model.snappees) {
			const selected = snappee.id === id && snappee.active !== false;
			if (snappee.selected !== selected) {
				snappee.selected = selected;
				changed = true;
			}
		}
		if (!changed) {
			return true;
		}
		this.snappeesPanel?.syncFlags?.(this.model, { readOnly: this.model.editor.readOnly });
		this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
		this._syncCheckedCommands?.();
		return true;
	}

	toggleSnappee(id) {
		this.commit(
			i18n.t("history.editSnappee"),
			model => {
				const snappee = model.snappees.find(item => item.id === id);
				if (snappee) {
					snappee.active = !snappee.active;
					if (!snappee.active) {
						snappee.selected = false;
					}
				}
			},
			{
				allowReadOnly: true,
				lightweight: true,
				viewOnly: true,
				snappeeOnly: true,
				rebuildIndex: false,
				skipInspector: true,
				scheduleDirty: false,
				skipCommands: true,
			},
		);
	}

	duplicateSnappee(id) {
		this.commit(i18n.t("history.createSnappee"), model => {
			const source = model.snappees.find(item => item.id === id);
			if (!source) {
				return;
			}
			model.addSnappee({
				...deepClone(source),
				id: null,
				selected: false,
				name: this.uniqueSnappeeName(source.name),
			});
		});
	}

	moveSnappeeInList(id, direction) {
		this.commit(
			i18n.t("history.editSnappee"),
			model => {
				const index = model.snappees.findIndex(snappee => snappee.id === id);
				const target = index + Math.sign(Number(direction));
				if (index < 0 || !Number.isInteger(target) || target < 0 || target >= model.snappees.length) {
					return;
				}
				[model.snappees[index], model.snappees[target]] = [model.snappees[target], model.snappees[index]];
			},
			{
				lightweight: true,
				viewOnly: true,
				snappeeOnly: true,
				rebuildIndex: false,
				skipInspector: true,
				scheduleDirty: false,
				skipCommands: true,
			},
		);
	}

	async deleteSnappee(id) {
		if (
			!(await this.dialogs.confirm({
				titleKey: "dialog.deleteSnappee",
				messageKey: "dialog.deleteSnappeeMessage",
			}))
		) {
			return;
		}
		this.commit(i18n.t("history.editSnappee"), model => model.removeSnappee(id));
	}

	async editSnappee(id) {
		if (this.audio.playing) {
			return;
		}
		const snappee = this.model.snappees.find(item => item.id === id);
		if (snappee) {
			await this.showSnappeeDialog(snappee.type, id);
		}
	}

	startCurveDraft(type) {
		this.exitModes();
		this.curveDraft = {
			type,
			points: [],
			...(type === "penCurve" ? { penNodes: [] } : {}),
			name: this.defaultSnappeeName(type),
			color: SNAPPEE_COLORS[this.model.snappees.length % SNAPPEE_COLORS.length],
		};
		this.history.recordView(
			captureHistoryView(this.model),
			i18n.t("history.editSnappee"),
			{ curveDraft: deepClone(this.curveDraft) },
			{ force: true },
		);
		this._refreshLightweight?.({ rebuildIndex: false, stageOnly: true, skipInspector: true });
	}

	startPenNode(point) {
		if (this.curveDraft?.type !== "penCurve") {
			return null;
		}
		const first = this.curveDraft.penNodes[0];
		if (first && this.curveDraft.penNodes.length >= 2 && Math.hypot(first.x - point.x, first.y - point.y) < 3) {
			this.curveDraft.closed = true;
			this.recordCurveDraftAction();
			this.finishCurveDraft();
			return null;
		}
		const node = { x: Number(point.x), y: Number(point.y), incoming: null, outgoing: null };
		this.curveDraft.penNodes.push(node);
		this.curveDraft.points.push({ x: node.x, y: node.y });
		this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
		return this.curveDraft.penNodes.length - 1;
	}

	setPenNodeDrag(index, point, record = false) {
		const draft = this.curveDraft;
		const node = draft?.type === "penCurve" ? draft.penNodes?.[index] : null;
		if (!node) {
			return;
		}
		const outgoing = { x: Number(point.x), y: Number(point.y) };
		if (Math.hypot(outgoing.x - node.x, outgoing.y - node.y) < 0.25) {
			node.incoming = null;
			node.outgoing = null;
		} else {
			node.outgoing = outgoing;
			node.incoming = { x: node.x * 2 - outgoing.x, y: node.y * 2 - outgoing.y };
		}
		if (record) {
			this.recordCurveDraftAction();
			this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
		} else {
			this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
		}
	}

	setPenNodeHandle(index, kind, point, record = false) {
		const draft = this.curveDraft;
		const node = draft?.type === "penCurve" ? draft.penNodes?.[index] : null;
		if (!node || !["incoming", "outgoing"].includes(kind)) {
			return;
		}
		node[kind] = { x: Number(point.x), y: Number(point.y) };
		if (record) {
			this.recordCurveDraftAction();
			this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
		} else {
			this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
		}
	}

	recordPenNode() {
		if (this.curveDraft?.type !== "penCurve") {
			return;
		}
		this.recordCurveDraftAction();
		this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
	}

	addCurvePoint(point, finish = false) {
		if (!this.curveDraft) {
			return;
		}
		const snap = findNearestSnapPoint(point, this.model.snappees, { activeOnly: true, maxDistance: 5 });
		const finalPoint = snap ? { x: snap.x, y: snap.y } : { x: point.x, y: point.y };
		const first = this.curveDraft.points[0];
		const last = this.curveDraft.points.at(-1);
		const closesArc =
			this.curveDraft.type === "circularArcCurve" &&
			this.curveDraft.points.length >= 2 &&
			Math.hypot(this.curveDraft.points[1].x - finalPoint.x, this.curveDraft.points[1].y - finalPoint.y) < 3;
		if (
			closesArc ||
			(this.curveDraft.type !== "circularArcCurve" &&
				first &&
				Math.hypot(first.x - finalPoint.x, first.y - finalPoint.y) < 3 &&
				this.curveDraft.points.length >= 2)
		) {
			if (this.curveDraft.type === "bezierCurve") {
				this.curveDraft.points.push({ x: first.x, y: first.y });
			}
			this.curveDraft.closed = true;
			finish = true;
		} else if (!(finish && last && Math.hypot(last.x - finalPoint.x, last.y - finalPoint.y) < 3)) {
			this.curveDraft.points.push(finalPoint);
		}
		if (this.curveDraft.type === "circularArcCurve" && this.curveDraft.points.length >= 3) {
			finish = true;
		}
		this.recordCurveDraftAction();
		if (finish) {
			return this.finishCurveDraft();
		}
		this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
	}

	activateCurveDraftPoint(index) {
		const draft = this.curveDraft;
		if (!draft || draft.points.length < 2) {
			return false;
		}
		const closes = draft.type === "circularArcCurve" ? index === 1 : index === 0;
		if (!closes) {
			return false;
		}
		if (
			draft.type === "bezierCurve" &&
			(draft.points[0].x !== draft.points.at(-1).x || draft.points[0].y !== draft.points.at(-1).y)
		) {
			draft.points.push({ x: draft.points[0].x, y: draft.points[0].y });
		}
		draft.closed = true;
		this.recordCurveDraftAction();
		this.finishCurveDraft();
		return true;
	}

	recordCurveDraftAction() {
		if (!this.curveDraft) {
			return;
		}
		this.history.recordView(
			captureHistoryView(this.model),
			i18n.t("history.editSnappee"),
			{ curveDraft: deepClone(this.curveDraft) },
			{ force: true },
		);
	}

	finishCurveDraftFromDoubleClick() {
		if (!this.curveDraft) {
			return;
		}
		const points = this.curveDraft.points;
		// The second click of a double-click often inserts a duplicate node; drop it before commit.
		if (
			points.length > 2 &&
			Math.hypot(points.at(-1).x - points.at(-2).x, points.at(-1).y - points.at(-2).y) < 3
		) {
			points.pop();
			if (this.curveDraft.type === "penCurve") {
				this.curveDraft.penNodes?.pop();
			}
			this.recordCurveDraftAction();
		}
		let count = points.length;
		if (this.curveDraft.type === "penCurve") {
			count = this.curveDraft.penNodes?.length || points.length;
		}
		if (count < 2) {
			return;
		}
		this.finishCurveDraft();
	}

	moveCurveDraftPoint(index, point, record = false) {
		if (!this.curveDraft?.points[index]) {
			return;
		}
		if (this.curveDraft.type === "penCurve" && this.curveDraft.penNodes?.[index]) {
			const node = this.curveDraft.penNodes[index];
			const dx = Number(point.x) - node.x;
			const dy = Number(point.y) - node.y;
			node.x += dx;
			node.y += dy;
			if (node.incoming) {
				node.incoming.x += dx;
				node.incoming.y += dy;
			}
			if (node.outgoing) {
				node.outgoing.x += dx;
				node.outgoing.y += dy;
			}
		}
		this.curveDraft.points[index] = { x: Number(point.x), y: Number(point.y) };
		if (record) {
			this.recordCurveDraftAction();
		}
		this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
	}

	finishCurveDraft() {
		const draft = this.curveDraft;
		const pointCount =
			draft?.type === "penCurve" ? draft.penNodes?.length || draft.points.length : draft?.points.length;
		// Keep drafting when there are not enough points yet (Enter/dblclick should not wipe a 1-point pen).
		if (!draft || pointCount < 2) {
			if (!draft) {
				return;
			}
			this.refreshInteractionPreview?.({ rebuildIndex: false, stageOnly: true });
			return;
		}
		let data;
		if (draft.type === "bezierCurve") {
			let points = draft.points;
			const first = draft.points[0];
			const last = draft.points.at(-1);
			const needsClose =
				draft.closed && draft.points.length >= 2 && (first.x !== last.x || first.y !== last.y);
			if (needsClose) {
				points = [...draft.points, { x: first.x, y: first.y }];
			}
			data = {
				name: draft.name,
				color: draft.color,
				degree: points.length - 1,
				controlPoints: points,
				segments: Math.max(8, points.length * 6),
				closed: Boolean(draft.closed),
			};
		} else if (draft.type === "circularArcCurve") {
			const [center, beginning, ending = beginning] = draft.points;
			data = {
				name: draft.name,
				color: draft.color,
				centerX: center.x,
				centerY: center.y,
				radius: Math.hypot(beginning.x - center.x, beginning.y - center.y),
				beginningAngle: Math.atan2(beginning.y - center.y, beginning.x - center.x),
				endAngle: Math.atan2(ending.y - center.y, ending.x - center.x),
				clockwise: false,
				closed: Boolean(draft.closed),
				segments: 24,
			};
		} else {
			data = {
				name: draft.name,
				color: draft.color,
				commands: penCommandsFromNodes(draft.penNodes || draft.points, Boolean(draft.closed)),
				segments: Math.max(8, draft.points.length * 4),
				closed: Boolean(draft.closed),
			};
		}
		this.curveDraft = null;
		let createdId = null;
		this.commit(i18n.t("history.createSnappee"), model => {
			const created = model.addSnappee(draft.type, data);
			createdId = created.id;
			for (const snappee of model.snappees) {
				snappee.selected = snappee.id === createdId;
			}
		});
		if (
			createdId != null &&
			["bezierCurve", "penCurve", "circularArcCurve"].includes(draft.type)
		) {
			return this.showSnappeeDialog(draft.type, createdId, { focusField: "segments" });
		}
	}

	fillSelectedCurve() {
		const snappee = this.model.snappees.find(item => item.selected && !item.type.endsWith("Mesh"));
		if (!snappee) {
			return;
		}
		this.commit(i18n.t("history.createEvent", { type: eventTypeLabel("drag") }), model => {
			const points = sampleSnappee(snappee).filter(point => pointAllowed(model, point));
			if (!points.length) {
				return;
			}
			for (const event of model.events) {
				event.selected = false;
			}
			points.forEach((point, index) =>
				model.addEvent("drag", {
					time: this.currentBeat().add(new Rational(index, model.editor.subdivision)).toJSON(),
					channel: model.editor.currentChannel,
					attached: true,
					snappee: snappee.id,
					snapPoint: deepClone(point.snapPoint),
					selected: true,
				}),
			);
		});
	}
}

export const withCurveDraft = composeTraits("CurveDraftLayer", CurveDraftTrait);
