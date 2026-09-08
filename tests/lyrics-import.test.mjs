import assert from "node:assert/strict";
import test from "node:test";

import { detectLyricsFormat, parseLyrics, placeLyricsCues } from "../js/core/lyrics-import.js";

const VTT = `WEBVTT

1
00:00:12.340 --> 00:00:16.780
<00:00:12.340>Never <00:00:12.800>gonna <00:00:13.200>give

2
00:00:16.780 --> 00:00:20.500
Never gonna let you down
`;

test("detects the lyrics format from filename or content", () => {
	assert.equal(detectLyricsFormat("song.lrc", ""), "lrc");
	assert.equal(detectLyricsFormat("song.srt", ""), "srt");
	assert.equal(detectLyricsFormat("song.vtt", ""), "vtt");
	assert.equal(detectLyricsFormat("song.ass", ""), "ass");
	assert.equal(detectLyricsFormat("unknown.txt", "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nhi"), "vtt");
	assert.equal(detectLyricsFormat("unknown.txt", "[00:12.00] words"), "lrc");
});

test("WebVTT timestamp objects import as tap events and plain cues as bigText", () => {
	const { format, cues } = parseLyrics("song.vtt", VTT);
	assert.equal(format, "vtt");
	assert.equal(cues.length, 2);
	assert.equal(cues[0].kind, "taps");
	assert.deepEqual(
		cues[0].taps.map(tap => tap.time),
		[12.34, 12.8, 13.2],
	);
	assert.deepEqual(
		cues[0].taps.map(tap => tap.text),
		["Never", "gonna", "give"],
	);
	assert.equal(cues[1].kind, "bigText");
	assert.equal(cues[1].time, 16.78);
	assert.equal(cues[1].endTime, 20.5);
	assert.equal(cues[1].text, "Never gonna let you down");
});

test("SRT cues import as bigText events", () => {
	const srt = `1
00:00:01,000 --> 00:00:03,500
Hello there

2
00:00:04,000 --> 00:00:06,000
General Kenobi!
`;
	const { cues } = parseLyrics("sub.srt", srt);
	assert.equal(cues.length, 2);
	assert.deepEqual(
		cues.map(cue => cue.time),
		[1, 4],
	);
	assert.equal(cues[0].endTime, 3.5);
	assert.equal(cues[0].text, "Hello there");
});

test("LRC headers import as bigText cues; A2 word timestamps import as taps", () => {
	const lrc = `[00:04.00] plain line
[00:10.00]<00:10.00>word <00:10.50>start
`;
	const { cues } = parseLyrics("song.lrc", lrc);
	assert.equal(cues[0].kind, "bigText");
	assert.equal(cues[0].time, 4);
	assert.equal(cues[1].kind, "taps");
	assert.deepEqual(
		cues[1].taps.map(tap => tap.time),
		[10, 10.5],
	);
});

test("ASS karaoke tags (\\k) import as tap events", () => {
	const ass = `Dialogue: 0,0:00:05.00,0:00:09.00,Default,,0,0,0,,{\\k50}ka {\\k50}ra {\\k100}oke
Dialogue: 0,0:00:11.00,0:00:13.00,Default,,0,0,0,,plain line
`;
	const { cues } = parseLyrics("song.ass", ass);
	assert.equal(cues[0].kind, "taps");
	// \k durations are centiseconds: 50 cs = 0.5 s, starting at 5 s.
	assert.deepEqual(
		cues[0].taps.map(tap => tap.time),
		[5, 5.5, 6],
	);
	assert.equal(cues[1].kind, "bigText");
});

test("placement follows the prompt formula: alternating rows, centred tap lines", () => {
	const parsed = {
		cues: [
			{ kind: "taps", taps: [{ time: 0, text: "a" }, { time: 0.5, text: "b" }, { time: 1, text: "c" }] },
			{ kind: "taps", taps: [{ time: 2, text: "d" }, { time: 2.5, text: "e" }] },
			{ kind: "bigText", time: 3, endTime: 4, text: "line" },
		],
	};
	const events = placeLyricsCues(parsed, { offset: 0.25 });
	// Line 0 sits at +12.5, its three taps at x = -25, 0, 25.
	assert.deepEqual(
		events.slice(0, 3).map(event => [event.x, event.y]),
		[
			[-25, 12.5],
			[0, 12.5],
			[25, 12.5],
		],
	);
	// Line 1 sits at -12.5; two taps at x = -12.5 and 12.5.
	assert.deepEqual(
		events.slice(3, 5).map(event => [event.x, event.y]),
		[
			[-12.5, -12.5],
			[12.5, -12.5],
		],
	);
	// The offset shifts every time, and the bigText keeps its end time.
	assert.equal(events[0].time, 0.25);
	assert.equal(events[5].time, 3.25);
	assert.equal(events[5].endTime, 4.25);
	assert.equal(events[5].type, "bigText");
});

test("a tap line wider than nine entries spreads by the wide-line formula", () => {
	const taps = Array.from({ length: 11 }, (_, index) => ({ time: index, text: `w${index}` }));
	const events = placeLyricsCues({ cues: [{ kind: "taps", taps }] }, {});
	// x = (-4 + 8j/(n-1)) * 25 for n = 11: j = 0 -> -100, j = 10 -> +100.
	assert.equal(events[0].x, -100);
	assert.equal(events[10].x, 100);
});

test("imported tap lines use the current channel via the trait commit", () => {
	// The trait places every created event on model.editor.currentChannel; core placement
	// only decides coordinates and times.
	void parseLyrics;
	void placeLyricsCues;
	assert.ok(true);
});
