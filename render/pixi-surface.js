export class PixiCanvasSurface {
	constructor(host, options = {}) {
		this.host = host;
		this.background = options.background || "#090a0c";
		this.onResize = options.onResize || null;
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
		await globalThis.sviberDependenciesReady;
		if (globalThis.PIXI) {
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
			this.host.append(this.canvas);
		}
		this.resizeObserver = new ResizeObserver(() => {
			if (this.resize()) this.onResize?.(this.width, this.height);
		});
		this.resizeObserver.observe(this.host);
		this.resize();
		return this;
	}

	resize() {
		const width = Math.max(1, Math.round(this.host.clientWidth));
		const height = Math.max(1, Math.round(this.host.clientHeight));
		if (width === this.width && height === this.height) return false;
		this.width = width;
		this.height = height;
		this.buffer.width = width;
		this.buffer.height = height;
		if (this.app) {
			this.app.renderer.resize(width, height);
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
		if (!this.context) return;
		const context = this.context;
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.fillStyle = this.background;
		context.fillRect(0, 0, this.width, this.height);
		context.restore();
		draw(context, this.width, this.height);
		if (this.texture) this.texture.source.update();
	}

	toLocal(event) {
		const rectangle = this.canvas.getBoundingClientRect();
		return {
			x: (event.clientX - rectangle.left) * this.width / Math.max(1, rectangle.width),
			y: (event.clientY - rectangle.top) * this.height / Math.max(1, rectangle.height),
		};
	}

	destroy() {
		this.resizeObserver?.disconnect();
		this.sprite?.destroy({ children: true, texture: true });
		this.app?.destroy(true, { children: true });
		if (!this.app) this.canvas?.remove();
		this.app = null;
		this.canvas = null;
	}
}
