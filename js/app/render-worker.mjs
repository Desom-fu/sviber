// Out-of-process render worker (v0.16.10): sunniesnow-record runs here in a standalone
// Node runtime instead of inside NW.js. Its native dependencies (canvas, gl) hard-crash
// the NW.js process — NW 0.114 embeds a different Node ABI and its realm lacks
// SharedArrayBuffer, which jsdom also needs — so the whole render chain is isolated here.
//
// Protocol: argv[2] is the path to a JSON request file:
//   { kind: "video" | "cover", options: {...}, levelFile: "<path to the level archive>" }
// Stdout carries one JSON object per line:
//   {"progress": {...}}                — raw sunniesnow-record progress event
//   {"log": "..."}                     — game log line (warnings, errors, loader text)
//   {"done": true}                     — rendering finished, output written
//   {"error": "...", "details": "..."} — fatal error; the process then exits non-zero
import fs from "node:fs";

const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const send = payload => process.stdout.write(`${JSON.stringify(payload)}\n`);
// Ring of the most recent game log lines, attached to error reports for debugging.
const recentLogs = [];
const rememberLog = message => {
	recentLogs.push(message);
	if (recentLogs.length > 40) {
		recentLogs.shift();
	}
};

const { default: SunniesnowRecord } = await import("sunniesnow-record");
const Sunniesnow = SunniesnowRecord;

// The game reports failures through console.error (Sunniesnow.Logs) and then terminates,
// which would otherwise leave this worker hanging silently. Tee every console line into
// the JSON protocol and turn termination into an explicit error event.
for (const level of ["error", "warn", "info", "log"]) {
	const original = console[level].bind(console);
	console[level] = (...args) => {
		const message = args.map(item => String(item?.stack ?? item?.message ?? item)).join(" ");
		rememberLog(message);
		send({ log: message });
	};
}
const terminate = Sunniesnow.Game.prototype.terminate;
Sunniesnow.Game.prototype.terminate = function (...args) {
	// Flush the error line before exiting: writes to a pipe are asynchronous, so
	// process.exit() immediately after send() could drop the report.
	process.stdout.write(`${JSON.stringify({
		error: "Rendering aborted: the game terminated (see log for the reason).",
		details: recentLogs.join("\n"),
	})}\n`, () => process.exit(1));
};

try {
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
