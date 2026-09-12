import assert from "node:assert/strict";
import test from "node:test";

import { parseLyrics } from "../js/core/lyrics-import.js";

test("lyrics import strips surrounding whitespace only", () => {
	const vtt = `WEBVTT

1
00:00:12.340 --> 00:00:16.780
<00:00:12.340>Never <00:00:12.800>gonna <00:00:13.200>give
`;
	const { cues } = parseLyrics("song.vtt", vtt);
	assert.deepEqual(
		cues[0].taps.map(tap => tap.text),
		["Never", "gonna", "give"],
	);
	const spaced = parseLyrics(
		"song.vtt",
		`WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<00:00:01.000>keep  inner\n`,
	);
	assert.equal(spaced.cues[0].taps[0].text, "keep  inner");
});
