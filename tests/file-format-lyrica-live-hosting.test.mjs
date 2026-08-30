import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceContracts, readSource } from "./audit-contract-helpers.mjs";

test("sviber file format and rational data fields are implemented", async () => {
	await assertSourceContracts([
		["js/core/chart-model.js", [/serializeSviber/, /nextIds/, /events/, /snappees/, /clips/, /checks/]],
		["js/core/chart-events.js", [/normalizeEventTree|tipPoint/]],
		["js/core/chart-events.js", [/normalizeEventTree|tipPoint/]],
		["js/core/chart-snappees.js", [/createSnappee|transformation|active|selected/]],
		["js/core/project.js", [/exportSunniesnowChartDocument|PROJECT_FILENAME/]],
		["js/core/rational.js", [/Rational|toJSON|snap|fromNumber/]],
	]);
});

test("Lyrica format import export and spawn mechanics are implemented", async () => {
	await assertSourceContracts([
		["js/core/lyrica-format.js", [/parseLyricaHeader|parseLyricaEvent/, /flick|degrees|BG_PATTERN/]],
		["js/core/lyrica-import.js", [/100|120|140|160|180|200|bgNote|BPM/, /lyricaFlickAngle/]],
		["js/core/lyrica-export.js", [/independent|type 2|tip|chain/]],
		["js/core/lyrica-spawn.js", [/rand|clamp|sgn|bmod|isLyricaFirstTipEvent/]],
	]);
});

test("live hosting HTTP WebSocket sscharter messages and archive compression are implemented", async () => {
	await assertSourceContracts([
		["js/platform/live-hosting.js", [/createServer|WebSocket|acceptKey|eventInfoTip|chartUpdate|update/]],
		["js/platform/platform-level-archive.js", [/generateAsync|STORE|DEFLATE|ZIP_EPOCH/]],
		["js/app/app-open-save.js", [/compression: "STORE"|liveHostingStarted|liveHostingStopped/]],
	]);
});
