"use strict";

const CACHE_VERSION = "sviber-v0713";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL = [
	"./",
	"./index.html",
	"./macros.html",
	"./javascript.html",
	"./source-viewer.html",
	"./package.json",
	"./css/app.css",
	"./css/overlays.css",
	"./css/themes.css",
	"./css/license.css",
	"./css/fonts-local.css",
	"./css/fonts-web.css",
	"./css/macros.css",
	"./css/app-v11.css",
	"./js/app-helpers.js",
	"./js/app-core.js",
	"./js/app-event-editing.js",
	"./js/app-free-transform.js",
	"./js/ui-layout.js",
	"./js/app-history-commands.js",
	"./js/app-file-workflows.js",
	"./js/app-chart-tools.js",
	"./js/ui-shared.js",
	"./js/ui-shell.js",
	"./js/ui-fields.js",
	"./js/ui-dialogs.js",
	"./js/ui-panels.js",
	"./js/nw-source-bootstrap.js",
	"./js/font-loader.js",
	"./js/license-page.js",
	"./js/theme-bootstrap.js",
	"./js/help.js",
	"./js/render/stage-helpers.js",
	"./js/render/stage-core.js",
	"./js/render/stage-notes.js",
	"./js/render/stage-interactions.js",
	"./js/render/chart-index.js",
	"./js/render/timeline-helpers.js",
	"./svg/icon.svg",
	"./js/vendor-loader.js",
	"./js/app.js?v=40",
	"./js/macros.js",
	"./js/commands.js",
	"./js/i18n.js",
	"./js/panels.js",
	"./js/platform.js",
	"./js/ui.js",
	"./js/live-hosting.js",
	"./js/core/chart-model.js",
	"./js/core/grouping.js",
	"./js/core/geometry.js",
	"./js/core/history.js",
	"./js/core/project.js",
	"./js/core/rational.js",
	"./js/core/timing.js",
	"./js/core/lyrica.js",
	"./js/core/tip-point.js",
	"./js/audio/player.js",
	"./js/audio/decoder.js",
	"./js/audio/scheduler.js",
	"./js/audio/waveform.js",
	"./js/render/pixi-surface.js",
	"./js/render/stage.js",
	"./js/render/timeline.js",
	"./js/render/scroll-view.js",
	"./js/render/selection.js",
	"./js/app-macro-bridge.js",
	"./js/core/snappee-presets.js",
	"./json/i18n.en-US.json",
	"./json/i18n.zh-CN.json",
	"./js/macro-api.js",
	"./js/macro-sandbox.js",
	"./js/ruby-loader.js",
	"./js/macro-api.rb",
	"./macro-sandbox.html",
	"./docs/index.html",
	"./docs/docs.css",
	"./docs/docs.js",
	"./manifest.webmanifest",
	...[
		"activate.svg", "auto-save.svg", "deactivate.svg", "delete.svg", "duplicate.svg", "save.svg",
		"activate-snappee.svg", "attach.svg", "bpm-change.svg", "create-bezier-curve.svg",
		"create-bg-note.svg", "create-bg-pattern.svg", "create-channel-above.svg",
		"create-channel-below.svg", "create-circular-curve.svg", "create-drag.svg",
		"create-flick.svg", "create-hold.svg", "create-radial-mesh.svg",
		"create-rectangular-mesh.svg", "create-regular-polygon-mesh.svg", "create-tap.svg",
		"deactivate-snappee.svg", "delete-channel.svg", "detach.svg", "edit.svg", "free-transform.svg",
		"move-channel-down.svg", "move-channel-up.svg", "up.svg", "down.svg", "move-to-channel-above.svg",
		"move-to-channel-below.svg", "pen.svg", "play-pause.svg", "seek-to-start.svg",
		"speed-0-25.svg", "speed-0-5.svg", "speed-1.svg", "time-lattice-1.svg",
		"time-lattice-2.svg", "time-lattice-3.svg", "time-lattice-4.svg",
		"time-lattice-6.svg", "time-lattice-8.svg", "zoom-in.svg", "zoom-out.svg",
		"flip-horizontally.svg", "flip-vertically.svg",
		"fullscreen.svg", "lock-visible-range.svg", "macros.svg", "metronome.svg",
		"read-only.svg", "se.svg", "seek-back-after-playing.svg",
		"allow-out-of-bound.svg", "live-hosting.svg", "paste.svg",
		"show-grouping-in-main-field.svg", "show-grouping-in-timeline.svg", "show-tip-points.svg",
		"show-bg-events-in-timeline.svg", "show-bg-events-in-main-field.svg",
		"show-hud.svg", "rulers.svg", "bar-line.svg",
	].map(name => `svg/icons/${name}`),
];
const CDN_ASSETS = [
	"https://cdn.jsdelivr.net/npm/pixi.js@8.19.0/dist/pixi.min.js",
	"https://cdn.jsdelivr.net/npm/mathjs@15.2.0/lib/browser/math.js",
	"https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
	"https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js",
	"https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.10.1/dist/browser.umd.js",
	"https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.7.2/dist/ruby+stdlib.wasm",
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
			if (!response.ok) throw new Error(`Unable to cache ${url}: HTTP ${response.status}`);
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
	if (cached) return cached;
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
	if (event.request.method !== "GET") return;
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
