// Document-level input that is not owned by any single view: the mode-exiting keys, the
// hold-to-play space bar, wheel navigation and zoom, the fullscreen change notifications
// and the unsaved-changes guard. Split out of app-core.js.
//
// The installers are module-level functions taking the app instance so `_bindGlobalInteraction`
// stays a thin, readable list of the things it wires up.

import { i18n } from "./i18n.js";
import { isEditableTarget } from "./commands.js";
import { isScrollableDomTarget } from "./app-helpers.js";

// Elements that scroll or edit on their own keep their native wheel behaviour.
const WHEEL_OPT_OUT = ".property-panel,.history-list,.status-panel,.menu-popup,.dialog-body,.tool-bar,select,textarea";

function bindLicenseLink(app) {
	const licenseLink = document.querySelector(".javascript-license-link");
	licenseLink?.addEventListener("click", event => {
		event.preventDefault();
		app.help.openLicenseInformation();
	});
}

// Escape leaves every transient mode and clears the snappee selection.
function escapeModes(app, event) {
	if (globalThis.nw && app._isFullscreen()) {
		event.preventDefault();
	}
	if (app.dialogs.active) {
		return;
	}
	if (app.freeTransform) {
		event.preventDefault();
	}
	app.exitModes();
	for (const snappee of app.model.snappees) {
		snappee.selected = false;
	}
	app._refreshLightweight?.({
		rebuildIndex: false,
		snappeeOnly: true,
		skipInspector: true,
		skipHistory: true,
	});
}

// Enter commits the pending free transform or curve draft, unless a text field has focus.
function commitPendingDraft(app, event) {
	if (isEditableTarget(event.target)) {
		return;
	}
	event.preventDefault();
	if (app.freeTransform) {
		app.finishFreeTransform();
	} else {
		app.finishCurveDraft();
	}
}

function bindModeKeys(app) {
	document.addEventListener("keydown", event => {
		if (event.key === "F11") {
			event.preventDefault();
			void app.setFullscreen(!app._isFullscreen());
		} else if (event.key === "Escape") {
			escapeModes(app, event);
		} else if (event.key === "Enter" && (app.freeTransform || app.curveDraft) && !app.dialogs.active) {
			commitPendingDraft(app, event);
		}
	});
}

function bindFullscreenSync(app) {
	document.addEventListener("fullscreenchange", app.boundFullscreenChange);
	try {
		const windowObject = globalThis.nw?.Window?.get?.();
		windowObject?.on?.("enter-fullscreen", app.boundFullscreenChange);
		windowObject?.on?.("leave-fullscreen", app.boundFullscreenChange);
	} catch {
		/* NW.js is optional in the browser. */
	}
	app._syncFullscreenState();
}

// Holding space plays and releasing it stops again; a short tap is left to the ordinary
// play/pause shortcut so that tapping space toggles playback.
function bindSpaceHold(app) {
	app.boundSpaceKeyUp = event => {
		if (event.key !== " " && event.code !== "Space") {
			return;
		}
		if (app.spacePlaybackStartedAt == null) {
			return;
		}
		const held = performance.now() - app.spacePlaybackStartedAt;
		const command = app.spacePlaybackCommand;
		app.spacePlaybackStartedAt = null;
		app.spacePlaybackCommand = null;
		if (held < 300 || !app.audio.playing || app.dialogs.active) {
			return;
		}
		event.preventDefault();
		void app.registry.execute(command || "music.playPause", app, event);
	};
	document.addEventListener("keyup", app.boundSpaceKeyUp, true);
}

function bindWheelNavigation(app) {
	document.addEventListener(
		"wheel",
		event => {
			if (event.defaultPrevented) {
				return;
			}
			if (event.ctrlKey && event.shiftKey) {
				event.preventDefault();
				app.setMainFieldZoom?.(event.deltaY < 0 ? 1.12 : 1 / 1.12);
				return;
			}
			if (event.shiftKey && !event.ctrlKey && !isScrollableDomTarget(event.target)) {
				event.preventDefault();
				app.timeline?.scrollChannelsBy?.(Math.sign(event.deltaY));
				return;
			}
			if (app.dialogs.active || event.target.closest(WHEEL_OPT_OUT)) {
				return;
			}
			event.preventDefault();
			app.navigateWheel(event.deltaY, event.ctrlKey, event.ctrlKey);
		},
		{ passive: false },
	);
}

function bindUnloadGuard(app) {
	window.addEventListener("beforeunload", event => {
		if (!app.dirty) {
			return;
		}
		event.preventDefault();
		event.returnValue = "";
	});
}

export const withGlobalShortcuts = Base =>
	class extends Base {
		_bindGlobalInteraction() {
			bindLicenseLink(this);
			bindModeKeys(this);
			bindFullscreenSync(this);
			bindSpaceHold(this);
			bindWheelNavigation(this);
			bindUnloadGuard(this);
			i18n.subscribe(() => this.refresh());
		}
	};
