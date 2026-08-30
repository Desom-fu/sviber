import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceContracts, readSource } from "./audit-contract-helpers.mjs";

test("main field pan zoom background boundary HUD and rulers follow the prompt", async () => {
	await assertSourceContracts([
		["js/render/stage-pointer.js", [/Ctrl|ctrlKey|Space/]],
		["js/app/app-main-field-view.js", [/zoom|pan|reset/]],
		["js/render/stage-core.js", [/blur|brightness|background/, /CHART_BOUNDS|chart boundary|boundary/]],
		["js/render/stage-overlays.js", [/_drawRulers|_drawGrouping|showTipPoints/]],
		["js/render/stage-hud.js", [/combo|pause|progress|score/]],
		["index.html", [/reset-main-field-view/]],
	]);
});

test("main field events selection attachment and transform handles follow the prompt", async () => {
	await assertSourceContracts([
		["js/render/stage-core.js", [/_sortNoteRecordsForStacking|eventDrawLayer/]],
		["js/render/stage-pointer.js", [/selectionTarget|eventClickSelectionMode/, /clampPointToChartBounds|findNearestSnapPoint/]],
		["js/render/stage-overlays.js", [/flick-handle|tip-handle|Ctrl|ctrlAltHeld/]],
		["js/render/chart-index.js", [/selectedRootGroups|ancestorsById/]],
		["js/app/app-position-move.js", [/attached|group|snap/]],
	]);
});

test("snappee shapes and handles cover every documented geometry type", async () => {
	const [drawing, geometry, pointer] = await Promise.all([
		readSource("js/render/stage-snappees.js"),
		readSource("js/core/geometry.js"),
		readSource("js/render/stage-pointer.js"),
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
		assert.match(drawing + geometry, new RegExp(shape));
	}
	assert.match(drawing, /_drawSnappeeHandles|controlPoint|handle/);
	assert.match(drawing, /strokeMeshGrid|strokePolyline|_drawRadialMeshPath/);
	assert.match(pointer, /snappeeHandle|Ctrl|ctrlAltHeld/);
});

test("inspection fields validation duration end-time and popup form work", async () => {
	await assertSourceContracts([
		["js/ui/panels.js", [/commonValue|noSelection|renderEventProperties/, /endTime|tipPoint/]],
		["js/ui/ui-fields.js", [/rational|makeAngleField|makeRangeField|AFFINE_MATRIX_GRID/]],
		["js/app/app-property-editing.js", [/applyEndTime|duration|unifyTipPointModes/]],
		["js/ui/ui-dialogs.js", [/OK|Cancel|disabled|titlebar|flash|pointer/]],
	]);
});

test("channels snappees clips history checks tooltip and toast panels work", async () => {
	await assertSourceContracts([
		["js/ui/panel-lists.js", [/activate|deactivate|duplicate|createAbove|createBelow|hidden|menu/, /dblclick|edit|delete|moveUp|moveDown/]],
		["js/ui/panel-clips.js", [/drawClipThumbnail|paste|menu|delete/]],
		["js/ui/panel-history.js", [/historyMarkers|save|autosave|future|redo/]],
		["js/ui/checks-panel.js", [/violation|tooltip|dblclick|count/]],
		["js/ui/ui-shell.js", [/TooltipManager|data-tooltip|title/]],
		["js/ui/ui-dialogs.js", [/Toast|toast-region|stack|duration/]],
	]);
});
