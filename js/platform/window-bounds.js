const STORAGE_KEY = "sviber.windowBounds";

export function loadWindowBounds(name) {
	try {
		const all = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || "{}");
		const bounds = all?.[name];
		if (!bounds || typeof bounds !== "object") {
			return null;
		}
		const width = Number(bounds.width);
		const height = Number(bounds.height);
		const x = Number(bounds.x);
		const y = Number(bounds.y);
		if (!Number.isFinite(width) || !Number.isFinite(height)) {
			return null;
		}
		return {
			width: Math.max(480, width),
			height: Math.max(360, height),
			x: Number.isFinite(x) ? x : undefined,
			y: Number.isFinite(y) ? y : undefined,
		};
	} catch {
		return null;
	}
}

export function storeWindowBounds(name, bounds) {
	try {
		const all = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || "{}");
		all[name] = bounds;
		globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(all));
	} catch {
		/* Storage may be unavailable. */
	}
}

export function rememberNwWindow(name, nwWindow, fallback) {
	if (!nwWindow) {
		return;
	}
	const saved = loadWindowBounds(name);
	if (saved) {
		try {
			nwWindow.resizeTo(saved.width, saved.height);
			if (saved.x != null && saved.y != null) {
				nwWindow.moveTo(saved.x, saved.y);
			}
		} catch {
			/* Some NW.js builds reject moveTo before show. */
		}
	}
	const persist = () => {
		try {
			storeWindowBounds(name, {
				width: nwWindow.width || fallback.width,
				height: nwWindow.height || fallback.height,
				x: nwWindow.x,
				y: nwWindow.y,
			});
		} catch {
			/* ignore */
		}
	};
	nwWindow.on?.("move", persist);
	nwWindow.on?.("resize", persist);
	nwWindow.on?.("close", persist);
}
