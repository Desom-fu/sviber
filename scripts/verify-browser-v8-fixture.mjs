// Chart fixture installed by the v8 browser checks: four channels (one inactive), holds with
// unaligned ends, comments on active and inactive channels, and one deactivated snappee.
// Keeping the data here lets verify-browser-v8.mjs stay a list of checks.

const timing = { offset: 0, initialBpm: 60, bpmChanges: [] };

const channels = [
	{ id: 10, name: "Lead", active: true },
	{ id: 20, name: "Muted", active: false },
	{ id: 30, name: "FX", active: true },
	{ id: 40, name: "Spare", active: true },
];

const events = [
	{
		id: 101,
		type: "hold",
		time: [0, 0, 1],
		duration: [2, 0, 1],
		channel: 10,
		selected: true,
		attached: false,
		x: -24,
		y: 0,
		tipPointSpawnType: "chain",
		tipPointSpawnAbsolutePosition: false,
		tipPointSpawnDistance: 40,
		tipPointSpawnAngle: Math.PI / 3,
	},
	{
		id: 102,
		type: "hold",
		time: [1, 0, 1],
		duration: [2, 0, 1],
		channel: 10,
		selected: true,
		attached: false,
		x: 24,
		y: 0,
	},
	{ id: 103, type: "tap", time: [1, 0, 1], channel: 20, selected: false, attached: false, x: 0, y: 20 },
	{
		id: 104,
		type: "comment",
		time: [0, 0, 1],
		duration: [4, 0, 1],
		channel: 10,
		selected: false,
		text: "active comment",
	},
	{
		id: 105,
		type: "comment",
		time: [0, 0, 1],
		duration: [4, 0, 1],
		channel: 20,
		selected: false,
		text: "inactive comment",
	},
	{
		id: 106,
		type: "hold",
		time: [0, 0, 1],
		duration: [4, 0, 1],
		channel: 30,
		selected: false,
		attached: false,
		x: 0,
		y: 0,
	},
	{ id: 107, type: "tap", time: [1, 1, 2], channel: 30, selected: false, attached: false, x: 48, y: 0 },
];

const snappees = [
	{
		id: 70,
		type: "rectangularMesh",
		name: "Inactive grid",
		color: "#50a226",
		active: false,
		selected: false,
		transformation: [1, 0, 0, 1, 0, 0],
		topLeftX: -100,
		topLeftY: 50,
		bottomRightX: 100,
		bottomRightY: -50,
		horizontalTiles: 16,
		verticalTiles: 8,
	},
];

const editor = {
	currentChannel: 10,
	currentTime: [1, 0, 1],
	timeSnapped: true,
	subdivision: 2,
	visibleRangeBeginning: 0,
	visibleRangeEnd: 4,
};

export const V8_FIXTURE = {
	timing,
	channels,
	events,
	snappees,
	nextIds: { channel: 50, event: 108, snappee: 71 },
	editor,
};
