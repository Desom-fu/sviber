// The fixed vocabulary of a chart document: the event type names, which capabilities each
// type carries (position, duration, text, tip points), and the metadata and editor state a
// fresh chart starts from. Split out of js/core/chart-model.js so the model, the value
// normalizers, the event factory and the Sunniesnow importer all agree on one definition.

import { SNAPPEE_TYPES } from "./geometry.js";

export const SUNNIESNOW_SCHEMA = "https://sunniesnow.github.io/schema/chart-1.0.json";

export const EVENT_TYPES = Object.freeze([
	"tap",
	"hold",
	"drag",
	"flick",
	"bgNote",
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
	"comment",
	"group",
]);

export const DIFFICULTY_COLORS = Object.freeze({
	easy: "#3eb9fd",
	normal: "#f19e56",
	hard: "#e75e74",
	master: "#8c68f3",
	special: "#f156ee",
});

export const EVENT_TYPE_SET = new Set(EVENT_TYPES);
export const SNAPPEE_TYPE_SET = new Set(SNAPPEE_TYPES);
export const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote", "group"]);
export const TIP_POINTABLE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
export const DURATION_TYPES = new Set([
	"hold",
	"bgNote",
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
	"comment",
]);
export const TEXT_TYPES = new Set(["tap", "hold", "flick", "bgNote", "bigText", "comment"]);
export const POSITIVE_DURATION_TYPES = new Set([
	"hold",
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
]);
export const TIP_SPAWN_TYPES = new Set(["inherit", "chain", "drop", "none"]);
export const POSITION_FIELDS = ["attached", "x", "y", "snappee", "snapPoint"];
export const TIP_POINT_FIELDS = [
	"tipPointSpawnType",
	"tipPointSpawnAbsolutePosition",
	"tipPointSpawnAttached",
	"tipPointSpawnX",
	"tipPointSpawnY",
	"tipPointSpawnSnappee",
	"tipPointSpawnSnapPoint",
	"tipPointSpawnDistance",
	"tipPointSpawnAngle",
	"tipPointSpawnTimeBeats",
	"tipPointSpawnTime",
];

export const DEFAULT_METADATA = Object.freeze({
	title: "Untitled",
	artist: "",
	charter: "",
	difficultyName: "Normal",
	difficultyColor: DIFFICULTY_COLORS.normal,
	difficulty: "",
	difficultySup: "",
});

export const DEFAULT_EDITOR = Object.freeze({
	timeSnapped: true,
	subdivision: 2,
	currentTime: [0, 0, 1],
	visibleRangeBeginning: 0,
	visibleRangeEnd: 10,
	speed: 1,
	lockVisibleRange: false,
	playSe: true,
	seekBackAfterPlaying: false,
	metronome: false,
	readOnly: false,
	abLoopMarks: [],
	currentChannel: 0,
	allowOutOfBound: false,
	timelineChannelOffset: 0,
	showGroupingInTimeline: true,
	showGroupingInMainField: true,
	showTipPoints: true,
	showBgEventsInTimeline: true,
	showBgEventsInMainField: true,
	showHud: true,
	showRulers: false,
	showChartBoundary: true,
	playBgNoteSe: false,
	mainFieldPanX: 0,
	mainFieldPanY: 0,
	mainFieldZoom: 1,
});
