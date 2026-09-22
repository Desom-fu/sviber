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
	initial = null,
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
	// v0.17.20: optional containment — when checked, the diamond is clamped so it stays
	// fully inside the visible frame; unchecked keeps the old free-form behavior.
	const containedInput = createContainmentCheckbox(documentRef, initial);
	const containedLabel = documentRef.createElement("label");
	containedLabel.className = "cover-theme-widget-contained-label";
	containedLabel.append(
		containedInput.element,
		documentRef.createTextNode(i18n.t("field.renderCoverThemeContained")),
	);
	element.append(canvasHost, hint, containedLabel);

	const state = {
		x: initial?.x ?? 0,
		y: initial?.y ?? 0,
		width: initial?.width ?? 1,
	};
	const theme = { pixi: null, app: null, overlay: null, texture: null };
	const source = imageSource || resolveCoverThemeImageSource(app);
	if (!source.url && isDisplayableImageUrl(imageUrl)) {
		source.url = imageUrl;
	}

	// Re-clamps the view state after a drag or zoom; only active when the containment
	// box is checked. The diamond must stay fully inside the widget canvas, so the
	// radius (a quarter of width times the canvas width) can never exceed half the
	// smaller canvas side — that also caps the zoom.
	function applyContainment() {
		if (!containedInput.checked || !theme.app?.screen) {
			return;
		}
		clampCoverThemeContained(state, theme.app.screen.width, theme.app.screen.height);
	}

	containedInput.onChange(() => {
		applyContainment();
		layout();
	});

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

	attachCoverThemeWheel(canvasHost, state, layout, applyContainment);

	const ready = bootCoverThemeApp({
		theme,
		source,
		app,
		pixiLoader: () => globalThis.PIXI,
		width,
		height,
		state,
		canvasHost,
		fallback,
		layout,
		applyContainment,
	}).catch(() => {
		// Keep the CSS diamond fallback so the field is never an empty label.
	});

	return {
		element,
		ready,
		hint,
		destroy: () => destroyCoverThemeWidget(theme, source),
		read: () => coverThemeSelection(theme.app, theme.texture, state),
		// The remembered dialog state is the raw view state (plus the containment flag),
		// not the texture-space selection that read() derives for the renderer.
		readState: () => ({
			x: state.x,
			y: state.y,
			width: state.width,
			contained: containedInput.checked,
		}),
	};
}

function destroyCoverThemeWidget(theme, source) {
	destroyCoverThemeApp(theme);
	if (source.revoke && source.url) {
		URL.revokeObjectURL(source.url);
		source.revoke = false;
	}
}

export function coverThemeDiamond(screen, state) {
	const centerX = screen.width / 2 + state.x * screen.width * 0.25;
	const centerY = screen.height / 2 + state.y * screen.height * 0.25;
	const radius = (DIAMOND_HALF_WIDTH * state.width * screen.width) / 2;
	return { centerX, centerY, radius, corner: Math.max(1, radius / 10) };
}

// Containment math: the diamond (center ± radius on both axes) must stay inside the
// canvas. In state units the radius is width/4 * canvasWidth, so
//   x ∈ [width - 2, 2 - width]      (from centerX ± radius within [0, canvasWidth])
//   y ∈ [radius - H/2, H/2 - radius] / (H/4)  (same in height units)
// Both ranges are only non-empty while radius ≤ half of the smaller canvas side, which
// also caps the zoom (a 16:9 canvas caps width at 1.125).
export function clampCoverThemeContained(state, screenWidth, screenHeight) {
	const maxWidth = (2 * Math.min(screenWidth, screenHeight)) / screenWidth;
	state.width = clampRatio(state.width, 0.2, maxWidth);
	const radius = ((DIAMOND_HALF_WIDTH * state.width) / 2) * screenWidth;
	const xMin = (radius - screenWidth / 2) / (screenWidth * 0.25);
	const xMax = (screenWidth / 2 - radius) / (screenWidth * 0.25);
	const yMin = (radius - screenHeight / 2) / (screenHeight * 0.25);
	const yMax = (screenHeight / 2 - radius) / (screenHeight * 0.25);
	state.x = clampRatio(state.x, xMin, xMax);
	state.y = clampRatio(state.y, yMin, yMax);
	return state;
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

// Boots the PIXI application for the widget: waits for the shared dependencies, mounts
// the canvas, applies the remembered containment, loads the theme image and attaches the
// drag handlers. Failures are handled by the caller (the CSS diamond fallback stays).
async function bootCoverThemeApp({
	theme,
	source,
	app,
	pixiLoader,
	width,
	height,
	state,
	canvasHost,
	fallback,
	layout,
	applyContainment,
}) {
	await globalThis.sviberDependenciesReady;
	const pixi = pixiLoader();
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
	applyContainment();
	layout();
	await loadCoverThemeImage(theme, source, app, pixi, layout);
	attachCoverThemeDragHandlers(theme.app, state, layout, applyContainment);
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

// v0.17.20 containment checkbox: remembers the "keep the diamond inside the frame"
// preference together with the diamond view state.
function createContainmentCheckbox(documentRef, initial) {
	const input = documentRef.createElement("input");
	input.type = "checkbox";
	input.className = "cover-theme-widget-contained";
	input.checked = Boolean(initial?.contained);
	const listeners = new Set();
	input.addEventListener("change", () => {
		for (const listener of listeners) {
			listener();
		}
	});
	return {
		element: input,
		get checked() {
			return input.checked;
		},
		onChange(listener) {
			listeners.add(listener);
		},
	};
}

function attachCoverThemeWheel(canvasHost, state, layout, applyContainment) {
	canvasHost.addEventListener("wheel", event => {
		event.preventDefault();
		state.width = clampRatio(state.width * (event.deltaY > 0 ? 0.92 : 1.08), 0.2, 2);
		applyContainment?.();
		layout();
	});
}

function attachCoverThemeDragHandlers(app, state, layout, applyContainment) {
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
			applyContainment?.();
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
