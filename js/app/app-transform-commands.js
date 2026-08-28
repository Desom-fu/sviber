// The commands that drive a transform: nudging, entering a matrix by hand, and closing an
// interactive free transform. While a free transform is active a further transform composes
// onto its matrix instead of committing on its own. Split out of app-event-editing.js.

import { i18n } from "../ui/i18n.js";
import { multiplyTransforms } from "../core/geometry.js";
import { snapshotsEqual } from "../core/history.js";

export const withTransformCommands = Base =>
	class extends Base {
		translateSelected(deltaX, deltaY) {
			return this.applyTransformToSelection([1, 0, 0, 1, Number(deltaX), Number(deltaY)]);
		}

		applyTransformToSelection(transform) {
			if (!Array.isArray(transform) || transform.length !== 6) {
				return false;
			}
			const matrix = transform.map(Number);
			if (matrix.some(value => !Number.isFinite(value))) {
				return false;
			}
			if (this.freeTransform) {
				return this.previewFreeTransform(multiplyTransforms(matrix, this.freeTransform.matrix));
			}
			let applied = false;
			this.commit(i18n.t("history.transform"), model => {
				applied = this._applyTransformMutation(model, matrix);
			});
			return applied;
		}

		async showTransformDialog() {
			this.exitModes();
			const values = await this.dialogs.form({
				titleKey: "dialog.transformMatrix",
				values: { matrix: [1, 0, 0, 1, 0, 0] },
				fields: [{ id: "matrix", type: "matrix", labelKey: "field.transform", numeric: true, required: true }],
			});
			if (!values) {
				return;
			}
			this.applyTransformToSelection(values.matrix);
		}

		// A free transform previews straight onto the model, so finishing it only has to
		// record the result — and only when it actually differs from where it started.
		finishFreeTransform() {
			if (!this.freeTransform) {
				return false;
			}
			const after = this.model.snapshot();
			const changed = !snapshotsEqual(this.freeTransform.base, after);
			this.freeTransform = null;
			if (changed) {
				this.history.record(after, i18n.t("history.transform"), null, { force: true, owned: true });
				this.syncActiveDifficultyState?.();
				this.dirty = true;
			}
			this.refresh();
			return changed;
		}

		cancelFreeTransform() {
			if (!this.freeTransform) {
				return false;
			}
			this.model.restore(this.freeTransform.base);
			this.freeTransform = null;
			this.refresh();
			return true;
		}
	};
