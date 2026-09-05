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

export function clampDevicePixelRatio(dpr, max = 3) {
	const value = Number(dpr);
	if (!Number.isFinite(value) || value <= 0) {
		return 1;
	}
	return Math.min(max, value);
}

export function canvasBufferSize(cssWidth, cssHeight, dpr) {
	const ratio = clampDevicePixelRatio(dpr);
	return {
		width: Math.max(1, Math.round(cssWidth * ratio)),
		height: Math.max(1, Math.round(cssHeight * ratio)),
		ratio,
	};
}

/** 2D context attrs: never desynchronized — that path can stop presenting after resize storms. */
export function canvas2dContextAttributes() {
	return { alpha: false, desynchronized: false };
}

/**
 * Schedule `run` at most once per animation frame. Rapid ResizeObserver / sidebar-drag
 * thrash collapses to a single flush that reads the latest host geometry.
 */
export function createResizeCoalescer(run, schedule = globalThis.requestAnimationFrame?.bind(globalThis)) {
	const state = { id: 0 };
	const scheduleCoalesced = (...args) => {
		if (state.id) {
			return state.id;
		}
		if (!schedule) {
			run(...args);
			return 0;
		}
		state.id = schedule(() => {
			state.id = 0;
			run(...args);
		});
		return state.id;
	};
	scheduleCoalesced.cancel = (cancel = globalThis.cancelAnimationFrame?.bind(globalThis)) => {
		if (!state.id) {
			return;
		}
		cancel?.(state.id);
		state.id = 0;
	};
	scheduleCoalesced.pending = () => state.id;
	return scheduleCoalesced;
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
		this.context = this.buffer.getContext("2d", canvas2dContextAttributes());
		this.texture = null;
		this.sprite = null;
		this.resizeObserver = null;
		this._coalescedResize = null;
		this.width = 1;
		this.height = 1;
		this.resolution = 1;
		this.ready = this.#initialize();
	}

	async #initialize() {
		if (!this.directCanvas) {
			await globalThis.sviberDependenciesReady;
		}
		const initialDpr = clampDevicePixelRatio(globalThis.devicePixelRatio || 1);
		if (!this.directCanvas && globalThis.PIXI) {
			this.app = new PIXI.Application();
			await this.app.init({
				width: 1,
				height: 1,
				background: this.background,
				antialias: true,
				resolution: initialDpr,
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
		this.resolution = initialDpr;
		// Collapse thrash-resize (sidebar drag) to one geometry apply + notify per frame.
		this._coalescedResize = createResizeCoalescer(() => {
			if (this.resize()) {
				this.onResize?.(this.width, this.height);
			}
		});
		this.resizeObserver = new ResizeObserver(() => {
			this._coalescedResize();
		});
		this.resizeObserver.observe(this.host);
		this.resize();
		return this;
	}

	resize() {
		const size = canvasHostSize(this.host);
		if (!size) {
			return false;
		}
		const dpr = clampDevicePixelRatio(globalThis.devicePixelRatio || 1);
		if (size.width === this.width && size.height === this.height && dpr === this.resolution) {
			return false;
		}
		this.width = size.width;
		this.height = size.height;
		this.resolution = dpr;
		const buffer = canvasBufferSize(size.width, size.height, dpr);
		try {
			this.buffer.width = buffer.width;
			this.buffer.height = buffer.height;
		} catch {
			// Oversized canvases can throw; keep last good buffer and skip this frame.
			return false;
		}
		// Display size comes from CSS (absolute 100% fill). Do not write style width/height
		// here — that used to churn layout during sidebar thrash and amplify RO storms.
		if (!this.context || this.context.canvas !== this.buffer) {
			this.context = this.buffer.getContext("2d", canvas2dContextAttributes());
		}
		if (this.app) {
			try {
				if (this.app.renderer.resolution !== dpr) {
					this.app.renderer.resolution = dpr;
				}
				this.app.renderer.resize(size.width, size.height);
				this.#replaceTexture();
			} catch {
				return false;
			}
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
		const dpr = this.resolution || 1;
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.fillStyle = this.background;
		context.fillRect(0, 0, this.buffer.width, this.buffer.height);
		context.restore();
		context.save();
		// Draw callbacks keep using CSS-pixel coordinates while the buffer is dpr-scaled.
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		draw(context, this.width, this.height);
		context.restore();
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
		this._coalescedResize?.cancel?.();
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
