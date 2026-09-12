// Helpers for the render dialogs: video container suffixes, rewriting the save path when
// the suffix changes, and deleting the per-job temp directory after FFmpeg has released it.

export const VIDEO_OUTPUT_EXTENSIONS = ["mkv", "mp4", "webm"];

export function extensionOfPath(pathname, fallback = "mkv") {
	const match = /\.([^./\\]+)$/.exec(String(pathname || ""));
	const extension = match?.[1]?.toLowerCase();
	return extension || fallback;
}

export function replacePathExtension(pathname, extension) {
	const source = String(pathname || "");
	const next = String(extension || "").replace(/^\./, "").toLowerCase();
	if (!source || !next) {
		return source;
	}
	if (/\.[^./\\]+$/.test(source)) {
		return source.replace(/\.[^./\\]+$/, `.${next}`);
	}
	return `${source}.${next}`;
}

export async function removeRenderWorkDirectory(
	fs,
	directory,
	wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
) {
	if (!directory) {
		return true;
	}
	const delays = [0, 250, 500, 1000, 2000];
	for (const delay of delays) {
		if (delay) {
			await wait(delay);
		}
		try {
			fs.rmSync(directory, { recursive: true, force: true });
		} catch {
			// Windows keeps the dir busy until FFmpeg/the worker fully releases it.
		}
		try {
			if (!fs.existsSync(directory)) {
				return true;
			}
		} catch {
			return true;
		}
	}
	return false;
}
