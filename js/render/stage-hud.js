import { NOTE_TYPES, SUNNIESNOW_AUTOPLAY_GRADIENT } from "./stage-helpers.js";

// The head-up display of the main field, reproducing the Sunniesnow player chrome: the
// notched frame, the pause button, the chart title and difficulty, the score, the combo
// counter with its autoplay banner and the progress bar. It reads the chart but never
// mutates it, which keeps it clear of the pointer handling that shares the same canvas.

const HUD_FONT_FAMILY = "'Noto Sans Math', 'Noto Sans CJK TC', sans-serif";

// One half of the frame: a rectangle with a notched right edge, mirrored for the other side.
function drawHudFrameHalf(context, width, unit, mirrored) {
	context.save();
	if (mirrored) {
		context.translate(width, 0);
		context.scale(-1, 1);
	}
	context.beginPath();
	context.moveTo(0, 0);
	context.lineTo(20 * unit, 0);
	context.lineTo(22 * unit, 2 * unit);
	context.lineTo(20 * unit, 4 * unit);
	context.lineTo(0, 4 * unit);
	context.closePath();
	context.fillStyle = "rgba(0,0,0,0.5)";
	context.fill();
	context.beginPath();
	context.moveTo(20 * unit, 2 * unit);
	context.lineTo(19 * unit, 3 * unit);
	context.lineTo(18 * unit, 2 * unit);
	context.lineTo(20 * unit, 0);
	context.lineTo(22 * unit, 2 * unit);
	context.lineTo(20 * unit, 4 * unit);
	context.lineTo(0, 4 * unit);
	context.lineTo(0, 0);
	context.lineTo(20 * unit, 0);
	context.strokeStyle = "#ffffff";
	context.lineWidth = unit / 6;
	context.stroke();
	context.restore();
}

function drawHudFrame(context, width, unit) {
	drawHudFrameHalf(context, width, unit, false);
	drawHudFrameHalf(context, width, unit, true);
}

function drawPauseGlyph(context, pauseX, pauseY, pauseRadius) {
	context.save();
	context.fillStyle = "rgba(255,255,255,0.1)";
	context.strokeStyle = "#ffffff";
	context.lineWidth = Math.max(1, pauseRadius / 36);
	context.beginPath();
	const size = pauseRadius * 2;
	context.roundRect(pauseX - pauseRadius, pauseY - pauseRadius, size, size, pauseRadius / 4);
	context.fill();
	context.stroke();
	context.fillStyle = "#ffffff";
	context.fillRect(pauseX - pauseRadius / 2, pauseY - pauseRadius / 2, pauseRadius / 3, pauseRadius);
	context.fillRect(pauseX + pauseRadius / 6, pauseY - pauseRadius / 2, pauseRadius / 3, pauseRadius);
	context.restore();
}

// The score is shown right aligned, the difficulty name beside it in its own colour.
function drawHudScore(context, width, unit, metadata, score) {
	const hudFont = width / 45;
	context.textAlign = "right";
	context.font = `${hudFont}px ${HUD_FONT_FAMILY}`;
	context.fillStyle = "#ffffff";
	context.fillText(String(score), width - 2 * unit, 2 * unit);
	context.textAlign = "left";
	context.fillStyle = metadata.difficultyColor || "#7f7f7f";
	context.fillText(String(metadata.difficultyName || ""), width - 15 * unit, 2 * unit);
}

function drawHudProgressBar(context, width, height, bounds, now) {
	const span = Math.max(0.001, bounds[1] - bounds[0]);
	const progress = Math.max(0, Math.min(1, (now - bounds[0]) / span));
	const barHeight = width / 200;
	context.fillStyle = "rgba(255,255,255,0.5)";
	context.fillRect(0, height - barHeight, width, barHeight);
	context.fillStyle = "#c3efec";
	context.fillRect(0, height - barHeight, width * progress, barHeight);
}

export class StageHudTrait {
	_drawHud(context, width, height, project, now) {
		if (project.editor?.showHud === false) {
			return;
		}
		const metadata = project.metadata || this.state;
		const unit = width / 60;
		context.save();
		drawHudFrame(context, width, unit);
		this._drawHudHeader(context, width, unit, metadata);
		const hitCount = this._hudHitCount(project, now);
		drawHudScore(context, width, unit, metadata, this._hudScore(project, hitCount));
		this._drawHudCombo(context, width, hitCount);
		const bounds = this.callbacks.getTimeBounds?.() || [0, 10];
		drawHudProgressBar(context, width, height, bounds, now);
		context.restore();
	}

	// Pause button and chart title. The title font shrinks until the title fits the frame.
	_drawHudHeader(context, width, unit, metadata) {
		const hudFont = width / 45;
		const title = String(metadata.title || "");
		context.font = `${hudFont}px ${HUD_FONT_FAMILY}`;
		const titleWidth = context.measureText(title).width;
		const titleFont = hudFont * Math.min(1, (13 * unit) / Math.max(titleWidth, 1));
		context.font = `${titleFont}px ${HUD_FONT_FAMILY}`;
		context.fillStyle = "#ffffff";
		context.textBaseline = "middle";
		context.textAlign = "left";
		const pauseRadius = width / 45;
		const pauseX = width / 30;
		const pauseY = width / 30;
		drawPauseGlyph(context, pauseX, pauseY, pauseRadius);
		this.hitRegions.push({
			type: "hud-pause",
			x: pauseX - pauseRadius,
			y: pauseY - pauseRadius,
			width: pauseRadius * 2,
			height: pauseRadius * 2,
		});
		context.fillText(title, pauseX + pauseRadius + unit * 0.4, 2 * unit);
	}

	// Notes that have already been hit at `now`. The render index keeps a sorted list, the
	// fallback scans the chart for charts rendered without an index.
	_hudHitCount(project, now) {
		const indexed = this.renderIndex?.hudHitCount(now);
		if (indexed != null) {
			return indexed;
		}
		return project.events.filter(event => {
			if (!NOTE_TYPES.has(event.type)) {
				return false;
			}
			const { start, end } = this._eventTimes(event);
			return now >= (event.type === "hold" ? end : start);
		}).length;
	}

	_hudScore(project, hitCount) {
		const playableCount =
			this.renderIndex?.hitRecords.length ??
			project.events.filter(event => NOTE_TYPES.has(event.type)).length;
		if (!playableCount) {
			return 0;
		}
		return Math.floor((1_000_000 * hitCount) / playableCount);
	}

	// The combo counter pops every time it changes during playback, easing back to its
	// resting size over roughly a dozen frames.
	_hudComboScale(hitCount, playing) {
		if (hitCount !== this.lastHudCombo) {
			this.lastHudCombo = hitCount;
			this.hudComboAnimationStarted = playing ? performance.now() : null;
		}
		if (!playing) {
			this.hudComboAnimationStarted = null;
		}
		if (this.hudComboAnimationStarted == null) {
			return { scaleX: 1, scaleY: 1 };
		}
		const frames = (performance.now() - this.hudComboAnimationStarted) / (1000 / 60);
		return { scaleX: 1 + 0.6 * Math.exp(-0.6 * frames), scaleY: 1 + 0.5 * Math.exp(-0.5 * frames) };
	}

	_drawHudCombo(context, width, hitCount) {
		const playing = Boolean(this.callbacks.isPlaying?.());
		const { scaleX, scaleY } = this._hudComboScale(hitCount, playing);
		if (hitCount <= 0) {
			return;
		}
		context.save();
		context.translate(width / 2, width / 18);
		context.scale(scaleX, scaleY);
		context.textAlign = "center";
		context.fillStyle = "#ffffff";
		context.font = `${width / 30}px ${HUD_FONT_FAMILY}`;
		context.textBaseline = "bottom";
		context.fillText(String(hitCount), 0, 0);
		const autoplayFontSize = width / 45;
		const autoplayGradient = context.createLinearGradient(0, 0, 0, autoplayFontSize);
		autoplayGradient.addColorStop(0, SUNNIESNOW_AUTOPLAY_GRADIENT.top);
		autoplayGradient.addColorStop(1, SUNNIESNOW_AUTOPLAY_GRADIENT.bottom);
		context.fillStyle = autoplayGradient;
		context.font = `${autoplayFontSize}px ${HUD_FONT_FAMILY}`;
		context.textBaseline = "top";
		context.fillText("⟐ Autoplay ⟐", 0, 0);
		context.restore();
	}

	_drawSelectionBox(context, rectangle) {
		const x = Math.min(rectangle.x1, rectangle.x2);
		const y = Math.min(rectangle.y1, rectangle.y2);
		const width = Math.abs(rectangle.x2 - rectangle.x1);
		const height = Math.abs(rectangle.y2 - rectangle.y1);
		context.fillStyle = "rgba(48,134,255,0.17)";
		context.strokeStyle = "#72adff";
		context.lineWidth = 1;
		context.fillRect(x, y, width, height);
		context.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width, height);
	}
}
