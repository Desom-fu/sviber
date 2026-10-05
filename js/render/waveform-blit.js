// The timeline waveform used to stroke one vertical min/max line per CSS pixel on every
// frame. Playback re-renders the timeline on every clock tick, so that path ran at 60 Hz
// even when the visible range had not moved — unlike the spectrogram, which keeps the
// rendered view and blits it. Keep the painted waveform on an offscreen canvas and blit
// it until the view moves; a play-follow pan copies the overlapping region and only
// samples the entering strip.

import { createSpectrogramCanvas } from "./spectrogram-blit.js";

export const WAVEFORM_BACKGROUND = "#101216";
export const WAVEFORM_STROKE = "#8c9298";

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
		this.width = 0;
		this.height = 0;
		this.start = 0;
		this.end = 0;
	}

	blit(context, rectangle, waveform, start, end) {
		const width = Math.max(1, Math.floor(rectangle.width));
		const height = Math.max(1, Math.floor(rectangle.height));
		if (this._matches(waveform, width, height, start, end)) {
			context.drawImage(this.canvas, rectangle.x, rectangle.y, rectangle.width, rectangle.height);
			return;
		}
		const span = end - start;
		if (this._canScroll(waveform, width, height, span)) {
			const dx = Math.round(((start - this.start) / span) * width);
			if (Math.abs(dx) < width) {
				if (dx !== 0) {
					this._scroll(waveform, start, end, dx);
				} else {
					this.start = start;
					this.end = end;
				}
				context.drawImage(this.canvas, rectangle.x, rectangle.y, rectangle.width, rectangle.height);
				return;
			}
		}
		this._rebuild(waveform, width, height, start, end);
		context.drawImage(this.canvas, rectangle.x, rectangle.y, rectangle.width, rectangle.height);
	}

	_matches(waveform, width, height, start, end) {
		return Boolean(
			this.canvas &&
				this.channels === waveform.channels &&
				this.width === width &&
				this.height === height &&
				this.start === start &&
				this.end === end,
		);
	}

	_canScroll(waveform, width, height, span) {
		const cachedSpan = this.end - this.start;
		return Boolean(
			this.canvas &&
				this.channels === waveform.channels &&
				this.width === width &&
				this.height === height &&
				Number.isFinite(span) &&
				span > 0 &&
				Math.abs(cachedSpan - span) <= 1e-9 * Math.max(1, Math.abs(span)),
		);
	}

	_ensureCanvases(width, height) {
		if (this.canvas && this.width === width && this.height === height) {
			return;
		}
		this.canvas = this.createCanvas(width, height);
		this.scratch = this.createCanvas(width, height);
		this.width = width;
		this.height = height;
	}

	_rebuild(waveform, width, height, start, end) {
		this._ensureCanvases(width, height);
		const context = this.canvas.getContext("2d");
		context.fillStyle = WAVEFORM_BACKGROUND;
		context.fillRect(0, 0, width, height);
		this._paintRange(context, waveform, start, end, width, height, 0, width);
		this.channels = waveform.channels;
		this.start = start;
		this.end = end;
	}

	_scroll(waveform, start, end, dx) {
		const { canvas, scratch, width, height } = this;
		const context = scratch.getContext("2d");
		context.fillStyle = WAVEFORM_BACKGROUND;
		context.fillRect(0, 0, width, height);
		context.drawImage(canvas, -dx, 0);
		if (dx > 0) {
			this._paintRange(context, waveform, start, end, width, height, width - dx, width);
		} else {
			this._paintRange(context, waveform, start, end, width, height, 0, -dx);
		}
		this.canvas = scratch;
		this.scratch = canvas;
		this.start = start;
		this.end = end;
	}

	_paintRange(context, waveform, start, end, width, height, fromX, toX) {
		const left = Math.max(0, Math.floor(fromX));
		const right = Math.min(width, Math.ceil(toX));
		if (right <= left || typeof waveform.getColumns !== "function") {
			return;
		}
		const span = end - start;
		const columns = waveform.getColumns(
			start + (left / width) * span,
			start + (right / width) * span,
			right - left,
		);
		paintWaveformColumns(context, columns, { x: left, y: 0, width: right - left, height });
	}

}
