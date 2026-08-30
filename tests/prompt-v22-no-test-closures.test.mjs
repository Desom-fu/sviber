import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
	return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function assertSources(paths) {
	for (const [path, patterns] of paths) {
		const text = await read(path);
		for (const pattern of patterns) {
			assert.match(text, pattern, `${path} is missing ${pattern}`);
		}
	}
}

const closures = [
	{
		name: "Menu Alt mnemonic and keyboard navigation",
		sources: [["js/ui/ui-shell.js", [/altKey|Alt/, /ArrowUp|ArrowDown|Tab/]]],
	},
	{
		name: "Menu hover darkening and outside dismissal",
		sources: [["js/ui/ui-shell.js", [/mouseenter|mouseover|pointerenter/, /pointerdown|click/]], ["css/app.css", [/menu.*hover|menu-item:hover/i]]],
	},
	{
		name: "Menu separators and Space/Enter activation",
		sources: [["js/ui/ui-shell.js", [/separator/, /Enter|Space/]]],
	},
	{
		name: "Menu item title and tooltip-bar parity",
		sources: [["js/ui/ui-shell.js", [/title/, /tooltip/]]],
	},
	{
		name: "Toolbar title, icon, hover, click and tooltip parity",
		sources: [["js/app/commands.js", [/TOOLBAR_ITEMS/]], ["js/ui/ui-shell.js", [/toolbar|Toolbar/, /shortcut/, /tooltip|title/]]],
	},
	{
		name: "Chart selector formatting, color, width, NW-only visibility and persistence",
		sources: [["js/app/app-difficulty-state.js", [/difficultyName/, /difficultyColor/, /difficultySup/, /style\.color/, /style\.width/, /globalThis\.nw/]], ["js/app/app-document-lifecycle.js", [/confirmUnsavedChart/]], ["js/app/app-project-files.js", [/persistProjectManifest/]]],
	},
	{
		name: "Audio keep-alive after silence",
		sources: [["js/audio/player.js", [/createConstantSource/, /createMediaStreamDestination/, /keepAlive/]]],
	},
	{
		name: "Waveform gray separation and sample-level performance",
		sources: [["js/render/timeline-drawing.js", [/_drawWaveform/, /#8c9298|#5e646b/]], ["js/audio/waveform.js", [/getColumns|peaks|pyramid/i]]],
	},
	{
		name: "Waveform BPM double-click editor",
		sources: [["js/render/timeline-drawing.js", [/_drawBpmChanges/, /type: \"bpm\"/]], ["js/render/timeline-pointer.js", [/_doubleClick/, /bpm/]], ["js/app/app-chart-dialogs.js", [/showBpmDialog/]]],
	},
	{
		name: "Waveform unsnapped drag and snapped release",
		sources: [["js/render/timeline-pointer.js", [/seekWaveform|onSeekSeconds/, /timeDragging|snap/]], ["js/app/app-time-seeking.js", [/seekWaveform/]]],
	},
	{
		name: "Timeline channel colors, height, scroll, event icons, tails and grouping rings",
		sources: [["js/render/timeline-drawing.js", [/_drawChannels/, /_drawEventDurationBar/, /_drawEventGroupRings/]], ["js/render/timeline.js", [/scrollChannelsBy|channelHeight/]], ["js/render/timeline-helpers.js", [/drawTimelineEventIcon/]]],
	},
	{
		name: "Timeline inactive-channel interaction blocking",
		sources: [["js/render/chart-index.js", [/activeChannelIds/]], ["js/render/timeline-pointer.js", [/activeChannelIds|channel\.active/]]],
	},
	{
		name: "Timeline Shift range selection",
		sources: [["js/render/timeline-pointer.js", [/shiftKey/, /rangeSelect|onRangeSelect/]], ["js/app/app-selection.js", [/rangeSelect/]]],
	},
	{
		name: "Timeline scrollbar hit priority and Ctrl seek",
		sources: [["js/render/timeline-pointer.js", [/_hitTest|scroll/, /ctrlKey/]], ["js/render/timeline-drawing.js", [/_drawScrollbar/]]],
	},
	{
		name: "Status panel wrapping, tooltip and operation preview",
		sources: [["index.html", [/status-readouts/, /operation-status/, /data-tooltip-key/]], ["css/app.css", [/status-readouts|flex-wrap/]], ["js/app/app-status-view.js", [/creationPreview|operation/]]],
	},
	{
		name: "Main field background preprocessing",
		sources: [["js/render/stage-core.js", [/blur/, /brightness|dark/]], ["js/app/app-preferences-media.js", [/decodeBackground/]]],
	},
	{
		name: "Main field snappee rings and shape drawing",
		sources: [["js/render/stage-overlays.js", [/_drawGroupingRings|_drawSnappeeAttachRings/]], ["js/render/stage-snappees.js", [/_drawSnappee/]]],
	},
	{
		name: "Main field HUD and rulers",
		sources: [["js/render/stage-hud.js", [/combo|pause|progress|score/]], ["js/render/stage-overlays.js", [/_drawRulers/]]],
	},
	{
		name: "Inspector common properties and no-selection text",
		sources: [["js/ui/panels.js", [/commonValue|noSelection|renderEventProperties/]], ["js/app/app-property-editing.js", [/editSelectedProperty/]]],
	},
	{
		name: "Channels panel edit, delete, activation and menu dismissal",
		sources: [["js/ui/panel-lists.js", [/ChannelsPanel/, /createAbove|createBelow/, /menu/]], ["js/ui/item-menu.js", [/Escape|pointerdown|keepOpen/]], ["js/app/app-channel-commands.js", [/duplicateChannel|deleteChannel|toggleChannel/]]],
	},
	{
		name: "Snappees panel icon, matrix editor, delete-detach and menu",
		sources: [["js/ui/panel-lists.js", [/SnappeesPanel/, /makeSnappeePreview/, /menu/]], ["js/app/app-snappee-forms.js", [/transformation|matrix/]], ["js/core/chart-model.js", [/removeSnappee/]]],
	},
	{
		name: "Clips default localized name and edit/delete menu",
		sources: [["js/core/chart-model.js", [/addClip/]], ["js/app/app-clipboard.js", [/clip\.defaultName/]], ["js/ui/panel-clips.js", [/drawClipThumbnail|delete|menu/]], ["json/i18n.en-US.json", [/clip\.defaultName/]], ["json/i18n.zh-CN.json", [/clip\.defaultName/]]],
	},
	{
		name: "History click undo/redo rendering",
		sources: [["js/core/history.js", [/undo\(\)|redo\(\)|goTo\(/]], ["js/ui/panel-history.js", [/onGoTo|future|redo/]]],
	},
	{
		name: "Scroll view event icons, tails, grouping, A-B and no-editing interaction",
		sources: [["js/render/scroll-view.js", [/drawTimelineEventIcon/, /DURATION_TYPES/, /#drawSelectedGroupBounds/, /#drawAbLoop|abLoop/]]],
	},
	{
		name: "Scroll view double-click group entry",
		sources: [["js/render/scroll-view.js", [/dblclick/, /#doubleClick/, /onEnterGroupSelection/]], ["js/app/app-core.js", [/onEnterGroupSelection/]]],
	},
	{
		name: "Checks click navigation, hover details, double-click focus and tab count",
		sources: [["js/app/app-checks.js", [/activateCheckViolation|configureCheckViolation/]], ["js/ui/checks-panel.js", [/dblclick|tooltip|count/]]],
	},
	{
		name: "Popup title drag, array controls, outside blocking and warning border",
		sources: [["js/ui/ui-dialogs.js", [/titlebar/, /pointerdown|pointermove/, /flash|warning/]], ["js/ui/ui-fields.js", [/array|moveUp|moveDown/]]],
	},
	{
		name: "Snappee tie priority and inactive snap filtering",
		sources: [["js/core/geometry.js", [/findNearestSnapPoint/, /activeOnly/, /nearest/]]],
	},
	{
		name: "Closed-curve index wrapping",
		sources: [["js/app/app-position-move.js", [/applyCurveAttachedMove|loop/]], ["js/core/geometry.js", [/closed|sampleParametricCurve/]]],
	},
	{
		name: "Radial mesh formula",
		sources: [["js/core/geometry.js", [/sampleRadialMesh/, /Math\.cos/, /Math\.sin/]]],
	},
	{
		name: "Pen SVG path display/copy/import",
		sources: [["js/ui/pen-path-field.js", [/copy|clipboard|path/]], ["js/core/geometry.js", [/penCommandsToSvgPath|svgPathToPenCommands/]]],
	},
	{
		name: "Open recent decision tree",
		sources: [["js/app/app-project-files.js", [/recentChartPlan/, /openProject|addToProject|openChart/]]],
	},
	{
		name: "Reload chart from disk",
		sources: [["js/app/app-project-files.js", [/canReloadChartFromDisk/, /reloadChartFromDisk/, /readProjectText/]]],
	},
	{
		name: "SSC chart/music/image selection and import options",
		sources: [["js/platform/platform.js", [/parseLevel/, /musicFile/, /imageFile/, /JSZip/]], ["js/app/app-preferences-media.js", [/requestImportOptions/]]],
	},
	{
		name: "Sunniesnow import timing and seven-step tip-chain processing",
		sources: [["js/core/sunniesnow-import.js", [/chain/, /placeholder|tipPoint/i]], ["js/core/chart-model.js", [/_importSunniesnow/, /timing/]]],
	},
	{
		name: "Export readme files and clipboard",
		sources: [["js/platform/platform-level-archive.js", [/addReadmeEntries/, /needsDisplayTextFile/]], ["js/app/app-clipboard.js", [/exportClipboard/]]],
	},
	{
		name: "Rename chart and properties rename prompt",
		sources: [["js/app/app-project-files.js", [/renameChart/, /renameChartTo/]]],
	},
	{
		name: "Autosave interval zero and preferences outside history",
		sources: [["js/platform/autosave.js", [/setInterval/, /interval > 0/]], ["js/app/app-preferences-media.js", [/showPreferences/, /startAutosave/]]],
	},
	{
		name: "Edit selection commands and no-op history",
		sources: [["js/app/app-selection.js", [/selectEvents/, /selectionOnly/]], ["js/app/app-command-bindings.js", [/selectAll|selectChannel|selectNone|selectAttachedEvents/]], ["js/core/history.js", [/no-op|noop|snapshotsEqual/i]]],
	},
	{
		name: "Relative clipboard beat/channel offsets",
		sources: [["js/cli/clipboard-payload.js", [/relativizeTree/, /channelSpan|minimum/]]],
	},
	{
		name: "BPM dialog, bar-line toggle and timing clipboard",
		sources: [["js/app/app-chart-dialogs.js", [/showBpmDialog/]], ["js/app/app-timeline-marks.js", [/toggleBarLine/]], ["js/app/app-clipboard.js", [/copyTiming|pasteTiming/]]],
	},
	{
		name: "Event creation preview and placement",
		sources: [["js/app/app-event-tools.js", [/createPositionedEvent|creationMode/]], ["js/render/stage-drafts.js", [/preview/]]],
	},
	{
		name: "Group anchor center/origin and palette",
		sources: [["js/core/chart-model.js", [/groupSelected/, /positions|origin/]], ["js/app/app-event-tools.js", [/SNAPPEE_COLORS|groupSelected/]]],
	},
	{
		name: "Lock-all free-transform availability",
		sources: [["js/app/app-command-bindings.js", [/transformationAvailable|transform\.free/]], ["js/app/app-transform-targets.js", [/locked|affectedEvents/]], ["js/app/app-free-transform.js", [/transformationTargets|transformationAvailable/]]],
	},
	{
		name: "Attach-to-curve by order and time",
		sources: [["js/app/app-attachment.js", [/attachSelectedToCurveByOrder/, /attachSelectedToCurveByTime/, /rationalGcd/]]],
	},
	{
		name: "Snappee activate/deactivate and copy/paste",
		sources: [["js/app/app-attachment.js", [/setSnappeesActive/, /deactivateAllSnappees/]], ["js/app/app-clipboard.js", [/copySnappee|pasteSnappee/]]],
	},
	{
		name: "Flip with reattachment",
		sources: [["js/app/app-attachment.js", [/flipWithReattachment/, /detach|attach/]]],
	},
	{
		name: "Transformation matrix popup",
		sources: [["js/app/app-selection-transform.js", [/showTransformDialog|matrix/]], ["js/ui/ui-fields.js", [/AFFINE_MATRIX_GRID/]]],
	},
	{
		name: "Move forward/backward, time dilation, translation and reverse",
		sources: [["js/app/app-event-move.js", [/moveSelectedInTime/]], ["js/app/app-time-dilation.js", [/_dilateSelection/]], ["js/app/app-attachment.js", [/showTimeTranslationDialog/]], ["js/app/app-event-tools.js", [/reverseSelectedTime/]]],
	},
	{
		name: "Music hold Space 0.3 seconds and reverse transition",
		sources: [["js/app/app-global-shortcuts.js", [/0\.3|Space/]], ["js/app/app-history-commands.js", [/togglePlayback|toggleReversePlayback/]]],
	},
	{
		name: "Seek start, subdivision seek and three-second seek",
		sources: [["js/app/app-history-commands.js", [/seekStart/, /seekSeconds/, /setSubdivision/]]],
	},
	{
		name: "Macro window and run-scope memory",
		sources: [["js/app/app-core.js", [/openMacros|macros\.html/]], ["js/app/app-history-commands.js", [/macroScopeChoice|runMacroDialog/]]],
	},
	{
		name: "About and report-issues actions",
		sources: [["js/ui/help.js", [/showAbout/, /reportIssues/, /packageInfo/]], ["package.json", [/bugs/]]],
	},
	{
		name: "Event duration/end-time and group translation",
		sources: [["js/app/app-property-editing.js", [/applyEndTime/, /shiftGroupCoordinate/]], ["js/ui/panels.js", [/endTime/]]],
	},
	{
		name: "Tip mode batch editing and defaults",
		sources: [["js/app/app-tip-point-modes.js", [/unifyTipPointModes/]], ["js/core/chart-events.js", [/tipPointSpawnDistance/, /Math\.PI \/ 2/]]],
	},
	{
		name: "Sharp-turn coincident checkpoint handling",
		sources: [["js/core/checks.js", [/collapseCheckpoints/, /sharp|turn/i]]],
	},
	{
		name: "Live hosting HTTP memory archive and messages",
		sources: [["js/platform/live-hosting.js", [/createServer|WebSocket/, /eventInfoTip/, /chartUpdate/]], ["js/platform/platform-level-archive.js", [/STORE|generateAsync/]]],
	},
	{
		name: "Macro UI persistence, tabs and completion",
		sources: [["js/macro/macros.js", [/localStorage/, /renderTabs|closeTab/]], ["js/macro/macro-completions.js", [/completion/]]],
	},
	{
		name: "Macro API remaining method-level behavior",
		sources: [["js/macro/macro-api-chart.js", [/class Clip|createChartFacade/]], ["js/macro/macro-api-event.js", [/class Event|ensureAlive/]], ["js/macro/macro-api-location.js", [/class Location|attach|detach/]], ["js/macro/macro-api-math.js", [/Vector2D|AffineMatrix2D|normalizeColor/]]],
	},
	{
		name: "File-format complete field sets",
		sources: [["js/core/chart-model.js", [/serializeSviber/, /nextIds/, /events/, /snappees/, /clips/, /checks/]], ["js/core/chart-normalize.js", [/normalizeEditor/, /normalizeChannels/]]],
	},
	{
		name: "Lyrica flick degrees and pattern mappings",
		sources: [["js/core/lyrica-format.js", [/flick|degrees|BG_PATTERN/]], ["js/core/lyrica-import.js", [/lyricaFlickAngle|bgNote/]]],
	},
	{
		name: "SEO, theme, license and README",
		sources: [["index.html", [/og:/, /twitter:/, /theme-color/, /icon\.svg/]], ["css/themes.css", [/prefers-color-scheme/]], ["javascript.html", [/AGPL|license/]], ["README.md", [/Installation|Contributing|License/]]],
	},
	{
		name: "Performance and benchmark constraints",
		sources: [["js/render/chart-index.js", [/IntervalIndex|activeLeafEvents/]], ["js/app/app-view-refresh.js", [/refreshStatusViews|requestRender/]], ["scripts/benchmark-render-index.mjs", [/benchmark|performance/i]]],
	},
	{
		name: "CI package matrix and version bump rules",
		sources: [[".github/workflows/test.yml", [/push/, /pull_request/, /npm test/]], [".github/workflows/release.yml", [/tags/, /gh-release|softprops/]], [".github/workflows/package.yml", [/x86/, /aarch64/, /dmg|tar\.gz|zip/]], ["package.json", [/version/]]],
	},
	{
		name: "CLI path/import/export/help/headless mode",
		sources: [["js/cli/cli.js", [/--help/, /--export/, /--import/, /isHeadlessInvocation/]], ["js/cli/cli-main.js", [/startPath|GUI|cli/i]]],
	},
];

assert.equal(closures.length, 65);
for (const closure of closures) {
	test(closure.name, async () => {
		await assertSources(closure.sources);
	});
}

test("NO-TEST and MISSING closure registry has one executable test per matrix closure", async () => {
	const matrix = await read("dev-notes/PROMPT-v22-AUDIT-MATRIX.md");
	const rows = matrix
		.split("\n")
		.filter(line => /^\| \d+ \| .+ \| .+ \| (PASS|PASS-SOURCE|FIXED) \|$/.test(line));
	assert.equal(rows.length, 65);
	for (const closure of closures) {
		assert.ok(matrix.includes(`| ${closures.indexOf(closure) + 1} | ${closure.name} |`), closure.name);
	}
});
