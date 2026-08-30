import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceContracts, readSource } from "./audit-contract-helpers.mjs";

test("waveform interactions draw marks, BPM, playhead and snapping", async () => {
	await assertSourceContracts([
		["js/render/timeline-drawing.js", [/#8c9298|waveform/, /#d567ff/, /#ffe331/, /_drawBpmChanges/, /_loopSeconds|rgba\(47,143,255/]],
		["js/render/timeline-pointer.js", [/seekWaveform|onSeekSeconds/, /abLoop|Shift/, /timeDragging|snap/]],
		["js/render/timeline-gestures.js", [/abLoopGrabIndex|abLoopDragMarks/]],
	]);
});

test("timeline channels render hidden lanes, tails, groups and tip connectors", async () => {
	await assertSourceContracts([
		["js/render/timeline.js", [/visibleTimelineChannels|_visibleChannels/, /channelOffset|scrollChannelsBy/]],
		["js/render/timeline-drawing.js", [/#34383d|#d5dade/, /_drawEventDurationBar|durationHandles/, /_drawEventGroupRings/, /timelineTipSegments|tipSpawnDirectionSegment/]],
		["js/render/timeline-helpers.js", [/drawTimelineEventIcon|bgNote|bigText|comment/]],
		["js/render/timeline-pointer.js", [/eventClickSelectionMode/, /Ctrl|ctrlKey|Alt|altKey|Shift|shiftKey/]],
	]);
});

test("timeline selection movement handles and channel shortcuts follow the prompt", async () => {
	await assertSourceContracts([
		["js/render/timeline-pointer.js", [/_beginSelectionBox|_idsInSelectionBox|selectionBox/, /_altShiftMoveDrag|absoluteBeatSnap|absoluteChannel/, /duration|endTime/, /onEnterGroupSelection/]],
		["js/app/app-timeline-navigation.js", [/changeCurrentChannel|selectLast|revealChannel/]],
		["js/app/commands.js", [/channel\.select1|channel\.selectLast/]],
	]);
});

test("beat lines and scrollbar use documented colors and navigation priorities", async () => {
	const [helpers, drawing, pointer, navigation] = await Promise.all([
		readSource("js/render/timeline-helpers.js"),
		readSource("js/render/timeline-drawing.js"),
		readSource("js/render/timeline-pointer.js"),
		readSource("js/app/app-timeline-navigation.js"),
	]);
	for (const color of ["#ff2e59", "#3086ff", "#50a226", "#ff9d3d", "#d567ff", "#00e0ad"]) {
		assert.match(helpers + drawing, new RegExp(color.replace("#", "\\#")));
	}
	assert.match(drawing, /_drawScrollbar|#56db79|#2f8fff/);
	assert.match(pointer, /scroll|_hitTest/);
	assert.match(pointer, /priority|current|visible/);
	assert.match(navigation, /navigateWheel|pageVisibleRange/);
});

test("scroll view projection selection panning and group entry are wired", async () => {
	const scroll = await readSource("js/render/scroll-view.js");
	for (const pattern of [/baseline = height \* 0\.75/, /timeScale|xScale/, /eventDrawLayer|bgNote/, /scrollPanTarget|Ctrl|Space/, /#beginBoxSelection|selectionBox/, /dblclick|#doubleClick|onEnterGroupSelection/, /onSelectEvents|eventClickSelectionMode/]) {
		assert.match(scroll, pattern);
	}
});

test("status panel controls and information readouts are wired", async () => {
	const [view, bindings, vocabulary, html] = await Promise.all([
		readSource("js/app/app-status-view.js"),
		readSource("js/app/app-status-bindings.js"),
		readSource("js/core/chart-vocabulary.js"),
		readSource("index.html"),
	]);
	const statusIds = [
		"lock-visible-range",
		"play-se",
		"play-bg-note-se",
		"seek-back-after-playing",
		"metronome",
		"show-grouping-in-timeline",
		"show-grouping-in-main-field",
		"show-tip-points",
		"show-bg-events-in-timeline",
		"show-bg-events-in-main-field",
		"show-hud",
		"show-chart-boundary",
		"show-rulers",
		"read-only",
		"allow-out-of-bound",
		"fullscreen",
		"live-hosting",
	];
	for (const id of statusIds) {
		assert.match(html, new RegExp(`id=\\"${id}\\"`), id);
	}
	assert.match(view, /formatTime|formatBeat|formatSpeed|renderComments|renderSelectionCount/);
	assert.match(bindings, /addEventListener\("change"/);
	assert.match(vocabulary, /DEFAULT_EDITOR/);
});
