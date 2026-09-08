// PixiJS widget for choosing the cover theme image area (PROMPT-v25 "Render cover...").
//
// The canvas shows the loaded image as a sprite the user can move by dragging and zoom by
// scrolling. A diamond-shaped area marks the part of the image that ends up as the cover
// theme image; everything outside the diamond is darkened.

import { Application, Assets, Graphics, Sprite } from "pixi.js";

const DIAMOND_HALF_WIDTH = 0.5;
const DARK = { color: 0x000000, alpha: 0.55 };

function drawDiamondOverlay(app, overlay, state) {
	const centerX = app.screen.width / 2 + state.x * app.screen.width * 0.25;
	const centerY = app.screen.height / 2 + state.y * app.screen.height * 0.25;
	const half = (DIAMOND_HALF_WIDTH * state.width * app.screen.width) / 2;
	const topY = centerY - half;
	const bottomY = centerY + half;
	const leftX = centerX - half;
	const rightX = centerX + half;
	// Darken everything outside the diamond with four rectangles, then stroke the diamond.
	overlay.rect(0, 0, app.screen.width, Math.max(0, topY));
	overlay.fill(DARK);
	overlay.rect(0, Math.min(bottomY, app.screen.height), app.screen.width, Math.max(0, app.screen.height - bottomY));
	overlay.fill(DARK);
	overlay.rect(0, Math.max(0, topY), Math.max(0, leftX), Math.max(0, bottomY - topY));
	overlay.fill(DARK);
	overlay.rect(rightX, Math.max(0, topY), Math.max(0, app.screen.width - rightX), Math.max(0, bottomY - topY));
	overlay.fill(DARK);
	overlay
		.moveTo(centerX, topY)
		.lineTo(rightX, centerY)
		.lineTo(centerX, bottomY)
		.lineTo(leftX, centerY)
		.closePath();
	overlay.stroke({ color: 0xffe331, width: 2 });
}

export function createCoverThemeWidget({
	imageUrl,
	documentRef = globalThis.document,
	width = 480,
	height = 270,
} = {}) {
	const element = documentRef.createElement("div");
	element.className = "cover-theme-widget";
	const canvasHost = documentRef.createElement("div");
	canvasHost.className = "cover-theme-widget-canvas";
	element.append(canvasHost);

	const app = new Application({ width, height, background: 0x15181b, antialias: true });
	canvasHost.append(app.canvas);

	let overlay = null;
	const state = { x: 0, y: 0, width: 1 };

	function layout() {
		if (overlay) {
			overlay.destroy();
		}
		overlay = new Graphics();
		drawDiamondOverlay(app, overlay, state);
		app.stage.addChild(overlay);
	}

	if (imageUrl) {
		Assets.load(imageUrl)
			.then(texture => {
				const sprite = new Sprite(texture);
				const scale = Math.min(app.screen.width / texture.width, app.screen.height / texture.height);
				sprite.scale.set(scale);
				sprite.position.set(
					(app.screen.width - texture.width * scale) / 2,
					(app.screen.height - texture.height * scale) / 2,
				);
				app.stage.addChildAt(sprite, 0);
				layout();
			})
			.catch(() => layout());
	} else {
		layout();
	}

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
	canvasHost.addEventListener("wheel", event => {
		event.preventDefault();
		state.width = clampRatio(state.width * (event.deltaY > 0 ? 0.92 : 1.08), 0.2, 2);
		layout();
	});

	return {
		element,
		destroy: () => app.destroy(true, { children: true, texture: false }),
		// Values are relative to the image size, matching sunniesnow-record's expectations.
		read: () => ({ x: state.x, y: state.y, width: state.width }),
	};
}

function clampRatio(value, minimum = -1, maximum = 1) {
	return Math.max(minimum, Math.min(maximum, value));
}
