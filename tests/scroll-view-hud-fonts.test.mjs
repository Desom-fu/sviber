import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HUD_FONT_FAMILY } from "../js/render/stage-hud.js";
import { drawTimelineEventIcon } from "../js/render/timeline-helpers.js";

test("scroll view texts use the main editor HUD font families", async () => {
	const [scrollSource, hudSource] = await Promise.all([
		readFile(new URL("../js/render/scroll-view.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/stage-hud.js", import.meta.url), "utf8"),
	]);
	assert.match(hudSource, /export const HUD_FONT_FAMILY =/);
	assert.match(scrollSource, /import \{ HUD_FONT_FAMILY \} from "\.\/stage-hud\.js"/);
	assert.match(scrollSource, /context\.font = `10px \$\{HUD_FONT_FAMILY\}`/);
	assert.doesNotMatch(scrollSource, /sans-serif/);

	// Event icon texts in the scroll view are drawn through drawTimelineEventIcon.
	const fonts = [];
	const context = {
		font: "",
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
		textAlign: "left",
		textBaseline: "alphabetic",
		save() {},
		restore() {},
		beginPath() {},
		moveTo() {},
		lineTo() {},
		arc() {},
		closePath() {},
		fill() {},
		stroke() {},
		fillRect() {},
		strokeRect() {},
		translate() {},
		rotate() {},
		fillText(text) {
			fonts.push({ text: String(text), font: this.font });
		},
	};
	drawTimelineEventIcon(context, { type: "tap", text: "あ" }, 40, 40, "#ffffff", 1);
	drawTimelineEventIcon(context, { type: "hold", text: "H" }, 60, 40, "#ffffff", 1);
	drawTimelineEventIcon(context, { type: "flick", angle: 0, text: "F" }, 80, 40, "#ffffff", 1);
	drawTimelineEventIcon(context, { type: "bigText", text: "B" }, 100, 40, "#ffffff", 1);

	assert.ok(fonts.length >= 4);
	for (const entry of fonts) {
		assert.ok(
			entry.font.includes(HUD_FONT_FAMILY),
			`Expected HUD font family for scroll icon "${entry.text}", got "${entry.font}"`,
		);
	}
});
