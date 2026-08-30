"use strict";

const CACHE_VERSION = "sviber-v01320";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL = [
	"./",
	"./index.html",
	"./macros.html",
	"./javascript.html",
	"./source-viewer.html",
	"./package.json",
	"./css/app-v11.css",
	"./css/app.css",
	"./css/dialogs.css",
	"./css/fonts-local.css",
	"./css/fonts-web.css",
	"./css/license.css",
	"./css/macros.css",
	"./css/overlays.css",
	"./css/themes.css",
	"./js/app/app-attachment.js",
	"./js/app/app-auto-timing.js",
	"./js/app/app-channel-commands.js",
	"./js/app/app-chart-dialogs.js",
	"./js/app/app-chart-tools.js",
	"./js/app/app-checks.js",
	"./js/app/app-clipboard.js",
	"./js/app/app-command-bindings.js",
	"./js/app/app-core.js",
	"./js/app/app-curve-draft.js",
	"./js/app/app-difficulty-state.js",
	"./js/app/app-dirty-tracking.js",
	"./js/app/app-document-lifecycle.js",
	"./js/app/app-event-editing.js",
	"./js/app/app-event-move.js",
	"./js/app/app-event-tools.js",
	"./js/app/app-file-workflows.js",
	"./js/app/app-free-transform.js",
	"./js/app/app-fullscreen.js",
	"./js/app/app-global-shortcuts.js",
	"./js/app/app-group-anchor-move.js",
	"./js/app/app-helpers.js",
	"./js/app/app-history-commands.js",
	"./js/app/app-macro-bridge.js",
	"./js/app/app-main-field-view.js",
	"./js/app/app-open-save.js",
	"./js/app/app-playback-scheduling.js",
	"./js/app/app-playback-transport.js",
	"./js/app/app-position-move.js",
	"./js/app/app-preferences-media.js",
	"./js/app/app-project-files.js",
	"./js/app/app-project-state.js",
	"./js/app/app-property-editing.js",
	"./js/app/app-selection-preview.js",
	"./js/app/app-selection-transform.js",
	"./js/app/app-selection.js",
	"./js/app/app-shell-bindings.js",
	"./js/app/app-snappee-attach.js",
	"./js/app/app-snappee-drag.js",
	"./js/app/app-snappee-forms.js",
	"./js/app/app-stage-move-exception.js",
	"./js/app/app-status-bindings.js",
	"./js/app/app-status-view.js",
	"./js/app/app-time-dilation.js",
	"./js/app/app-time-seeking.js",
	"./js/app/app-timeline-marks.js",
	"./js/app/app-timeline-navigation.js",
	"./js/app/app-tip-point-modes.js",
	"./js/app/app-tip-spawn-move.js",
	"./js/app/app-transform-commands.js",
	"./js/app/app-transform-targets.js",
	"./js/app/app-view-callbacks.js",
	"./js/app/app-view-controls.js",
	"./js/app/app-view-refresh.js",
	"./js/app/app.js?v=65",
	"./js/audio/decoder.js",
	"./js/audio/player.js",
	"./js/audio/scheduler.js",
	"./js/audio/waveform.js",
	"./js/ui/auto-timing-form.js",
	"./js/platform/autosave.js",
	"./js/ui/checks-panel.js",
	"./js/cli/cli-node-io.js",
	"./js/cli/cli-operations.js",
	"./js/cli/cli.js",
	"./js/cli/clipboard-payload.js",
	"./js/app/commands.js",
	"./js/core/chart-events.js",
	"./js/core/chart-model.js",
	"./js/core/chart-normalize.js",
	"./js/core/chart-snappees.js",
	"./js/core/chart-vocabulary.js",
	"./js/core/checks-config.js",
	"./js/core/checks.js",
	"./js/core/geometry.js",
	"./js/core/grouping.js",
	"./js/core/history.js",
	"./js/core/lyrica-export.js",
	"./js/core/lyrica-format.js",
	"./js/core/lyrica-import.js",
	"./js/core/lyrica-spawn.js",
	"./js/core/lyrica.js",
	"./js/core/ndarray.js",
	"./js/core/project.js",
	"./js/core/rational.js",
	"./js/core/snappee-presets.js",
	"./js/core/sunniesnow-import.js",
	"./js/core/timing.js",
	"./js/core/tip-point.js",
	"./js/dsp/auto-timing-worker.js",
	"./js/dsp/auto-timing.js",
	"./js/dsp/beat-denoise.js",
	"./js/dsp/beat-tracking.js",
	"./js/dsp/fft.js",
	"./js/dsp/novelty.js",
	"./js/dsp/onset-refine.js",
	"./js/dsp/tempo-grid.js",
	"./js/dsp/tempogram.js",
	"./js/dsp/window.js",
	"./js/boot/font-loader.js",
	"./js/ui/help.js",
	"./js/ui/i18n.js",
	"./js/boot/license-page.js",
	"./js/boot/manifest-link.js",
	"./js/platform/live-hosting.js",
	"./js/macro/macro-api-chart.js",
	"./js/macro/macro-api-entities.js",
	"./js/macro/macro-api-event.js",
	"./js/macro/macro-api-location.js",
	"./js/macro/macro-api-math.js",
	"./js/macro/macro-api.js",
	"./js/macro/macro-api.rb",
	"./js/macro/macro-completions.js",
	"./js/macro/macro-file-export.js",
	"./js/macro/macro-monaco-loader.js",
	"./js/macro/macro-sandbox.js",
	"./js/macro/macro-sandbox.bundle.js",
	"./js/macro/macros.js",
	"./js/core/mixin.js",
	"./js/boot/nw-source-bootstrap.js",
	"./js/ui/panel-clips.js",
	"./js/ui/panel-controls.js",
	"./js/ui/panel-history.js",
	"./js/ui/panels.js",
	"./js/ui/pen-path-field.js",
	"./js/platform/platform-file-kinds.js",
	"./js/platform/platform-host.js",
	"./js/platform/platform-level-archive.js",
	"./js/platform/platform-project-directory.js",
	"./js/platform/platform.js",
	"./js/render/chart-index-mutations.js",
	"./js/render/chart-index-removal.js",
	"./js/render/chart-index-tip-guides.js",
	"./js/render/chart-index.js",
	"./js/render/double-tap-index.js",
	"./js/render/flick-angle.js",
	"./js/render/interval-index.js",
	"./js/render/note-painting.js",
	"./js/render/pixi-surface.js",
	"./js/render/scroll-view.js",
	"./js/render/selection.js",
	"./js/render/sorted-records.js",
	"./js/render/stage-core.js",
	"./js/render/stage-drafts.js",
	"./js/render/stage-helpers.js",
	"./js/render/stage-hud.js",
	"./js/render/stage-interactions.js",
	"./js/render/stage-notes.js",
	"./js/render/stage-overlays.js",
	"./js/render/stage-patterns.js",
	"./js/render/stage-pointer.js",
	"./js/render/stage-snappees.js",
	"./js/render/stage-transform-drag.js",
	"./js/render/stage.js",
	"./js/render/timeline-drawing.js",
	"./js/render/timeline-gestures.js",
	"./js/render/timeline-helpers.js",
	"./js/render/timeline-pointer.js",
	"./js/render/timeline.js",
	"./js/boot/ruby-loader.js",
	"./js/boot/theme-bootstrap.js",
	"./js/ui/ui-dialogs.js",
	"./js/ui/ui-fields.js",
	"./js/ui/ui-layout.js",
	"./js/ui/ui-panels.js",
	"./js/ui/ui-shared.js",
	"./js/ui/ui-shell.js",
	"./js/ui/item-menu.js",
	"./js/ui/ui.js",
	"./js/boot/vendor-loader.js",
	"./json/i18n.en-US.json",
	"./json/i18n.zh-CN.json",
	"./macro-sandbox.html",
	"./docs/index.html",
	"./json/manual.en.json",
	"./json/manual.zh-CN.json",
	"./docs/docs.css",
	"./docs/docs.js",
	"./manifest.webmanifest",
	"./svg/icon.svg",
	...[
		"activate-snappee.svg", "activate.svg", "adjust-offset.svg", "allow-out-of-bound.svg",
		"attach.svg", "auto-save.svg", "bar-line.svg", "bg-note-se.svg", "bpm-change.svg",
		"create-bezier-curve.svg", "create-bg-note.svg", "create-bg-pattern.svg",
		"create-channel-above.svg", "create-channel-below.svg", "create-circular-curve.svg",
		"create-drag.svg", "create-flick.svg", "create-hold.svg", "create-radial-mesh.svg",
		"create-rectangular-mesh.svg", "create-regular-polygon-mesh.svg", "create-tap.svg",
		"deactivate-snappee.svg", "deactivate.svg", "delete-channel.svg", "delete.svg", "detach.svg",
		"down.svg", "duplicate.svg", "edit.svg", "flip-horizontally.svg", "flip-vertically.svg",
		"free-transform.svg", "fullscreen.svg", "live-hosting.svg", "lock-visible-range.svg", "macros.svg",
		"metronome.svg", "move-channel-down.svg", "move-channel-up.svg", "move-to-channel-above.svg",
		"move-to-channel-below.svg", "paste.svg", "pen.svg", "play-pause.svg", "read-only.svg",
		"rulers.svg", "save.svg", "se.svg", "seek-back-after-playing.svg", "seek-to-start.svg",
		"hide-channel.svg", "show-bg-events-in-main-field.svg", "show-bg-events-in-timeline.svg",
		"show-chart-boundary.svg",
		"show-grouping-in-main-field.svg", "show-grouping-in-timeline.svg", "show-hud.svg",
		"menu.svg", "show-channel.svg", "show-tip-points.svg", "speed-0-1.svg", "speed-0-25.svg",
		"speed-0-5.svg", "speed-1.svg", "time-lattice-1.svg",
		"time-lattice-2.svg", "time-lattice-3.svg", "time-lattice-4.svg", "time-lattice-6.svg",
		"time-lattice-8.svg", "up.svg", "zoom-in.svg", "zoom-out.svg",
	].map(name => `svg/icons/${name}`),
];
const CDN_ASSETS = [
	"https://cdn.jsdelivr.net/npm/pixi.js@8.19.0/dist/pixi.min.js",
	"https://cdn.jsdelivr.net/npm/mathjs@15.2.0/lib/browser/math.js",
	"https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
	"https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js",
	"https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.10.1/dist/browser.umd.js",
	"https://cdn.jsdelivr.net/npm/@ruby/4.0-wasm-wasi@2.10.1/dist/ruby+stdlib.wasm",
	"https://cdn.jsdelivr.net/npm/audio-decode@3.12.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode@3.12.0/+esm",
	"https://cdn.jsdelivr.net/npm/audio-type@2.4.2/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-mp3@1.3.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-flac@1.3.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-opus@1.3.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-vorbis@1.3.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-aac@1.4.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-wav@1.5.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-qoa@1.2.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-aiff@1.3.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-caf@1.4.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-webm@1.4.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-amr@1.3.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-wma@1.3.0/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-aac@1.4.0/src/aac.wasm.cjs/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-amr@1.3.0/src/amr.wasm.cjs/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-opus@1.3.0/src/opus.wasm.js/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-webm@1.4.0/src/opus.wasm.js/+esm",
	"https://cdn.jsdelivr.net/npm/@audio/decode-wma@1.3.0/src/wma.wasm.cjs/+esm",
	"https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@1.245.1/fonts/TTF/LXGWWenKai-Regular.ttf",
	"https://cdn.jsdelivr.net/gh/notofonts/math@53eb8eb200ed8fc73fa13d97d26a2c9c56428c17/fonts/NotoSansMath/full/ttf/NotoSansMath-Regular.ttf",
	"https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf",
	"https://cdn.jsdelivr.net/gh/kaio/wangfonts@268666d80f8029bb8c61b9668352c7a375873301/TrueType/wt071.ttf",
	"https://cdn.jsdelivr.net/gh/Kinutafontfactory/Yuji@efec977b14b57c19eb85d468edcfbbad13139e67/fonts/ttf/YujiBoku-Regular.ttf",
];

self.addEventListener("install", event => {
	event.waitUntil((async () => {
		const cache = await caches.open(SHELL_CACHE);
		await cache.addAll(APP_SHELL);
		await Promise.allSettled(CDN_ASSETS.map(async url => {
			const response = await fetch(url, { mode: "cors", cache: "reload", signal: AbortSignal.timeout(8000) });
			if (!response.ok) {
				throw new Error(`Unable to cache ${url}: HTTP ${response.status}`);
			}
			await cache.put(url, response);
		}));
		await self.skipWaiting();
	})());
});

self.addEventListener("activate", event => {
	event.waitUntil((async () => {
		const names = await caches.keys();
		await Promise.all(names
			.filter(name => name.startsWith("sviber-") && ![SHELL_CACHE, RUNTIME_CACHE].includes(name))
			.map(name => caches.delete(name)));
		await self.clients.claim();
	})());
});

async function cacheFirst(request) {
	const cached = await caches.match(request);
	if (cached) {
		return cached;
	}
	const response = await fetch(request);
	if (response.ok || response.type === "opaque") {
		const cache = await caches.open(RUNTIME_CACHE);
		await cache.put(request, response.clone());
	}
	return response;
}

async function staleWhileRevalidate(request) {
	const cached = await caches.match(request);
	const update = fetch(request).then(async response => {
		if (response.ok || response.type === "opaque") {
			const cache = await caches.open(RUNTIME_CACHE);
			await cache.put(request, response.clone());
		}
		return response;
	}).catch(() => null);
	return cached || await update || Response.error();
}

self.addEventListener("fetch", event => {
	if (event.request.method !== "GET") {
		return;
	}
	const url = new URL(event.request.url);
	if (event.request.mode === "navigate") {
		event.respondWith(fetch(event.request).catch(async () => {
			const pageUrl = new URL(event.request.url);
			pageUrl.search = "";
			pageUrl.hash = "";
			return (await caches.match(event.request))
				|| (await caches.match(pageUrl.href))
				|| (await caches.match(new URL("./index.html", self.location.href).href));
		}));
		return;
	}
	if (url.hostname.endsWith("jsdelivr.net")) {
		event.respondWith(staleWhileRevalidate(event.request));
		return;
	}
	if (url.origin === self.location.origin) {
		event.respondWith(cacheFirst(event.request));
	}
});
