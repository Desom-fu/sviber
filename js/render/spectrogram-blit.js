// Blit a spectrogram ImageData through drawImage so PixiCanvasSurface's dpr setTransform
// scales CSS-pixel destinations onto the device-pixel buffer. putImageData ignores that
// transform and would paint a CSS-sized grid into the corner of a dpr=2 canvas.

export function createSpectrogramCanvas(width, height) {
	if (typeof OffscreenCanvas === "function") {
		return new OffscreenCanvas(width, height);
	}
	const canvas = globalThis.document?.createElement?.("canvas");
	if (!canvas) {
		throw new Error("spectrogram canvas is unavailable");
	}
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

export function blitSpectrogram(context, rectangle, image, options = {}) {
	const width = Math.max(1, Number(image?.width) || 0);
	const height = Math.max(1, Number(image?.height) || 0);
	const createCanvas = options.createCanvas || createSpectrogramCanvas;
	const canvas = createCanvas(width, height);
	const source = canvas.getContext("2d");
	const needsWrap = image?.data && typeof ImageData === "function" && !(image instanceof ImageData);
	const imageData = needsWrap ? new ImageData(image.data, width, height) : image;
	source.putImageData(imageData, 0, 0);
	context.drawImage(canvas, rectangle.x, rectangle.y, rectangle.width, rectangle.height);
	return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height };
}
