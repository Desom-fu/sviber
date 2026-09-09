// Out-of-process render worker (v0.16.10): sunniesnow-record runs here in a standalone
// Node runtime instead of inside NW.js. Its native dependencies (canvas, gl) hard-crash
// the NW.js process — NW 0.114 embeds a different Node ABI and its realm lacks
// SharedArrayBuffer, which jsdom also needs — so the whole render chain is isolated here.
//
// Protocol: argv[2] is the path to a JSON request file:
//   { kind: "video" | "cover", options: {...}, levelFile: "<path to the level archive>" }
// Stdout carries one JSON object per line:
//   {"progress": {...}}                — raw sunniesnow-record progress event
//   {"done": true}                     — rendering finished, output written
//   {"error": "...", "details": "..."} — fatal error; the process then exits non-zero
import fs from "node:fs";

const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const send = payload => process.stdout.write(`${JSON.stringify(payload)}\n`);
try {
	const { default: SunniesnowRecord } = await import("sunniesnow-record");
	const runner = request.kind === "video" ? SunniesnowRecord.Record : SunniesnowRecord.CoverGen;
	// Record and CoverGen convert string option values through toBlob, which reads file
	// paths from disk — so the level archive is handed over as a plain path.
	const options = { ...request.options, levelFileUpload: request.levelFile };
	// CoverGen.run takes no progress callback; only the video renderer reports progress.
	await runner.run(options, request.kind === "video" ? progress => send({ progress }) : undefined);
	send({ done: true });
} catch (error) {
	send({
		error: String(error?.message ?? error),
		details: error?.stack ? String(error.stack) : "",
		stderr: typeof error?.stderr === "string" ? error.stderr : undefined,
		stdout: Array.isArray(error?.stdout) ? error.stdout : undefined,
	});
	process.exitCode = 1;
}
