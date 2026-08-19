import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MAX_LINES = 1000;
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".css", ".html"]);
const IGNORED_DIRECTORIES = new Set([".git", "build", "new-icons-4", "node_modules", "test-results"]);

async function sourceFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const result = [];
	for (const entry of entries) {
		if (IGNORED_DIRECTORIES.has(entry.name)) continue;
		const filename = path.join(directory, entry.name);
		if (entry.isDirectory()) result.push(...await sourceFiles(filename));
		else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) result.push(filename);
	}
	return result;
}

const projectDirectory = path.resolve(import.meta.dirname, "..");
const violations = [];
const files = await sourceFiles(projectDirectory);
for (const filename of files) {
	const source = await readFile(filename, "utf8");
	const lineCount = source === "" ? 0 : source.split(/\r?\n/).length - (source.endsWith("\n") ? 1 : 0);
	if (lineCount > MAX_LINES) {
		violations.push({ filename: path.relative(projectDirectory, filename), lineCount });
	}
}

for (const legacyDirectory of ["audio", "render", path.join("maker", "svg")]) {
	try {
		await readdir(path.join(projectDirectory, legacyDirectory));
		violations.push({ filename: legacyDirectory, lineCount: "legacy source directory" });
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
}

async function misplacedSvgFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const result = [];
	for (const entry of entries) {
		if (IGNORED_DIRECTORIES.has(entry.name)) continue;
		const filename = path.join(directory, entry.name);
		if (entry.isDirectory()) result.push(...await misplacedSvgFiles(filename));
		else if (path.extname(entry.name).toLowerCase() === ".svg"
			&& !path.relative(path.join(projectDirectory, "svg"), filename).split(path.sep).includes("..")) continue;
		else if (path.extname(entry.name).toLowerCase() === ".svg") result.push(filename);
	}
	return result;
}
for (const filename of await misplacedSvgFiles(projectDirectory)) {
	violations.push({ filename: path.relative(projectDirectory, filename), lineCount: "SVG outside svg/" });
}

if (violations.length) {
	const details = violations.map(({ filename, lineCount }) => `  ${lineCount}  ${filename}`).join("\n");
	throw new Error(`Source organization check failed:\n${details}`);
}

console.log(`Source organization check passed: files are <= ${MAX_LINES} lines and assets use the required directories.`);
