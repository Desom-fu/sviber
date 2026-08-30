import test from "node:test";
import { assertSourceContracts, readSource } from "./audit-contract-helpers.mjs";

test("snappee snapping defaults and geometry formulas follow the prompt", async () => {
	await assertSourceContracts([
		["js/core/geometry.js", [/SNAP_BOUNDARY_EPSILON|findNearestSnapPoint|activeOnly/, /sampleRadialMesh|Math\.cos|Math\.sin/]],
		["js/core/chart-model.js", [/createDefaultSnappees|horizontalTiles|verticalTiles/]],
		["js/core/snappee-presets.js", [/playfieldGrid|turntable|hexagon|pentagon/]],
		["js/app/app-snappee-forms.js", [/segments|transformation|svgPath|clipboard|uniqueSnappeeName/]],
	]);
});

test("curve drafting creates and closes Bezier, arc, and pen snappees", async () => {
	await assertSourceContracts([
		["js/app/app-curve-draft.js", [/bezier|circularArc|pen|segments|closed/, /Enter|dblclick|Escape/]],
		["js/render/stage-drafts.js", [/control|preview/]],
		["js/ui/pen-path-field.js", [/copy|clipboard|path/]],
		["js/core/geometry.js", [/penCommandsToSvgPath|svgPathToPenCommands/]],
	]);
});

test("snappee attachment commands cover activation, curve order/time and reattachment", async () => {
	await assertSourceContracts([
		["js/app/app-attachment.js", [/setSnappeesActive|deactivateAllSnappees/, /attachSelectedToCurveByOrder|attachSelectedToCurveByTime|rationalGcd/, /flipWithReattachment/]],
		["js/app/app-snappee-attach.js", [/attachSelected|detachSelected/]],
		["js/app/app-clipboard.js", [/copySnappee|pasteSnappee/]],
	]);
});
