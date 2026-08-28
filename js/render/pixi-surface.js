// A collapsed host reports 0×0. Mapping that to 1×1 paints the 2px playhead as the whole
// bitmap, which CSS then stretches into a yellow flash when the panel comes back.
export function canvasHostSize(host) {
	const width = Math.round(Number(host?.clientWidth) || 0);
	const height = Math.round(Number(host?.clientHeight) || 0);
	if (width <= 0 || height <= 0) {
		return null;
	}
	return { width, height };
}

export class PixiCanvasSurface {
	constructor(host, options = {}) {
		this.host = host;
		this.background = options.background || "#090a0c";
		this.onResize = options.onResize || null;
		// The renderer already draws with Canvas2D. Uploading that full canvas into
		// a one-sprite WebGL scene adds a costly copy without changing the output.
		this.directCanvas = options.directCanvas ?? true;
		this.app = null;
		this.canvas = null;
		this.buffer = document.createElement("canvas");
		this.context = this.buffer.getContext("2d", { alpha: false, desynchronized: true });
		this.texture = null;
		this.sprite = null;
		this.resizeObserver = null;
		this.width = 1;
		this.height = 1;
		this.ready = this.#initialize();
	}

	async #initialize() {
		if (!this.directCanvas) {
			await globalThis.sviberDependenciesReady;
		}
		if (!this.directCanvas && globalThis.PIXI) {
			this.app = new PIXI.Application();
			await this.app.init({
				width: 1,
				height: 1,
				background: this.background,
				antialias: true,
				resolution: 1,
				autoDensity: false,
				preference: "webgl",
			});
			this.canvas = this.app.canvas;
			this.canvas.className = "pixi-canvas";
			this.host.append(this.canvas);
		} else {
			this.canvas = this.buffer;
			this.canvas.className = "pixi-canvas";
			this.host.append(this.canvas);
		}
		this.resizeObserver = new ResizeObserver(() => {
			if (this.resize()) {
				this.onResize?.(this.width, this.height);
			}
		});
		this.resizeObserver.observe(this.host);
		this.resize();
		return this;
	}

	resize() {
		const size = canvasHostSize(this.host);
		if (!size || (size.width === this.width && size.height === this.height)) {
			return false;
		}
		this.width = size.width;
		this.height = size.height;
		this.buffer.width = size.width;
		this.buffer.height = size.height;
		if (this.app) {
			this.app.renderer.resize(size.width, size.height);
			this.#replaceTexture();
		}
		return true;
	}

	#replaceTexture() {
		this.sprite?.destroy({ children: true, texture: true });
		this.texture = PIXI.Texture.from(this.buffer, { resourceOptions: { autoGarbageCollect: false } });
		this.sprite = new PIXI.Sprite(this.texture);
		this.sprite.width = this.width;
		this.sprite.height = this.height;
		this.app.stage.addChild(this.sprite);
	}

	render(draw) {
		if (!this.context || !canvasHostSize(this.host)) {
			return;
		}
		const context = this.context;
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.fillStyle = this.background;
		context.fillRect(0, 0, this.width, this.height);
		context.restore();
		draw(context, this.width, this.height);
		if (this.texture) {
			this.texture.source.update();
		}
	}

	toLocal(event) {
		const rectangle = this.canvas.getBoundingClientRect();
		return {
			x: ((event.clientX - rectangle.left) * this.width) / Math.max(1, rectangle.width),
			y: ((event.clientY - rectangle.top) * this.height) / Math.max(1, rectangle.height),
		};
	}

	destroy() {
		this.resizeObserver?.disconnect();
		this.sprite?.destroy({ children: true, texture: true });
		this.app?.destroy(true, { children: true });
		if (!this.app) {
			this.canvas?.remove();
		}
		this.app = null;
		this.canvas = null;
	}
}
