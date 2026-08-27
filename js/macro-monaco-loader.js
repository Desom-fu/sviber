// Bringing up the Monaco editor for the macros window.
//
// Monaco ships as an AMD bundle, which means three things have to be arranged before it can be
// required: where the bundle lives (bundled with the desktop app, or the CDN), how its web
// workers are started (a data: URL shim, because the CDN and the page are different origins),
// and which localization bundle to load. Under NW.js there is a further wrinkle: Node's
// `require` occupies the global name Monaco's loader wants, so it is moved aside first.
//
// Split out of js/macros.js.

import { monacoLocale } from "./macro-completions.js";

const MONACO_VERSION = "0.52.2";
const MONACO_CDN_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

function loadScript(source) {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = source;
		script.addEventListener("load", resolve, { once: true });
		script.addEventListener("error", () => reject(new Error(`Unable to load ${source}`)), { once: true });
		document.head.append(script);
	});
}

// NW.js exposes Node's CommonJS `require` on window, which Monaco's AMD loader would mistake
// for its own. It is republished as `nodeRequire` so both remain reachable.
function relocateNodeRequire() {
	if (typeof window.require !== "function" || typeof window.require.config === "function") {
		return;
	}
	window.nodeRequire = window.require;
	try {
		delete window.require;
	} catch {
		window.require = undefined;
	}
}

function monacoBaseUrl(nwRuntime) {
	if (!nwRuntime) {
		return MONACO_CDN_BASE;
	}
	return new URL("node_modules/monaco-editor/min/vs", location.href).href.replace(/\/$/, "");
}

// Monaco's workers must be same-origin, so a tiny inline worker imports the real one.
function installWorkerShim(vsBase) {
	window.MonacoEnvironment = {
		getWorkerUrl: () =>
			`data:text/javascript;charset=utf-8,${encodeURIComponent(
				`self.MonacoEnvironment={baseUrl:'${vsBase}/'};importScripts('${vsBase}/base/worker/workerMain.js');`,
			)}`,
	};
}

// Resolves to the `monaco` namespace, ready to create editors.
export async function loadMonaco(language) {
	const nwRuntime = Boolean(globalThis.nw);
	if (nwRuntime) {
		relocateNodeRequire();
	}
	const vsBase = monacoBaseUrl(nwRuntime);
	if (!window.require?.config) {
		await loadScript(`${vsBase}/loader.js`);
	}
	if (!nwRuntime) {
		installWorkerShim(vsBase);
	}
	// v17: Monaco must come up in the editor language, so its localization bundle is
	// selected from the i18n language before editor.main is required.
	window.require.config({
		paths: { vs: vsBase },
		"vs/nls": { availableLanguages: { "*": monacoLocale(language) } },
	});
	await new Promise((resolve, reject) => window.require(["vs/editor/editor.main"], resolve, reject));
	return window.monaco;
}
