// The Lyrica chart file format itself: the fixed channel layout, the code tables, and the
// pure text-to-record and record-to-text conversions. A Lyrica chart is one header line of
// `|`-separated fields followed by four `#1`..`#4` sections of comma-separated event rows,
// and the channel a row sits on decides how it is interpreted.
//
// Nothing in this module knows about sviber's chart model; the translation lives in
// ./lyrica-import.js and ./lyrica-export.js. Split out of js/core/lyrica.js.

export const LYRICA_MAIN_CHANNEL = -60;
export const LYRICA_INDEPENDENT_CHANNEL = 20;
export const LYRICA_NO_TIP_CHANNELS = Object.freeze([-100, -80]);
export const LYRICA_NORMAL_CHANNELS = Object.freeze([-40, -20, 0]);
export const LYRICA_MULTI_TIP_CHANNELS = Object.freeze([-60, -40, -20, 0]);
export const LYRICA_BG_PATTERN_CHANNEL = 40;
export const LYRICA_BG_NOTE_CHANNELS = Object.freeze([60, 80, 100]);
export const LYRICA_DISABLED_CHANNELS = Object.freeze([120, 140, 160, 180]);
export const LYRICA_INACTIVE_IMPORT_CHANNELS = Object.freeze([100, 120, 140, 160, 180]);
export const LYRICA_BPM_CHANNEL = 200;
export const LYRICA_SLOW_SPAWN = 1.5;
export const LYRICA_FAST_SPAWN = 1;
export const LYRICA_MAX_GAP = 2;
export const LYRICA_TABLE_B = Object.freeze([0, 1, 2, 3, 4, 5, 6, 20, 21, 22, 23, 24, 25, 26, 27]);

export const LYRICA_CHANNEL_ORDER = Object.freeze([
	-100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
]);

export const LYRICA_BG_PATTERN_TEXT = Object.freeze({
	a1: "grid",
	a2: "hexagon",
	a3: "checkerboard",
	a4: "diamondGrid",
	a5: "pentagon",
	a6: "turntable",
	a7: "hexagram",
});

export const LYRICA_BG_PATTERN_CODES = Object.freeze({
	grid: "a1",
	hexagon: "a2",
	checkerboard: "a3",
	diamondGrid: "a4",
	pentagon: "a5",
	turntable: "a6",
	hexagram: "a7",
});

// The spawn codes the format actually defines; anything else falls back to code 0.
export const COVERED_SPAWN_CODES = new Set(LYRICA_TABLE_B);

export function lyricaChannelCategory(channel) {
	const id = Number(channel);
	if (LYRICA_NO_TIP_CHANNELS.includes(id)) {
		return "noTip";
	}
	if (id === LYRICA_MAIN_CHANNEL) {
		return "main";
	}
	if (LYRICA_NORMAL_CHANNELS.includes(id)) {
		return "normal";
	}
	if (id === LYRICA_INDEPENDENT_CHANNEL) {
		return "independent";
	}
	if (id === LYRICA_BG_PATTERN_CHANNEL) {
		return "bgPattern";
	}
	if (LYRICA_BG_NOTE_CHANNELS.includes(id)) {
		return "bgNote";
	}
	if (LYRICA_DISABLED_CHANNELS.includes(id)) {
		return "disabled";
	}
	if (id === LYRICA_BPM_CHANNEL) {
		return "bpm";
	}
	return "unknown";
}

export function lyricaChannelName(channel) {
	return String(Number(channel));
}

// Older charts pack the trail-ending flag into the spawn code instead of a separate field,
// so when the ending column is missing the two values are split back apart.
export function decodeTipPointCodes(spawning, ending) {
	let b = Number(spawning) || 0;
	let c = ending == null || ending === "" ? null : Number(ending);
	if (!Number.isFinite(c)) {
		const bPrime = (((b % 10) + 10) % 10) + 20 * Math.floor(b / 20);
		const cPrime = Math.floor((((b % 20) + 20) % 20) / 10);
		b = bPrime;
		c = cPrime;
	}
	if (!COVERED_SPAWN_CODES.has(b)) {
		b = 0;
	}
	return { b, c: Number(c) || 0 };
}

export function lyricaFlickAngleToSviber(degrees) {
	return Math.PI / 2 - (Number(degrees || 0) / 180) * Math.PI;
}

export function sviberFlickAngleToLyrica(radians) {
	return 90 - (Number(radians || 0) * 180) / Math.PI;
}

export function isLyricaChartText(text) {
	const first = String(text || "")
		.split(/\r?\n/)
		.find(line => line.trim());
	if (!first || first.includes("{")) {
		return false;
	}
	const fields = first.split("|");
	return fields.length >= 4 && Number.isFinite(Number(fields[0]));
}

function parseArgument(raw) {
	const parts = String(raw ?? "0")
		.split("_")
		.map(part => Number(part));
	return { arg: Number.isFinite(parts[0]) ? parts[0] : 0, arg2: Number.isFinite(parts[1]) ? parts[1] : null };
}

export function parseLyricaEvent(raw) {
	const fields = String(raw || "").split("|");
	if (fields.length < 8) {
		return null;
	}
	const time = Number(fields[0]);
	const channel = Number(fields[1]);
	const x = Number(fields[2]);
	const y = Number(fields[3]);
	const type = Number(fields[4]);
	if (![time, channel, x, y, type].every(Number.isFinite)) {
		return null;
	}
	const argument = parseArgument(fields[5]);
	const endingMissing = fields[8] == null || fields[8] === "";
	const codes = decodeTipPointCodes(fields[7], endingMissing ? null : fields[8]);
	return {
		time,
		channel,
		x,
		y,
		type,
		arg: argument.arg,
		arg2: argument.arg2,
		text: fields[6] ?? "",
		b: codes.b,
		c: codes.c,
		anomalous: fields[9] == null || fields[9] === "" ? null : Number(fields[9]),
		raw,
	};
}

export function parseLyricaHeader(line) {
	const fields = String(line || "").split("|");
	return {
		initialBpm: Number(fields[0]) || 120,
		title: fields[1] ?? "",
		artist: fields[2] ?? "",
		offset: Number(fields[3]) || 0,
		timeSignature: fields[4] == null || fields[4] === "" ? null : Number(fields[4]),
		bpmCheckMode: fields[5] == null || fields[5] === "" ? null : Number(fields[5]),
	};
}

export function parseLyricaChart(text) {
	const lines = String(text || "")
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/);
	const header = parseLyricaHeader(lines[0] || "");
	const buckets = { 1: "", 2: "", 3: "", 4: "" };
	let current = 0;
	for (const line of lines.slice(1)) {
		const marker = /^#([1-4])\s*$/.exec(line.trim());
		if (marker) {
			current = Number(marker[1]);
			continue;
		}
		if (current) {
			buckets[current] += (buckets[current] ? "," : "") + line;
		}
	}
	const events = [];
	for (const key of [1, 2, 3, 4]) {
		for (const item of buckets[key].split(",")) {
			const trimmed = item.trim();
			if (!trimmed) {
				continue;
			}
			const event = parseLyricaEvent(trimmed);
			if (event) {
				events.push(event);
			}
		}
	}
	return { header, events };
}

function formatNumber(value) {
	if (!Number.isFinite(value)) {
		return "0";
	}
	const text = value.toFixed(7).replace(/\.?0+$/, "");
	return text === "-0" ? "0" : text;
}

function formatEvent(event) {
	const argument = event.arg2 == null ? formatNumber(event.arg) : `${formatNumber(event.arg)}_${event.arg2}`;
	return [
		formatNumber(event.time),
		String(event.channel),
		formatNumber(event.x),
		formatNumber(event.y),
		String(event.type),
		argument,
		event.text ?? "",
		String(event.b ?? 0),
		String(event.c ?? 0),
	].join("|");
}

// Which `#1`..`#4` section a channel's rows belong to.
function bucketFor(channel) {
	if (channel <= 20) {
		return 1;
	}
	if (channel <= 100) {
		return 2;
	}
	if (channel <= 180) {
		return 3;
	}
	return 4;
}

export function serializeLyricaChart(header, events) {
	const buckets = { 1: [], 2: [], 3: [], 4: [] };
	for (const event of events) {
		buckets[bucketFor(event.channel)].push(event);
	}
	const lines = [
		[
			formatNumber(header.initialBpm),
			header.title ?? "",
			header.artist ?? "",
			formatNumber(header.offset),
			"4",
			"0",
		].join("|"),
	];
	for (const index of [1, 2, 3, 4]) {
		lines.push(`#${index}`);
		lines.push(buckets[index].map(formatEvent).join(","));
	}
	return `${lines.join("\n")}\n`;
}
