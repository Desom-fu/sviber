// The recorder's stock background makes transparent pixels opaque before compositing.
// Install this only in a sviber render worker, leaving normal gameplay and CLI defaults alone.
import * as PIXI from "@pixi/node";

export function installRenderBackground(Sunniesnow, { kind, hasImage, fill }) {
	Sunniesnow.Background.load = function () {
		const { settings, app } = Sunniesnow.game;
		const { WIDTH: width, HEIGHT: height } = Sunniesnow.Config;
		const texture = hasImage ? settings.background : null;
		const blur = settings.backgroundBlur;
		const brightness = settings.backgroundBrightness;
		const canvas = app.renderer.name === "canvas";
		const backdrop = new PIXI.Container();
		let filter;
		if (texture) {
			const image = new PIXI.Sprite(texture);
			image.anchor.set(0.5);
			image.position.set(width / 2, height / 2);
			image.scale.set(Math.max(width / texture.width, height / texture.height));
			image.tint = Math.round(255 * brightness) * 0x010101;
			if (!canvas && blur > 0) {
				filter = new PIXI.BlurFilter({ strength: blur, quality: 4, repeatEdgePixels: true });
				image.filters = [filter];
			}
			backdrop.addChild(image);
		}
		const rendered = app.renderer.generateTexture({
			target: backdrop,
			frame: new PIXI.Rectangle(0, 0, width, height),
			// The editor darkens the composited background, including its matte.
			clearColor: new PIXI.Color(fill).multiply([brightness, brightness, brightness]).toArray(),
		});
		backdrop.destroy({ children: true });
		filter?.destroy();
		if (canvas && texture && blur > 0) {
			const image = app.renderer.extract.canvas(rendered);
			blurCanvas(image, Math.ceil(blur));
			rendered.destroy(true);
			this.texture = PIXI.Texture.from(image);
		} else {
			this.texture = rendered;
		}
	};
	if (kind === "cover") {
		const theme = Sunniesnow.CoverThemeImage.prototype;
		const populateImage = theme.populateImage;
		theme.populateImage = function () {
			const matte = new PIXI.Graphics();
			matte.roundPoly(0, 0, this.radius, 4, this.radius / 10).fill(fill);
			this.addChild(matte);
			if (hasImage && Sunniesnow.game.settings.background) {
				populateImage.call(this);
			}
		};
	}
}

// CanvasRenderer has no Pixi filters. Blur once at load time with a separable box filter;
// the backdrop is already opaque, so only RGB needs processing.
function blurCanvas(canvas, radius) {
	const { width, height } = canvas;
	const context = canvas.getContext("2d");
	const image = context.getImageData(0, 0, width, height);
	const scratch = new Uint8Array(image.data.length);
	blurLines(image.data, scratch, width, height, 4, width * 4, radius);
	blurLines(scratch, image.data, height, width, width * 4, 4, radius);
	context.putImageData(image, 0, 0);
}

function blurLines(source, target, length, lines, stride, pitch, radius) {
	const window = 2 * radius + 1;
	for (let line = 0; line < lines; line += 1) {
		for (let channel = 0; channel < 3; channel += 1) {
			const base = line * pitch + channel;
			let sum = source[base] * radius;
			for (let i = 0; i <= radius; i += 1) {
				sum += source[base + Math.min(i, length - 1) * stride];
			}
			for (let i = 0; i < length; i += 1) {
				target[base + i * stride] = Math.round(sum / window);
				sum += source[base + Math.min(i + radius + 1, length - 1) * stride];
				sum -= source[base + Math.max(i - radius, 0) * stride];
			}
		}
	}
}
