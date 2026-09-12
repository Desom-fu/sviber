// PixiJS widget for choosing the cover theme image area (PROMPT-v25 "Render cover...").
//
// The canvas shows the loaded image; a rounded diamond (the same 4-gon Sunniesnow's
// CoverThemeImage uses) marks the crop. Drag pans the diamond, wheel zooms it.
// PIXI v8 must be init()'d before `app.canvas` exists — constructing Application with
// options is a v7 API and left this widget blank.

import { i18n } from "../ui/i18n.js";

const DIAMOND_HALF_WIDTH = 0.5;
const FRAME_COLOR = 0xfbfbff;

export function isDisplayableImageUrl(value) {
	return /^(blob:|data:|https?:|file:)/i.test(String(value || ""));
}

// The stage keeps the decoded background on `app.backgroundUrl` (a blob: URL). The chart
// only stores a filename like "cover.png", which PIXI cannot fetch — that is why the
// diamond used to sit on a black canvas. Prefer the live blob, then a File, then a URL.
export function resolveCoverThemeImageSource(app) {
	if (isDisplayableImageUrl(app?.backgroundUrl)) {
		return { url: app.backgroundUrl, revoke: false };
	}
	if (isDisplayableImageUrl(app?.files?.backgroundUrl)) {
		return { url: app.files.backgroundUrl, revoke: false };
	}
	const file = app?.files?.imageFile;
	if (file && typeof URL.createObjectURL === "function") {
		return { url: URL.createObjectURL(file), revoke: true };
	}
	if (isDisplayableImageUrl(app?.model?.image)) {
		return { url: app.model.image, revoke: false };
	}
	return { url: null, revoke: false };
}

export function createCoverThemeWidget({
	imageUrl,
	imageSource,
	app,
	documentRef = globalThis.document,
	width = 480,
	height = 270,
} = {}) {
	const element = documentRef.createElement("div");
	element.className = "cover-theme-widget";
	const canvasHost = documentRef.createElement("div");
	canvasHost.className = "cover-theme-widget-canvas";
	const fallback = documentRef.createElement("div");
	fallback.className = "cover-theme-widget-fallback";
	canvasHost.append(fallback);
	const hint = documentRef.createElement("div");
	hint.className = "cover-theme-widget-hint";
	hint.textContent = i18n.t("field.renderCoverThemeHint");
	element.append(canvasHost, hint);

	const state = { x: 0, y: 0, width: 1 };
	const theme = { pixi: null, app: null, overlay: null, texture: null };
	const source = imageSource || resolveCoverThemeImageSource(app);
	if (!source.url && isDisplayableImageUrl(imageUrl)) {
		source.url = imageUrl;
	}

	function layout() {
		const { app } = theme;
		if (!app?.stage || !theme.pixi) {
			return;
		}
		if (!theme.overlay) {
			theme.overlay = new theme.pixi.Graphics();
			app.stage.addChild(theme.overlay);
		} else {
			theme.overlay.clear();
		}
		paintCoverThemeOverlay(theme.overlay, app.screen, coverThemeDiamond(app.screen, state));
		theme.app.render?.();
	}

	canvasHost.addEventListener("wheel", event => {
		event.preventDefault();
		state.width = clampRatio(state.width * (event.deltaY > 0 ? 0.92 : 1.08), 0.2, 2);
		layout();
	});

	const ready = (async () => {
		await globalThis.sviberDependenciesReady;
		const pixi = globalThis.PIXI;
		if (!pixi?.Application) {
			throw new Error("PIXI is unavailable.");
		}
		theme.pixi = pixi;
		theme.app = await createCoverThemeApplication(pixi, width, height);
		const canvas = theme.app.canvas || theme.app.view;
		if (!canvas) {
			throw new Error("PIXI canvas is unavailable.");
		}
		fallback.remove();
		canvasHost.append(canvas);
		layout();
		await loadCoverThemeImage(theme, source, app, pixi, layout);
		attachCoverThemeDragHandlers(theme.app, state, layout);
	})().catch(() => {
		// Keep the CSS diamond fallback so the field is never an empty label.
	});

	return {
		element,
		ready,
		hint,
		destroy: () => {
			destroyCoverThemeApp(theme);
			if (source.revoke && source.url) {
				URL.revokeObjectURL(source.url);
				source.revoke = false;
			}
		},
		read: () => coverThemeSelection(theme.app, theme.texture, state),
	};
}

export function coverThemeDiamond(screen, state) {
	const centerX = screen.width / 2 + state.x * screen.width * 0.25;
	const centerY = screen.height / 2 + state.y * screen.height * 0.25;
	const radius = (DIAMOND_HALF_WIDTH * state.width * screen.width) / 2;
	return { centerX, centerY, radius, corner: Math.max(1, radius / 10) };
}

export function paintCoverThemeOverlay(overlay, screen, diamond) {
	overlay.rect(0, 0, screen.width, screen.height);
	overlay.fill({ color: 0x000000, alpha: 0.55 });
	overlay.roundPoly(diamond.centerX, diamond.centerY, diamond.radius, 4, diamond.corner);
	overlay.cut();
	overlay.roundPoly(diamond.centerX, diamond.centerY, diamond.radius, 4, diamond.corner);
	overlay.stroke({ color: FRAME_COLOR, width: Math.max(2, diamond.radius / 20) });
}

export function coverThemeSelection(app, texture, state) {
	if (!app?.screen || !texture) {
		return { x: null, y: null, width: null };
	}
	const diamond = coverThemeDiamond(app.screen, state);
	const scale = Math.min(app.screen.width / texture.width, app.screen.height / texture.height);
	const offsetX = (app.screen.width - texture.width * scale) / 2;
	const offsetY = (app.screen.height - texture.height * scale) / 2;
	return {
		x: (diamond.centerX - offsetX) / scale,
		y: (diamond.centerY - offsetY) / scale,
		width: (diamond.radius * 2) / scale,
	};
}

async function createCoverThemeApplication(pixi, width, height) {
	const options = {
		width,
		height,
		background: 0x15181b,
		antialias: true,
		autoStart: false,
		preference: "canvas",
	};
	const app = new pixi.Application();
	if (typeof app.init === "function") {
		try {
			await app.init(options);
			return app;
		} catch {
			const fallback = new pixi.Application();
			await fallback.init({ width, height, background: 0x15181b, antialias: true, autoStart: false });
			return fallback;
		}
	}
	return new pixi.Application(options);
}

export function destroyCoverThemeApp(theme) {
	const app = theme?.app;
	theme.app = null;
	if (!app) {
		return;
	}
	try {
		app.ticker?.stop();
	} catch {
		/* already stopped */
	}
	try {
		app.destroy(true, { children: true, texture: false });
	} catch {
		// PIXI v8 WebGL destroy can throw and take the NW.js window with it.
	}
}

export function coverThemeSpriteLayout(screen, texture) {
	const width = Number(texture.width) || Number(texture.orig?.width) || 1;
	const height = Number(texture.height) || Number(texture.orig?.height) || 1;
	const scale = Math.min(screen.width / width, screen.height / height);
	return {
		scale,
		x: (screen.width - width * scale) / 2,
		y: (screen.height - height * scale) / 2,
	};
}

async function loadCoverThemeImage(theme, source, app, pixi, layout) {
	let url = source.url;
	if (!url && app?.files?.fileForAsset && app.model?.image) {
		try {
			const file = await app.files.fileForAsset(app.model.image, "image");
			if (file && typeof URL.createObjectURL === "function") {
				url = URL.createObjectURL(file);
				source.url = url;
				source.revoke = true;
			}
		} catch {
			url = null;
		}
	}
	if (!url) {
		return;
	}
	try {
		const texture = await textureFromImageUrl(pixi, url);
		theme.texture = texture;
		const sprite = new pixi.Sprite(texture);
		const placed = coverThemeSpriteLayout(theme.app.screen, texture);
		sprite.scale.set(placed.scale);
		sprite.position.set(placed.x, placed.y);
		theme.app.stage.addChildAt(sprite, 0);
	} catch (error) {
		console.warn("Unable to load the cover theme image", error);
	}
	layout();
}

async function textureFromImageUrl(pixi, imageUrl) {
	const image = await decodeCoverThemeHtmlImage(imageUrl);
	if (typeof pixi.Texture?.from === "function") {
		const texture = pixi.Texture.from(image);
		if (texture) {
			return texture;
		}
	}
	if (pixi.Assets?.load) {
		return pixi.Assets.load(imageUrl);
	}
	throw new Error("Unable to create a PIXI texture.");
}

function decodeCoverThemeHtmlImage(imageUrl) {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Unable to decode the cover theme image."));
		image.src = imageUrl;
	});
}

function attachCoverThemeDragHandlers(app, state, layout) {
	let dragging = null;
	app.stage.eventMode = "static";
	app.stage.hitArea = app.screen;
	app.stage
		.on("pointerdown", event => {
			dragging = { x: event.global.x, y: event.global.y, originX: state.x, originY: state.y };
		})
		.on("pointermove", event => {
			if (!dragging) {
				return;
			}
			state.x = clampRatio(dragging.originX + (event.global.x - dragging.x) / (app.screen.width * 0.25));
			state.y = clampRatio(dragging.originY + (event.global.y - dragging.y) / (app.screen.height * 0.25));
			layout();
		})
		.on("pointerup", () => {
			dragging = null;
		})
		.on("pointerupoutside", () => {
			dragging = null;
		});
}

function clampRatio(value, minimum = -1, maximum = 1) {
	return Math.max(minimum, Math.min(maximum, value));
}
