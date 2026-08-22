import assert from "node:assert/strict";
import test from "node:test";

import { createSunniesnowHitSamples, sunniesnowHitSample } from "../js/audio/player.js";
import {
	StageView,
	SUNNIESNOW_AUTOPLAY_GRADIENT,
	SUNNIESNOW_SKIN,
	circularArcDraftSpan,
	colorIntegerToCss,
	isSnappeeVisible,
	randomColor,
	sunniesnowDisplayedPattern,
	sunniesnowEventVisualState,
	sunniesnowNoteRadius,
	sunniesnowNoteTextColor,
	sunniesnowPlayfieldScale,
	sunniesnowPatternVisualState,
	sunniesnowRegularPolygonPoints,
	sunniesnowTapDoubleLinePairs,
} from "../js/render/stage.js";

function assertPoint(actual, expectedX, expectedY) {
	assert.ok(Math.abs(actual.x - expectedX) < 1e-12, `expected x=${expectedX}, got ${actual.x}`);
	assert.ok(Math.abs(actual.y - expectedY) < 1e-12, `expected y=${expectedY}, got ${actual.y}`);
}

test("deactivated snappees are hidden from the stage", () => {
	assert.equal(isSnappeeVisible({ active: true }), true);
	assert.equal(isSnappeeVisible({}), true);
	assert.equal(isSnappeeVisible({ active: false }), false);
});

test("Autoplay uses Sunniesnow Lyrica 5 colors and note speed changes approach timing", () => {
	assert.deepEqual(SUNNIESNOW_AUTOPLAY_GRADIENT, { top: "#f3eba2", bottom: "#d2fbfa" });
	const event = { type: "tap" };
	assert.equal(sunniesnowEventVisualState(event, 1, 1, 0.6, 2).phase, "active");
	assert.equal(sunniesnowEventVisualState(event, 1, 1, 0.6, 4).phase, "fadingIn");
});

test("perfect hit effects use valid Sunniesnow gold and orange CSS colors", () => {
	assert.equal(colorIntegerToCss(0xbfaa00), "#bfaa00");
	assert.equal(colorIntegerToCss(0xffff00), "#ffff00");
	assert.equal(colorIntegerToCss(0xff7f00), "#ff7f00");
	assert.equal(randomColor(0xbfaa00, 0xbfaa00), "#bfaa00");
});

test("selected notes keep a contrasting text color", () => {
	assert.equal(sunniesnowNoteTextColor({ type: "tap", selected: true }, { phase: "active" }), "#ffffff");
	assert.equal(sunniesnowNoteTextColor({ type: "tap", selected: true }, { phase: "fadingOut" }), "#ffff55");
	assert.notEqual(sunniesnowNoteTextColor({ type: "tap", selected: true }, { phase: "active" }), SUNNIESNOW_SKIN.selectionTint);
});

test("pausing cancels only future hit effects while active effects finish", () => {
	const now = performance.now();
	const target = {
		particles: [{ started: now - 20 }, { started: now + 1000 }],
		rendered: false,
		particleAnimationFrame: 0,
		render() { this.rendered = true; },
	};
	StageView.prototype.cancelScheduledHits.call(target);
	assert.equal(target.particles.length, 1);
	assert.ok(target.particles[0].started <= now);
	assert.equal(target.rendered, true);
});

test("music stop clears in-flight hit effects immediately", () => {
	const now = performance.now();
	const target = {
		particles: [{ started: now - 20 }, { started: now + 1000 }],
		rendered: false,
		particleAnimationFrame: 0,
		render() { this.rendered = true; },
	};
	StageView.prototype.clearHitEffects.call(target);
	assert.equal(target.particles.length, 0);
	assert.equal(target.rendered, true);
});

test("circular-arc drafting stays continuous through pi and wraps only at a full turn", () => {
	const epsilon = 1e-6;
	assert.ok(Math.abs(circularArcDraftSpan(0, Math.PI - epsilon) - (Math.PI - epsilon)) < 1e-12);
	assert.ok(Math.abs(circularArcDraftSpan(0, Math.PI + epsilon) - (Math.PI + epsilon)) < 1e-12);
	assert.ok(circularArcDraftSpan(0, epsilon) < 2 * epsilon);
	assert.ok(circularArcDraftSpan(0, -epsilon) > Math.PI * 2 - 2 * epsilon);
	assert.equal(circularArcDraftSpan(0, Math.PI * 2), Math.PI * 2);
});

test("default note radii match the Sunniesnow skin settings", () => {
	assert.equal(sunniesnowNoteRadius("tap"), 11.875);
	assert.equal(sunniesnowNoteRadius("hold"), 11.875);
	assert.equal(sunniesnowNoteRadius("flick"), 11.875);
	assert.equal(sunniesnowNoteRadius("bgNote"), 11.875);
	assert.equal(sunniesnowNoteRadius("drag"), 8.125);
	assert.equal(SUNNIESNOW_SKIN.approachSpeed, 2);
});

test("playfield scaling matches Sunniesnow and responds to both stage dimensions", () => {
	assert.equal(sunniesnowPlayfieldScale(250, 150), 1);
	assert.equal(sunniesnowPlayfieldScale(500, 150), 1);
	assert.equal(sunniesnowPlayfieldScale(500, 300), 2);
	assert.equal(sunniesnowNoteRadius("tap") * sunniesnowPlayfieldScale(500, 300), 23.75);
});

test("background polygon vertices match PIXI regularPoly used by Sunniesnow", () => {
	const outerHexagon = sunniesnowRegularPolygonPoints(0, 0, 4 / Math.sqrt(3), 6, Math.PI / 2);
	assertPoint(outerHexagon[0], 4 / Math.sqrt(3), 0);
	assertPoint(outerHexagon[1], 2 / Math.sqrt(3), -2);

	const middleHexagon = sunniesnowRegularPolygonPoints(0, 0, 2, 6);
	assertPoint(middleHexagon[0], 0, -2);
	assertPoint(middleHexagon[1], -Math.sqrt(3), -1);

	const pentagonRadius = 4 / (1 + Math.cos(Math.PI / 5));
	const pentagonCenterY = -2 + pentagonRadius;
	const pentagon = sunniesnowRegularPolygonPoints(0, pentagonCenterY, pentagonRadius, 5);
	assertPoint(pentagon[0], 0, -2);
	assert.ok(pentagon[1].x < 0);

	const upwardTriangle = sunniesnowRegularPolygonPoints(0, 0, 2, 3);
	const downwardTriangle = sunniesnowRegularPolygonPoints(0, 0, 2, 3, Math.PI);
	assertPoint(upwardTriangle[0], 0, -2);
	assertPoint(downwardTriangle[0], 0, 2);
});

test("simultaneous taps form one adjacent double-line chain in data order", () => {
	const events = [
		{ id: "a", type: "tap", time: [1, 0, 1] },
		{ id: "other", type: "hold", time: [1, 0, 1] },
		{ id: "b", type: "tap", time: [1, 0, 1] },
		{ id: "c", type: "tap", time: [1, 0, 1] },
		{ id: "later-a", type: "tap", time: [2, 0, 1] },
		{ id: "d", type: "tap", time: [1, 0, 1] },
		{ id: "later-b", type: "tap", time: [2, 0, 1] },
	];
	const pairs = sunniesnowTapDoubleLinePairs(events)
		.map(pair => pair.map(event => event.id));

	assert.deepEqual(pairs, [
		["a", "b"],
		["b", "c"],
		["c", "d"],
		["later-a", "later-b"],
	]);
});

test("note phases reproduce shrinking-circle and exact-hit boundaries", () => {
	const tap = { type: "tap", text: "" };
	assert.equal(sunniesnowEventVisualState(tap, 1, 1, 0.249), null);
	const fadingIn = sunniesnowEventVisualState(tap, 1, 1, 0.375);
	assert.equal(fadingIn.phase, "fadingIn");
	assert.ok(Math.abs(fadingIn.progress - 0.5) < 1e-12);
	assert.equal(fadingIn.alpha, 1);
	assert.ok(Math.abs(sunniesnowEventVisualState({ type: "bgNote" }, 1, 1, 0.375).alpha - 0.5) < 1e-12);
	const approaching = sunniesnowEventVisualState(tap, 1, 1, 0.75);
	assert.equal(approaching.phase, "active");
	assert.equal(approaching.progress, 0.5);
	assert.deepEqual(sunniesnowEventVisualState(tap, 1, 1, 1).phase, "active");
	assert.equal(sunniesnowEventVisualState(tap, 1, 1, 1.0001), null);

	const textTap = { type: "tap", text: "A" };
	assert.equal(sunniesnowEventVisualState(textTap, 1, 1, 1.2).phase, "fadingOut");
	assert.equal(sunniesnowEventVisualState(textTap, 1, 1, 1 + 2 / 3 + 1e-6), null);
});

test("duration events hold at their event time and use game fade durations", () => {
	const hold = { type: "hold", text: "" };
	const atStart = sunniesnowEventVisualState(hold, 2, 3, 2);
	assert.equal(atStart.phase, "holding");
	assert.equal(atStart.progress, 0);
	assert.equal(sunniesnowEventVisualState(hold, 2, 3, 2.5).progress, 0.5);
	assert.equal(sunniesnowEventVisualState(hold, 2, 3, 3).phase, "fadingOut");
	assert.equal(sunniesnowEventVisualState(hold, 2, 3, 3 + 2 / 3), null);

	const zeroDurationBgNote = { type: "bgNote", text: "" };
	assert.equal(sunniesnowEventVisualState(zeroDurationBgNote, 4, 4, 4).phase, "active");
	assert.equal(sunniesnowEventVisualState(zeroDurationBgNote, 4, 4, 4.125).phase, "fadingOut");
	assert.equal(sunniesnowEventVisualState(zeroDurationBgNote, 4, 4, 4.25), null);
});

test("background patterns use Sunniesnow's one-sixth-second transitions", () => {
	assert.equal(sunniesnowPatternVisualState(1, 2, 1 - 1 / 6 - 0.001), null);
	assert.ok(Math.abs(sunniesnowPatternVisualState(1, 2, 1 - 1 / 12).progress - 0.5) < 1e-12);
	assert.equal(sunniesnowPatternVisualState(1, 2, 1).phase, "holding");
	assert.equal(sunniesnowPatternVisualState(1, 2, 2).phase, "fadingOut");
	assert.equal(sunniesnowPatternVisualState(1, 2, 2 + 1 / 6), null);
});

test("only the latest started background pattern remains displayed", () => {
	const timing = { beatToSeconds: value => Number(Array.isArray(value) ? value[0] + value[1] / value[2] : value) };
	const grid = { type: "grid", time: [0, 0, 1], duration: [0, 4, 1] };
	const turntable = { type: "turntable", time: [0, 1, 1], duration: [0, 1, 1] };
	assert.equal(sunniesnowDisplayedPattern([grid, turntable], timing, 0.5).event, grid);
	assert.equal(sunniesnowDisplayedPattern([grid, turntable], timing, 1.5).event, turntable);
	assert.equal(sunniesnowDisplayedPattern([grid, turntable], timing, 3), null);
});

test("hit sound samples match Sunniesnow's procedural default sound effects", () => {
	assert.ok(Math.abs(sunniesnowHitSample("tap", 0.01) - (-0.23220567541312792)) < 1e-12);
	assert.ok(Math.abs(sunniesnowHitSample("drag", 0.01) - 0.2242303770876735) < 1e-12);
	assert.ok(Math.abs(sunniesnowHitSample("flick", 0.01) - 0.4739878501170808) < 1e-12);
	assert.equal(sunniesnowHitSample("hold", 0.01), sunniesnowHitSample("tap", 0.01));

	const samples = createSunniesnowHitSamples("tap", 1000);
	assert.equal(samples.length, 300);
	assert.ok(Math.abs(samples[10] - sunniesnowHitSample("tap", 0.01)) < 1e-7);
});
