// Fullscreen state, which has to be read and driven through two different APIs: the DOM
// Fullscreen API in the browser and NW.js window methods in the desktop build. Split out of
// app-core.js so that platform branching stays in one small module.

export const withFullscreen = Base =>
	class extends Base {
		_isFullscreen() {
			if (document.fullscreenElement) {
				return true;
			}
			try {
				return Boolean(globalThis.nw && globalThis.nw.Window.get().isFullscreen);
			} catch {
				return false;
			}
		}

		_syncFullscreenState() {
			const next = this._isFullscreen();
			const changed = next !== this.fullscreen;
			this.fullscreen = next;
			const control = document.getElementById("fullscreen");
			if (control) {
				control.checked = this.fullscreen;
			}
			if (changed) {
				this.requestStatusUpdate();
			}
		}

		async setFullscreen(value) {
			const requested = Boolean(value);
			try {
				await this._requestFullscreen(requested);
			} catch (error) {
				this.toast.error("error.fullscreen", { message: String(error?.message || error) });
			}
			this._syncFullscreenState();
			const live = document.getElementById("live-hosting");
			if (live) {
				live.checked = Boolean(this.liveHosting.server);
			}
			return this.fullscreen;
		}

		async _requestFullscreen(requested) {
			if (globalThis.nw?.Window?.get) {
				const windowObject = globalThis.nw.Window.get();
				if (requested) {
					windowObject.enterFullscreen?.();
				} else {
					windowObject.leaveFullscreen?.();
				}
			} else if (requested) {
				await document.documentElement.requestFullscreen?.();
			} else if (document.fullscreenElement) {
				await document.exitFullscreen?.();
			}
		}
	};
