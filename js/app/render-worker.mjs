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
import os from "node:os";
import path from "node:path";

const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const send = payload => process.stdout.write(`${JSON.stringify(payload)}\n`);

// Give sunniesnow-record a stable font/assets directory (it defaults to os.tmpdir())
// so fonts downloaded for one render are reused by the next one.
request.options.assetsDir ||= path.join(os.tmpdir(), "sviber-render-fonts");

// Windows font fix (v0.16.14): with the default pango-win32 backend, node-canvas's
// registerFont() is a silent no-op for font resolution, so every game font fell back
// to Sans in rendered videos. Forcing the fontconfig backend with a generated config
// that also scans the assets directory makes the bundled/downloaded fonts resolvable
// by their internal family names — which is exactly what the game requests.
// v0.16.16: the env vars themselves MUST be set by the parent process at spawn time
// (see runRenderWorker in app-render.js): fontconfig/glib read the environment through
// the CRT getenv snapshot taken at process creation, so assignments to process.env
// inside this worker are invisible to it. We only prepare the config file here, before
// sunniesnow-record (and therefore canvas/fontconfig) is imported.
if (process.platform === "win32") {
	try {
		fs.mkdirSync(request.options.assetsDir, { recursive: true });
		const fontDirectory = request.options.assetsDir.replace(/\\/g, "/")
			.replace(/&/g, "&amp;").replace(/</g, "&lt;");
		const confPath = path.join(os.tmpdir(), "sviber-fontconfig.conf");
		fs.writeFileSync(confPath, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
	<dir>WINDOWSFONTDIR</dir>
	<dir>WINDOWSUSERFONTDIR</dir>
	<dir prefix="xdg">fonts</dir>
	<dir>${fontDirectory}</dir>
	<cachedir>LOCAL_APPDATA_FONTCONFIG_CACHE</cachedir>
	<cachedir prefix="xdg">fontconfig</cachedir>
	<match target="pattern">
		<test name="family" compare="eq"><string>YujiBoku</string></test>
		<edit name="family" mode="prepend" binding="strong"><string>Yuji Boku</string></edit>
	</match>
</fontconfig>
`);
	} catch (error) {
		send({ log: `Font config setup failed: ${error.message}` });
	}
}
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
	// Video rendering hard-requires headless WebGL (Record.screenshot reads frames via
	// gl.readPixels), but machines without usable OpenGL — VMs, remote-desktop sessions,
	// missing GPU drivers — silently fall back to the Canvas renderer and then crash
	// deep inside PIXI or the recorder (the SpinUp "getUniformLocation of null" and
	// "gl.readPixels of undefined" failures seen in the wild). Probe the GL context up
	// front and turn that into a clear report instead. Cover generation tolerates the
	// Canvas fallback, so it is not probed.
	if (request.kind === "video") {
		let glContext = null;
		try {
			glContext = (await import("gl")).default?.(16, 16, {preserveDrawingBuffer: true}) ?? null;
		} catch {}
		if (!glContext) {
			const message = "此电脑的 OpenGL 环境不可用，无法渲染视频。视频渲染需要 OpenGL 2.1+"
				+ "（虚拟机、远程桌面会话或缺少显卡驱动时会出现；请更新显卡驱动或在有 GPU 的环境运行）。"
				+ "OpenGL is unavailable on this machine, so video rendering cannot run.";
			process.stdout.write(`${JSON.stringify({
				error: message,
				details: recentLogs.join("\n"),
			})}\n`, () => process.exit(1));
		}
	}
	const runner = request.kind === "video" ? SunniesnowRecord.Record : SunniesnowRecord.CoverGen;
	// Record and CoverGen convert string option values through toBlob, which reads file
	// paths from disk — so the level archive is handed over as a plain path.
	const options = { ...request.options, levelFileUpload: request.levelFile };
	// CoverGen.run takes no progress callback; only the video renderer reports progress.
	await runner.run(options, request.kind === "video" ? progress => send({ progress }) : undefined);
	// v0.16.16: exit explicitly after the done report is flushed. The PIXI ticker keeps
	// the event loop alive after Record/CoverGen finish, and without this the worker
	// never exits, so the app never sees the process close and the dialog stays stuck
	// on the last progress state even though the output file was already written.
	process.stdout.write(`${JSON.stringify({ done: true })}\n`, () => process.exit(0));
} catch (error) {
	send({
		error: String(error?.message ?? error),
		details: error?.stack ? String(error.stack) : "",
		stderr: typeof error?.stderr === "string" ? error.stderr : undefined,
		stdout: Array.isArray(error?.stdout) ? error.stdout : undefined,
	});
	process.exitCode = 1;
}
