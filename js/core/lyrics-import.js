// Parsing of lyrics/subtitle files (LRC, SRT, WebVTT, ASS) for the
// "Import lyrics/subtitle file..." feature of PROMPT-v25.
//
// A cue line that carries in-line timestamps (LRC A2 word timestamps, WebVTT timestamp
// objects, ASS `\k` tags) imports as a line of `tap` events; a cue line without them
// imports as one `bigText` event spanning the cue. All times are seconds; the caller
// applies the offset and quantization.

// Strips punctuation-only noise? No — keep texts verbatim; only trim the edges.
function cleanText(text) {
	return String(text ?? "").replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, "");
}

function stripBracketTags(text) {
	return cleanText(String(text ?? "").replace(/<[^>]*>/g, ""));
}

// Parses "mm:ss.xx", "mm:ss.xxx", "hh:mm:ss.xx" and friends into seconds.
function parseTimestamp(text) {
	const match = /(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:[.,]\d{1,3}))/.exec(String(text ?? ""));
	if (!match) {
		return null;
	}
	const hours = Number(match[1] || 0);
	const minutes = Number(match[2] || 0);
	const seconds = Number(String(match[3]).replace(",", "."));
	return hours * 3600 + minutes * 60 + seconds;
}

// LRC: `[mm:ss.xx]` cue headers (possibly several per line) plus optional A2 word
// timestamps `<mm:ss.xx>` inside the line.
function parseLrc(text) {
	const cues = [];
	for (const rawLine of String(text ?? "").split(/\r?\n/)) {
		const headers = [...rawLine.matchAll(/\[(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
		if (!headers.length) {
			continue;
		}
		const content = rawLine.replace(/\[(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/g, "").trim();
		const words = [...content.matchAll(/<(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)>([^<]*)/g)];
		const cueStart = parseTimestamp(headers[0][1]);
		if (words.length) {
			const taps = [];
			for (let index = 0; index < words.length; index += 1) {
				const time = parseTimestamp(words[index][1]);
				const word = cleanText(words[index][2]);
				if (time != null && word) {
					taps.push({ time, text: word });
				}
			}
			if (taps.length) {
				cues.push({ kind: "taps", taps });
				continue;
			}
		}
		const line = stripBracketTags(content);
		if (cueStart == null || !line) {
			continue;
		}
		cues.push({ kind: "bigText", time: cueStart, endTime: null, text: line });
	}
	return { cues };
}

// SRT: `index \r?\n hh:mm:ss,mmm --> hh:mm:ss,mmm \r?\n text lines`.
function parseSrt(text) {
	return parseCueBlocks(String(text ?? "").split(/\r?\n\s*\r?\n/), cue =>
		parseCueBlock(cue, "-->"),
	);
}

// WebVTT: same cue block shape as SRT plus `<mm:ss.mmm>` timestamp objects in the text.
function parseWebVtt(text) {
	const body = String(text ?? "").replace(/^WEBVTT[^\n]*\n/, "");
	return parseCueBlocks(body.split(/\r?\n\s*\r?\n/), cue => parseCueBlock(cue, "-->"));
}

function parseCueBlocks(blocks, parseOne) {
	const cues = [];
	for (const block of blocks) {
		const cue = parseOne(block);
		if (cue) {
			cues.push(cue);
		}
	}
	return { cues };
}

function parseCueBlock(block, arrow) {
	const lines = block.split(/\r?\n/).filter(line => line.trim() !== "");
	if (!lines.length) {
		return null;
	}
	let textLines = lines;
	const timingLine = lines.find(line => line.includes(arrow));
	if (!timingLine) {
		return null;
	}
	const [rawStart, rawEnd] = timingLine.split(arrow);
	const time = parseTimestamp(rawStart);
	const endTime = parseTimestamp(rawEnd);
	if (time == null) {
		return null;
	}
	textLines = lines.slice(lines.indexOf(timingLine) + 1);
	// Cue identifiers (a lone block number) are skipped by taking the lines after the arrow.
	const inline = [...textLines.join("\n").matchAll(/<((?:\d{1,3}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)>([^<]*)/g)];
	if (inline.length) {
		const taps = [];
		for (const match of inline) {
			const wordTime = parseTimestamp(match[1]);
			const word = cleanText(match[2]);
			if (wordTime != null && word) {
				taps.push({ time: wordTime, text: word });
			}
		}
		if (taps.length) {
			return { kind: "taps", taps };
		}
	}
	const line = stripBracketTags(textLines.join(" "));
	if (!line) {
		return null;
	}
	return { kind: "bigText", time, endTime, text: line };
}

// ASS dialogue lines: `Dialogue: 0,0:00:12.34,0:00:16.78,Style,,0,0,0,,text` with
// karaoke `\k` duration tags (centiseconds) marking word times inside the line.
function parseAss(text) {
	const cues = [];
	for (const line of String(text ?? "").split(/\r?\n/)) {
		if (!line.startsWith("Dialogue:")) {
			continue;
		}
		const fields = line.slice("Dialogue:".length).split(",");
		if (fields.length < 10) {
			continue;
		}
		const time = parseTimestamp(fields[1]);
		const endTime = parseTimestamp(fields[2]);
		const content = fields.slice(9).join(",").replace(/\{[^}]*\}/g, tag => tag);
		const karaoke = [...content.matchAll(/\{\\k(?:f)?(\d+)\}([^{}]*)/g)];
		if (karaoke.length) {
			const taps = [];
			let cursor = time ?? 0;
			for (const match of karaoke) {
				const word = cleanText(match[2]);
				const duration = Number(match[1]) / 100;
				if (word) {
					taps.push({ time: cursor, text: word });
				}
				cursor += duration;
			}
			if (taps.length) {
				cues.push({ kind: "taps", taps });
				continue;
			}
		}
		const plain = stripBracketTags(content.replace(/\{[^}]*\}/g, ""));
		if (!plain || time == null) {
			continue;
		}
		cues.push({ kind: "bigText", time, endTime, text: plain });
	}
	return { cues };
}

export function detectLyricsFormat(filename, text) {
	const name = String(filename ?? "").toLowerCase();
	if (name.endsWith(".lrc")) {
		return "lrc";
	}
	if (name.endsWith(".srt")) {
		return "srt";
	}
	if (name.endsWith(".vtt") || name.endsWith(".webvtt")) {
		return "vtt";
	}
	if (name.endsWith(".ass") || name.endsWith(".ssa")) {
		return "ass";
	}
	if (/^\uFEFF?WEBVTT/m.test(String(text ?? ""))) {
		return "vtt";
	}
	if (/^Dialogue:/m.test(String(text ?? ""))) {
		return "ass";
	}
	if (/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(String(text ?? ""))) {
		return "lrc";
	}
	return "srt";
}

export function parseLyrics(filename, text) {
	const format = detectLyricsFormat(filename, text);
	const parsers = { lrc: parseLrc, srt: parseSrt, vtt: parseWebVtt, ass: parseAss };
	return { format, ...parsers[format](text) };
}

// Places the parsed cues on the playfield following PROMPT-v25: the $i$th line of tap
// events sits at y = (-1)^i * 12.5, and the $j$th tap of an $n$-tap line sits at
// x = (-(n-1)/2 + j) * 25 for n <= 9, or (-4 + 8j/(n-1)) * 25 for n > 9.
// Times are returned in seconds with `offset` added; the caller quantizes to beats.
export function placeLyricsCues(parsed, { offset = 0 } = {}) {
	const events = [];
	let lineIndex = 0;
	for (const cue of parsed.cues) {
		if (cue.kind === "taps") {
			const n = cue.taps.length;
			const y = (lineIndex % 2 === 0 ? 1 : -1) * 12.5;
			cue.taps.forEach((tap, index) => {
				const x = n <= 9 ? (-(n - 1) / 2 + index) * 25 : (-4 + (8 * index) / (n - 1)) * 25;
				events.push({
					type: "tap",
					time: tap.time + offset,
					x,
					y,
					text: tap.text,
				});
			});
			lineIndex += 1;
			continue;
		}
		events.push({
			type: "bigText",
			time: cue.time + offset,
			endTime: cue.endTime == null ? null : cue.endTime + offset,
			text: cue.text,
		});
	}
	return events;
}
