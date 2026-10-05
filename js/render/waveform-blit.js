// The timeline waveform used to stroke one vertical min/max line per CSS pixel on every
// frame. Playback re-renders the timeline on every clock tick, so that path ran at 60 Hz
// even when the visible range had not moved. Keep the painted waveform on an offscreen
// canvas and blit it until the view moves.
//
// Play-follow must not drop the sub-pixel remainder: rounding the scroll to whole pixels
// and then treating the bitmap as if it already sat at the new time made the waveform
// walk slower than the beat lines. Integer-copy the overlapping region, advance the
// painted view by exactly those pixels, and drawImage at the leftover fractional offset
// so a peak at time t stays on the same x as `_timeToX(t)`.

import { createSpectrogramCanvas } from "./spectrogram-blit.js";

export const WAVEFORM_BACKGROUND = "#101216";
export const WAVEFORM_STROKE = "#8c9298";
export const WAVEFORM_CACHE_OVERSCAN = 1;

export function waveformBlitOffset(rectangleX, start, viewStart, span, viewWidth) {
	const frac = ((start - viewStart) / span) * viewWidth;
	return rectangleX - WAVEFORM_CACHE_OVERSCAN - frac;
}

export function paintWaveformColumns(context, columns, rectangle) {
	const middle = rectangle.y + rectangle.height / 2;
	const amplitude = rectangle.height * 0.43;
	context.strokeStyle = WAVEFORM_STROKE;
	context.globalAlpha = 0.9;
	context.lineWidth = 1;
	context.beginPath();
	for (let x = 0; x < columns.length; x += 1) {
		const peak = columns[x];
		const px = rectangle.x + x + 0.5;
		context.moveTo(px, middle - peak.max * amplitude);
		context.lineTo(px, middle - peak.min * amplitude);
	}
	context.stroke();
	context.globalAlpha = 1;
}

export class WaveformViewCache {
	constructor(options = {}) {
		this.createCanvas = options.createCanvas || createSpectrogramCanvas;
		this.canvas = null;
		this.scratch = null;
		this.channels = null;
		this.viewWidth = 0;
		this.canvasWidth = 0;
		this.height = 0;
		this.viewStart = 0;
		this.viewEnd = 0;
	}

	blit(context, rectangle, waveform, start, end) {
		const width = Math.max(1, Math.floor(rectangle.width));
		const height = Math.max(1, Math.floor(rectangle.height));
		const span = end - start;
		if (!this._matches(waveform, width, height, start, end)) {
			if (this._canScroll(waveform, width, height, span)) {
				this._follow(waveform, start, end, width, height, span);
			} else {
				this._rebuild(waveform, width, height, start, end);
			}
		}
		this._blitTo(context, rectangle, start, span);
	}

	_matches(waveform, width, height, start, end) {
		return Boolean(
			this.canvas &&
				this.channels === waveform.channels &&
				this.viewWidth === width &&
				this.height === height &&
				this.viewStart === start &&
				this.viewEnd === end,
		);
	}

	_canScroll(waveform, width, height, span) {
		const cachedSpan = this.viewEnd - this.viewStart;
		return Boolean(
			this.canvas &&
				this.channels === waveform.channels &&
				this.viewWidth === width &&
				this.height === height &&
				Number.isFinite(span) &&
				span > 0 &&
				Math.abs(cachedSpan - span) <= 1e-9 * Math.max(1, Math.abs(span)),
		);
	}

	_follow(waveform, start, end, width, height, span) {
		const pixelOffset = ((start - this.viewStart) / span) * width;
		if (!Number.isFinite(pixelOffset) || Math.abs(pixelOffset) >= width) {
			this._rebuild(waveform, width, height, start, end);
			return;
		}
		const dx = pixelOffset >= 0 ? Math.floor(pixelOffset) : Math.ceil(pixelOffset);
		if (dx !== 0) {
			this._scroll(waveform, dx, span);
		}
	}

	_ensureCanvases(canvasWidth, height) {
		if (this.canvas && this.canvasWidth === canvasWidth && this.height === height) {
			return;
		}
		this.canvas = this.createCanvas(canvasWidth, height);
		this.scratch = this.createCanvas(canvasWidth, height);
		this.canvasWidth = canvasWidth;
		this.height = height;
	}

	_rebuild(waveform, width, height, start, end) {
		const canvasWidth = width + WAVEFORM_CACHE_OVERSCAN * 2;
		this.viewWidth = width;
		this.viewStart = start;
		this.viewEnd = end;
		this.channels = waveform.channels;
		this._ensureCanvases(canvasWidth, height);
		const context = this.canvas.getContext("2d");
		context.fillStyle = WAVEFORM_BACKGROUND;
		context.fillRect(0, 0, canvasWidth, height);
		this._paintRange(context, waveform, 0, canvasWidth);
	}

	_scroll(waveform, dx, span) {
		const dt = span / this.viewWidth;
		this.viewStart += dx * dt;
		this.viewEnd += dx * dt;
		const { canvas, scratch, canvasWidth, height } = this;
		const context = scratch.getContext("2d");
		context.fillStyle = WAVEFORM_BACKGROUND;
		context.fillRect(0, 0, canvasWidth, height);
		context.drawImage(canvas, -dx, 0);
		if (dx > 0) {
			this._paintRange(context, waveform, canvasWidth - dx, canvasWidth);
		} else {
			this._paintRange(context, waveform, 0, -dx);
		}
		this.canvas = scratch;
		this.scratch = canvas;
	}

	_paintRange(context, waveform, fromX, toX) {
		const left = Math.max(0, Math.floor(fromX));
		const right = Math.min(this.canvasWidth, Math.ceil(toX));
		if (right <= left || typeof waveform.getColumns !== "function") {
			return;
		}
		const dt = (this.viewEnd - this.viewStart) / this.viewWidth;
		const origin = this.viewStart - WAVEFORM_CACHE_OVERSCAN * dt;
		const columns = waveform.getColumns(origin + left * dt, origin + right * dt, right - left);
		paintWaveformColumns(context, columns, { x: left, y: 0, width: right - left, height: this.height });
	}

	_blitTo(context, rectangle, start, span) {
		const destX = waveformBlitOffset(rectangle.x, start, this.viewStart, span, this.viewWidth);
		context.save();
		context.beginPath();
		context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
		context.clip();
		context.drawImage(this.canvas, destX, rectangle.y, this.canvasWidth, this.height);
		context.restore();
	}

}
