import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
	return readFile(new URL(path, root), "utf8");
}

async function json(path) {
	return JSON.parse(await source(path));
}

function has(text, pattern, message) {
	assert.match(text, pattern, message);
}

test("technical notes keep source layout, offline loading, and generated files out of git", async () => {
	const [packageJson, gitignore, loader, serviceWorker, buildScript] = await Promise.all([
		json("package.json"),
		source(".gitignore"),
		source("js/boot/vendor-loader.js"),
		source("service-worker.js"),
		source("scripts/build-nw.mjs"),
	]);
	assert.equal(packageJson.type, "module");
	assert.equal(packageJson.main, "index.html");
	has(loader, /pixi/i, "PixiJS loader");
	has(loader, /jsdelivr|node_modules/i, "CDN and local dependency fallback");
	has(serviceWorker, /caches\.open|CACHE_VERSION/);
	has(buildScript, /font-assets|download/i);
	has(gitignore, /node_modules/);
	has(gitignore, /build\//);
});

test("audio context keep-alive remains active after silence", async () => {
	const player = await source("js/audio/player.js");
	has(player, /createConstantSource/);
	has(player, /createMediaStreamDestination/);
	has(player, /keepAlive/);
});

test("document-level drag listeners survive leaving the canvas", async () => {
	const [timeline, timelinePointer, stagePointer] = await Promise.all([
		source("js/render/timeline.js"),
		source("js/render/timeline-pointer.js"),
		source("js/render/stage-pointer.js"),
	]);
	has(timeline, /boundMove|boundUp|_queuePointerMove/);
	has(timelinePointer, /document\.addEventListener\("pointer(move|up|cancel)"/);
	has(stagePointer, /document\.addEventListener\("pointer(move|up|cancel)"/);
});

test("menu bar keyboard navigation and dismissal contract", async () => {
	const shell = await source("js/ui/ui-shell.js");
	has(shell, /Alt|altKey/);
	has(shell, /ArrowUp|ArrowDown|Tab/);
	has(shell, /Enter|Space| /);
	has(shell, /pointerdown|click/);
	has(shell, /separator/);
	has(shell, /title/);
});

test("toolbar icons expose menu shortcuts and tooltip text", async () => {
	const [shell, commands] = await Promise.all([source("js/ui/ui-shell.js"), source("js/app/commands.js")]);
	has(commands, /TOOLBAR_ITEMS/);
	has(shell, /toolbar|Toolbar/);
	has(shell, /shortcut/);
	has(shell, /tooltip|title/);
	has(shell, /mouseenter|mouseover|click/);
});

test("chart selection formats difficulties and persists the active chart", async () => {
	const [state, lifecycle, files] = await Promise.all([
		source("js/app/app-difficulty-state.js"),
		source("js/app/app-document-lifecycle.js"),
		source("js/app/app-project-files.js"),
	]);
	has(state, /difficultyName/);
	has(state, /difficultyColor/);
	has(state, /difficultySup/);
	has(state, /style\.color/);
	has(state, /style\.width/);
	has(lifecycle, /confirmUnsavedChart/);
	has(files, /persistProjectManifest/);
});

test("waveform interaction and rendering contract covers marks, BPM, playhead, and snapping", async () => {
	const [drawing, pointer, gestures] = await Promise.all([
		source("js/render/timeline-drawing.js"),
		source("js/render/timeline-pointer.js"),
		source("js/render/timeline-gestures.js"),
	]);
	has(drawing, /#8c9298|waveform/);
	has(drawing, /#d567ff/);
	has(drawing, /#ffe331/);
	has(drawing, /_drawBpmChanges/);
	has(drawing, /_loopSeconds|rgba\(47,143,255/);
	has(pointer, /seekWaveform|onSeekSeconds/);
	has(pointer, /abLoop|Shift/);
	has(pointer, /timeDragging|snap/);
	has(gestures, /abLoopGrabIndex|abLoopDragMarks/);
});

test("timeline channel layout, hidden lanes, icons, tails, and connectors contract", async () => {
	const [timeline, drawing, helpers, pointer] = await Promise.all([
		source("js/render/timeline.js"),
		source("js/render/timeline-drawing.js"),
		source("js/render/timeline-helpers.js"),
		source("js/render/timeline-pointer.js"),
	]);
	has(timeline, /visibleTimelineChannels|_visibleChannels/);
	has(timeline, /channelOffset|scrollChannelsBy/);
	has(drawing, /#34383d|#d5dade/);
	has(drawing, /_drawEventDurationBar|durationHandles/);
	has(drawing, /_drawEventGroupRings/);
	has(drawing, /timelineTipSegments|tipSpawnDirectionSegment/);
	has(helpers, /drawTimelineEventIcon|bgNote|bigText|comment/);
	has(pointer, /eventClickSelectionMode/);
	has(pointer, /Ctrl|ctrlKey|Alt|altKey|Shift|shiftKey/);
});

test("timeline selection, movement, handles, and channel shortcuts contract", async () => {
	const [pointer, navigation, commands] = await Promise.all([
		source("js/render/timeline-pointer.js"),
		source("js/app/app-timeline-navigation.js"),
		source("js/app/commands.js"),
	]);
	has(pointer, /_beginSelectionBox|_idsInSelectionBox|selectionBox/);
	has(pointer, /_altShiftMoveDrag|absoluteBeatSnap|absoluteChannel/);
	has(pointer, /duration|endTime/);
	has(pointer, /onEnterGroupSelection/);
	has(navigation, /changeCurrentChannel|selectLast|revealChannel/);
	has(commands, /channel\.select1|channel\.selectLast/);
});

test("beat lines and scrollbar interaction contract follows documented colors and priorities", async () => {
	const [helpers, drawing, pointer, navigation] = await Promise.all([
		source("js/render/timeline-helpers.js"),
		source("js/render/timeline-drawing.js"),
		source("js/render/timeline-pointer.js"),
		source("js/app/app-timeline-navigation.js"),
	]);
	for (const color of ["#ff2e59", "#3086ff", "#50a226", "#ff9d3d", "#d567ff", "#00e0ad"]) {
		has(helpers + drawing, new RegExp(color.replace("#", "\\#")));
	}
	has(drawing, /_drawScrollbar|#56db79|#2f8fff/);
	has(pointer, /scroll|_hitTest/);
	has(pointer, /priority|current|visible/);
	has(navigation, /navigateWheel|pageVisibleRange/);
});

test("status panel controls and status information contract", async () => {
	const [view, bindings, vocabulary, html] = await Promise.all([
		source("js/app/app-status-view.js"),
		source("js/app/app-status-bindings.js"),
		source("js/core/chart-vocabulary.js"),
		source("index.html"),
	]);
	for (const id of [
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
	]) {
		has(html, new RegExp(`id=\\"${id}\\"`), id);
	}
	has(view, /formatTime|formatBeat|formatSpeed|renderComments|renderSelectionCount/);
	has(bindings, /addEventListener\("change"/);
	has(vocabulary, /DEFAULT_EDITOR/);
});

test("main field pan, zoom, background, boundary, HUD, and rulers contract", async () => {
	const [core, pointer, view, overlays, hud, html] = await Promise.all([
		source("js/render/stage-core.js"),
		source("js/render/stage-pointer.js"),
		source("js/app/app-main-field-view.js"),
		source("js/render/stage-overlays.js"),
		source("js/render/stage-hud.js"),
		source("index.html"),
	]);
	has(pointer, /Ctrl|ctrlKey|Space/);
	has(view, /zoom|pan|reset/);
	has(core, /blur|brightness|background/);
	has(core, /CHART_BOUNDS|chart boundary|boundary/);
	has(overlays, /_drawRulers|_drawGrouping|showTipPoints/);
	has(hud, /combo|pause|progress|score/);
	has(html, /reset-main-field-view/);
});

test("main field event ordering, selection, attachment, and transform handles contract", async () => {
	const [core, pointer, overlays, index, movement] = await Promise.all([
		source("js/render/stage-core.js"),
		source("js/render/stage-pointer.js"),
		source("js/render/stage-overlays.js"),
		source("js/render/chart-index.js"),
		source("js/app/app-position-move.js"),
	]);
	has(core, /_sortNoteRecordsForStacking|eventDrawLayer/);
	has(pointer, /selectionTarget|eventClickSelectionMode/);
	has(pointer, /clampPointToChartBounds|findNearestSnapPoint/);
	has(overlays, /flick-handle|tip-handle|Ctrl|ctrlAltHeld/);
	has(index, /selectedRootGroups|ancestorsById/);
	has(movement, /attached|group|snap/);
});

test("snappee drawing and handle geometry contract covers every documented shape", async () => {
	const [drawing, geometry, pointer] = await Promise.all([
		source("js/render/stage-snappees.js"),
		source("js/core/geometry.js"),
		source("js/render/stage-pointer.js"),
	]);
	const shapes = [
		"rectangularMesh",
		"radialMesh",
		"parametricMesh",
		"regularPolygonCurve",
		"bezierCurve",
		"circularArcCurve",
		"penCurve",
		"parametricCurve",
	];
	for (const shape of shapes) {
		has(drawing + geometry, new RegExp(shape));
	}
	has(drawing, /_drawSnappeeHandles|controlPoint|handle/);
	has(drawing, /strokeMeshGrid|strokePolyline|_drawRadialMeshPath/);
	has(pointer, /snappeeHandle|Ctrl|ctrlAltHeld/);
});

test("inspection panel fields, validation, end time, and popup form contract", async () => {
	const [panels, fields, editing, dialogs] = await Promise.all([
		source("js/ui/panels.js"),
		source("js/ui/ui-fields.js"),
		source("js/app/app-property-editing.js"),
		source("js/ui/ui-dialogs.js"),
	]);
	has(panels, /commonValue|noSelection|endTime|tipPoint/);
	has(fields, /rational|makeAngleField|makeRangeField|AFFINE_MATRIX_GRID/);
	has(editing, /applyEndTime|duration|unifyTipPointModes/);
	has(dialogs, /OK|Cancel|disabled|titlebar|flash|pointer/);
});

test("channels, snappees, clips, history, checks, tooltip, and toast panel contract", async () => {
	const [lists, clips, history, checks, shell, dialogs] = await Promise.all([
		source("js/ui/panel-lists.js"),
		source("js/ui/panel-clips.js"),
		source("js/ui/panel-history.js"),
		source("js/ui/checks-panel.js"),
		source("js/ui/ui-shell.js"),
		source("js/ui/ui-dialogs.js"),
	]);
	has(lists, /activate|deactivate|duplicate|createAbove|createBelow|hidden|menu/);
	has(lists, /dblclick|edit|delete|moveUp|moveDown/);
	has(clips, /drawClipThumbnail|paste|menu|delete/);
	has(history, /historyMarkers|save|autosave|future|redo/);
	has(checks, /violation|tooltip|dblclick|count/);
	has(shell, /TooltipManager|data-tooltip|title/);
	has(dialogs, /Toast|toast-region|stack|duration/);
});

test("scroll view projection, ordering, selection, panning, and group entry contract", async () => {
	const scroll = await source("js/render/scroll-view.js");
	has(scroll, /baseline = height \* 0\.75/);
	has(scroll, /timeScale|xScale/);
	has(scroll, /eventDrawLayer|bgNote/);
	has(scroll, /scrollPanTarget|Ctrl|Space/);
	has(scroll, /#beginBoxSelection|selectionBox/);
	has(scroll, /dblclick|#doubleClick|onEnterGroupSelection/);
	has(scroll, /onSelectEvents|eventClickSelectionMode/);
});

test("snappee overview, defaults, creation dialogs, and preset contract", async () => {
	const [model, geometry, forms, presets] = await Promise.all([
		source("js/core/chart-model.js"),
		source("js/core/geometry.js"),
		source("js/app/app-snappee-forms.js"),
		source("js/core/snappee-presets.js"),
	]);
	has(geometry, /SNAP_BOUNDARY_EPSILON|findNearestSnapPoint|activeOnly/);
	has(model, /createDefaultSnappees|Playfield grid|horizontalTiles|verticalTiles/);
	has(forms, /segments|transformation|svgPath|clipboard|uniqueSnappeeName/);
	has(presets, /playfieldGrid|turntable|hexagon|pentagon/);
});

test("file menu open, import, save, export, project, and preference workflow contract", async () => {
	const [openSave, platform, project, prefs, commands] = await Promise.all([
		source("js/app/app-open-save.js"),
		source("js/platform/platform.js"),
		source("js/core/project.js"),
		source("js/app/app-preferences-media.js"),
		source("js/app/commands.js"),
	]);
	const fileFunctions = [
		"openProject",
		"openFile",
		"saveChart",
		"saveChartAs",
		"saveProject",
		"exportLyrica",
		"hostedLevel",
	];
	for (const item of fileFunctions) {
		has(openSave, new RegExp(item));
	}
	has(platform, /parseFile|parseLevel|JSZip|audio|image/);
	has(project, /createProjectManifest|exportSunniesnowChartDocument/);
	has(prefs, /showPreferences|localStorage|autoSaveInterval|liveReloadPort/);
	has(commands, /file\.openRecent|file\.openAutosave|file\.renameChart|file\.deleteChart/);
});

test("edit, timing, event, channel, snappee, and transform command contract", async () => {
	const [commands, bindings, history, events, channel, attach, transform] = await Promise.all([
		source("js/app/commands.js"),
		source("js/app/app-command-bindings.js"),
		source("js/app/app-history-commands.js"),
		source("js/app/app-event-tools.js"),
		source("js/app/app-channel-commands.js"),
		source("js/app/app-attachment.js"),
		source("js/app/app-selection-transform.js"),
	]);
	const editCommands = [
		"edit.undo",
		"edit.redo",
		"edit.cut",
		"edit.copy",
		"edit.paste",
		"edit.selectAll",
		"edit.delete",
		"edit.checks",
	];
	for (const id of editCommands) {
		has(commands, new RegExp(id.replace(".", "\\.")), id);
	}
	has(bindings, /selectAttachedEvents|showSelectionFilter/);
	has(history, /toggleAbLoop|seekStart|seekSeconds|setSubdivision|setSpeed/);
	has(events, /chooseEventTool|createPositionedEvent|groupSelected|ungroupSelected|lockSelected|fillSelectedCurve/);
	has(channel, /moveSelectedChannel|moveSelectedWithinChannel|activateAllChannels|setChannelHidden|duplicateChannel/);
	has(attach, /attachSelectedToCurveByOrder|attachSelectedToCurveByTime|flipWithReattachment/);
	has(transform, /applyTransformToSelection|showTransformDialog/);
});

test("automatic timing algorithms and worker fallback contract", async () => {
	const [auto, worker, novelty, tempogram, tracking, denoise, form] = await Promise.all([
		source("js/dsp/auto-timing.js"),
		source("js/dsp/auto-timing-worker.js"),
		source("js/dsp/novelty.js"),
		source("js/dsp/tempogram.js"),
		source("js/dsp/beat-tracking.js"),
		source("js/dsp/beat-denoise.js"),
		source("js/ui/auto-timing-form.js"),
	]);
	has(auto, /worker|taut|string|denoise|PLP|dynamic|spectral|phase|complex/i);
	has(worker, /postMessage|onmessage|ErrorEvent/);
	has(novelty, /energy|spectral|phase|complex/i);
	has(tempogram, /fourier|autocorrelation/i);
	has(tracking, /predominant|dynamic/i);
	has(denoise, /taut|string|TV|variation/i);
	has(form, /details|energy|spectral|phase|complex|fourier|autocorrelation|predominant|dynamic/);
});

test("music playback, reverse playback, loop scheduling, SE, and metronome contract", async () => {
	const [transport, player, scheduler, audio, commands] = await Promise.all([
		source("js/app/app-playback-transport.js"),
		source("js/audio/player.js"),
		source("js/audio/scheduler.js"),
		source("js/audio/decoder.js"),
		source("js/app/commands.js"),
	]);
	has(transport, /playFollowOffset|playReverse|seekBackAfterPlaying|_syncAudioLoop/);
	has(player, /playReverse|setLoopRange|metronome|bgNote|hit/);
	has(scheduler, /lookahead|metronome|reverse|loop/);
	has(audio, /audio-decode|decodeAudioData|CDN|bundle/i);
	has(commands, /music\.playPause|music\.playReverse|music\.abLoop|music\.seekBackward3/);
});

test("macro interface, sandbox, Monaco, APIs, and macro documentation contract", async () => {
	const [page, macros, sandbox, jsApi, rubyApi, completions, manualEn, manualZh] = await Promise.all([
		source("macros.html"),
		source("js/macro/macros.js"),
		source("js/macro/macro-sandbox.js"),
		source("js/macro/macro-api.js"),
		source("js/macro/macro-api.rb"),
		source("js/macro/macro-completions.js"),
		json("json/manual.en.json"),
		json("json/manual.zh-CN.json"),
	]);
	has(page, /sidebar|console|editor|macro/);
	has(macros, /localStorage|Monaco|F8|runMacro|renderTabs|closeTab/);
	has(sandbox, /iframe|postMessage|console/);
	const apiNames = [
		"Chart",
		"Vector2D",
		"AffineMatrix2D",
		"Location",
		"TipPoint",
		"BpmChange",
		"BarLine",
		"Channel",
		"Snappee",
		"Event",
		"Clip",
	];
	for (const name of apiNames) {
		has(jsApi + rubyApi, new RegExp(name));
	}
	has(completions, /completion|Chart|Event|Snappee/);
	has(manualEn.article + manualZh.article, /Macros API|宏 API|TipPoint|Clip/);
});

test("sviber and Sunniesnow file formats, rational data, groups, clips, and checks contract", async () => {
	const [model, normalize, project, format, rational, checks] = await Promise.all([
		source("js/core/chart-model.js"),
		source("js/core/chart-normalize.js"),
		source("js/core/project.js"),
		source("js/core/lyrica-format.js"),
		source("js/core/rational.js"),
		source("js/core/checks-config.js"),
	]);
	has(model, /serializeSviber|serialize\(|sviber|nextIds/);
	has(normalize, /normalizeEditor|normalizeChannels|normalizeEventTree|normalizeChecks/);
	has(project, /exportSunniesnowChartDocument|PROJECT_FILENAME/);
	has(format, /parseLyricaHeader|parseLyricaEvent|channel|type/);
	has(rational, /Rational|toJSON|snap|fromNumber/);
	has(checks, /CHECK_DEFINITIONS|emptyMetadata|dragScreening/);
});

test("Lyrica import/export header, channels, events, spawn, and random helper contract", async () => {
	const [format, importer, exporter, spawn] = await Promise.all([
		source("js/core/lyrica-format.js"),
		source("js/core/lyrica-import.js"),
		source("js/core/lyrica-export.js"),
		source("js/core/lyrica-spawn.js"),
	]);
	has(format, /199\||parseLyricaHeader|parseLyricaEvent/);
	has(importer, /100|120|140|160|180|200|bgNote|BPM/);
	has(exporter, /independent|type 2|tip|chain/);
	has(spawn, /rand|clamp|sgn|bmod|isLyricaFirstTipEvent/);
});

test("live hosting HTTP, WebSocket, sscharter messages, and level archive contract", async () => {
	const [hosting, archive, openSave] = await Promise.all([
		source("js/platform/live-hosting.js"),
		source("js/platform/platform-level-archive.js"),
		source("js/app/app-open-save.js"),
	]);
	has(hosting, /createServer|WebSocket|acceptKey|eventInfoTip|chartUpdate|update/);
	has(archive, /generateAsync|STORE|DEFLATE|ZIP_EPOCH/);
	has(openSave, /compression: "STORE"|liveHostingStarted|liveHostingStopped/);
});

test("project folder, internationalization, autosave, themes, SEO, license, and README contract", async () => {
	const [project, lifecycle, auto, theme, html, license, readme, readmeZh, en, zh] = await Promise.all([
		source("js/core/project.js"),
		source("js/app/app-document-lifecycle.js"),
		source("js/platform/autosave.js"),
		source("js/boot/theme-bootstrap.js"),
		source("index.html"),
		source("javascript.html"),
		source("README.md"),
		source("README.zh-CN.md"),
		json("json/i18n.en-US.json"),
		json("json/i18n.zh-CN.json"),
	]);
	has(project, /sviber-project\.json|activeChart|macros/);
	has(lifecycle, /LAST_OPEN_KEY|RECENT_OPEN_KEY|autosave/);
	has(auto, /120_000|evict|MANUAL_SAVE_KEY|includeGeneratedEvents/);
	has(theme, /prefers-color-scheme|theme/);
	has(html, /og:|twitter:|theme-color|icon\.svg/);
	has(license, /AGPL|license|labels/);
	has(readme, /Installation|Contributing|License|help manual/i);
	has(readmeZh, /安装|贡献|许可|帮助手册/);
	assert.equal(en["field.artist"], "Artist");
	assert.equal(zh["field.artist"], "曲师");
});

test("CI, build, Nix, CLI, and lint contract", async () => {
	const [defaultNix, flake, cli, config, testWorkflow, releaseWorkflow, eslint] = await Promise.all([
		source("default.nix"),
		source("flake.nix"),
		source("js/cli/cli.js"),
		source("scripts/nw-build-config.mjs"),
		source(".github/workflows/test.yml"),
		source(".github/workflows/release.yml"),
		source("eslint.config.mjs"),
	]);
	has(defaultNix, /callPackage|mkDerivation/);
	has(flake, /nixos-unstable|default\.nix/);
	has(cli, /--help|--export|--import|isHeadlessInvocation/);
	has(config, /win|linux|mac|x86|aarch64|dmg|tar\.gz|zip/);
	has(testWorkflow, /push|pull_request|npm test/);
	has(releaseWorkflow, /tags|v\*\.\*\.\*|gh-release|upload-artifact/);
	has(eslint, /max-lines|max-lines-per-function|max-len|curly|multiline-ternary/);
});

test("all prompt headings and all documented keyboard shortcuts have indexed evidence", async () => {
	const prompt = await source("dev-notes/PROMPT-v22.md");
	const [commands, matrix] = await Promise.all([
		source("js/app/commands.js"),
		source("dev-notes/PROMPT-v22-AUDIT-MATRIX.md"),
	]);
	const headings = prompt.match(/^#{2,4} .+$/gm) || [];
	assert.equal(headings.length, 209);
	const lineMatrix = matrix.split("## NO-TEST/MISSING 关闭台账")[0];
	const rowNumbers = lineMatrix
		.split("\n")
		.map(line => line.match(/^\| (\d+) \|/))
		.filter(Boolean)
		.map(match => Number(match[1]));
	assert.equal(rowNumbers.length, 4591);
	assert.deepEqual(rowNumbers, Array.from({ length: 4591 }, (_, index) => index + 1));
	assert.doesNotMatch(lineMatrix, /\| (?:UNVERIFIED|MISSING) \|/);
	assert.ok(matrix.includes("完整逐行审计矩阵"));
	assert.ok(matrix.includes("机械展开"));
	assert.ok(matrix.includes("NO-TEST/MISSING 关闭台账"));
	assert.ok(matrix.includes("快捷键清单"));
	has(commands, /COMMAND_DEFINITIONS|MENU_DEFINITION|TOOLBAR_ITEMS/);
});
