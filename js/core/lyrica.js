// Lyrica chart conversion, composed from three modules that each own one concern:
//
//   ./lyrica-format.js - the file format: channel layout, code tables, text <-> record
//   ./lyrica-spawn.js  - the spawn model: seeded generator, the `b` code table, chain starts
//   ./lyrica-import.js - Lyrica text -> sviber chart state
//   ./lyrica-export.js - sviber chart state -> Lyrica text
//
// This module is the public entry point: everything the editor, the CLI and the tests used to
// import from `js/core/lyrica.js` is still exported here, so importers need no changes.

export {
	LYRICA_BG_NOTE_CHANNELS,
	LYRICA_BG_PATTERN_CHANNEL,
	LYRICA_BG_PATTERN_CODES,
	LYRICA_BG_PATTERN_TEXT,
	LYRICA_BPM_CHANNEL,
	LYRICA_CHANNEL_ORDER,
	LYRICA_DISABLED_CHANNELS,
	LYRICA_FAST_SPAWN,
	LYRICA_INACTIVE_IMPORT_CHANNELS,
	LYRICA_INDEPENDENT_CHANNEL,
	LYRICA_MAIN_CHANNEL,
	LYRICA_MAX_GAP,
	LYRICA_MULTI_TIP_CHANNELS,
	LYRICA_NORMAL_CHANNELS,
	LYRICA_NO_TIP_CHANNELS,
	LYRICA_SLOW_SPAWN,
	LYRICA_TABLE_B,
	decodeTipPointCodes,
	isLyricaChartText,
	lyricaChannelCategory,
	lyricaChannelName,
	lyricaFlickAngleToSviber,
	parseLyricaChart,
	parseLyricaEvent,
	parseLyricaHeader,
	serializeLyricaChart,
	sviberFlickAngleToLyrica,
} from "./lyrica-format.js";

export {
	chooseClosestNonRandomSpawn,
	createLyricaRng,
	deterministicSpawnCandidates,
	evaluateLyricaSpawn,
	isLyricaFirstTipEvent,
} from "./lyrica-spawn.js";

export { importLyricaChart, interpretLyricaEvent } from "./lyrica-import.js";

export { assignLyricaExportChannels, exportLyricaChart, resolveSviberTipChains } from "./lyrica-export.js";
