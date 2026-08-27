// Pan and zoom of the main field (the stage viewport). Split out of app-view-controls.js:
// this mixin owns nothing but the `editor.mainFieldPan*`/`mainFieldZoom` viewport state.

export const withMainFieldView = Base =>
	class extends Base {
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
	};
