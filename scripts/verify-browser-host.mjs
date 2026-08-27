// Test harness for the browser verification run: serves the working tree over HTTP when no
// dev server is already listening, and locates an installed Chrome or Edge binary.
import { createServer } from "node:http";
import { access, readFile, stat } from "node:fs/promises";
import path, { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(projectDirectory, "..");
const executableCandidates = [
	process.env.SVIBER_CHROME,
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
].filter(Boolean);

const MIME_TYPES = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".otf": "font/otf",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ttf": "font/ttf",
	".wav": "audio/wav",
	".webm": "audio/webm",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".wasm": "application/wasm",
};

export async function isReachable(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 1_500);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

function isInside(root, filename) {
	const normalizedRoot = resolve(root);
	const normalizedFile = resolve(filename);
	return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}${path.sep}`);
}

function fileForRequest(requestUrl) {
	const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
	let root = projectDirectory;
	let relativePath = pathname;
	if (pathname.startsWith("/sviber/assets/fonts/")) {
		root = path.join(projectDirectory, "node_modules", ".cache", "sviber", "fonts");
		relativePath = pathname.slice("/sviber/assets/fonts/".length);
	} else if (pathname === "/sviber" || pathname.startsWith("/sviber/")) {
		relativePath = pathname.slice("/sviber".length);
	} else {
		root = repositoryDirectory;
	}
	relativePath = relativePath.replace(/^\/+/, "") || "index.html";
	const filename = resolve(root, relativePath);
	return { root, filename };
}

export async function startTemporaryServer(requestedUrl) {
	const requested = new URL(requestedUrl);
	if (!["127.0.0.1", "localhost", "::1"].includes(requested.hostname)) {
		throw new Error(
			`Cannot start a local server for ${requested.hostname}; set SVIBER_BASE_URL to a reachable URL.`,
		);
	}
	const host = requested.hostname === "localhost" ? "127.0.0.1" : requested.hostname;
	const server = createServer(async (request, response) => {
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405, { Allow: "GET, HEAD" });
			response.end();
			return;
		}
		try {
			const { root, filename: requestedFilename } = fileForRequest(request.url || "/");
			if (!isInside(root, requestedFilename)) {
				throw new Error("path traversal");
			}
			let filename = requestedFilename;
			let information = await stat(filename);
			if (information.isDirectory()) {
				filename = path.join(filename, "index.html");
				if (!isInside(root, filename)) {
					throw new Error("path traversal");
				}
				information = await stat(filename);
			}
			if (!information.isFile()) {
				throw new Error("not a file");
			}
			const body = await readFile(filename);
			response.writeHead(200, {
				"Cache-Control": "no-store",
				"Content-Length": body.length,
				"Content-Type": MIME_TYPES[extname(filename).toLowerCase()] || "application/octet-stream",
			});
			if (request.method === "HEAD") {
				response.end();
			} else {
				response.end(body);
			}
		} catch {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not found");
		}
	});
	const listen = port =>
		new Promise((resolveListen, rejectListen) => {
			const onError = error => {
				server.off("listening", onListening);
				rejectListen(error);
			};
			const onListening = () => {
				server.off("error", onError);
				resolveListen(server.address().port);
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen({ host, port });
		});
	let port;
	try {
		const requestedPort = requested.port === "" ? 80 : Number(requested.port);
		port = await listen(requestedPort);
	} catch (error) {
		if (error.code !== "EADDRINUSE") {
			await new Promise(resolveClose => server.close(() => resolveClose()));
			throw error;
		}
		port = await listen(0);
	}
	const activeUrl = new URL(requested);
	activeUrl.hostname = host;
	activeUrl.port = String(port);
	return { server, baseUrl: activeUrl.href };
}

export async function browserExecutable() {
	for (const candidate of executableCandidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			/* Try the next browser. */
		}
	}
	throw new Error("No supported Chrome or Edge executable was found. Set SVIBER_CHROME.");
}
