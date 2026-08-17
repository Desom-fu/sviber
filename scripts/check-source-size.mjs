import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MAX_LINES = 1000;
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".css", ".html"]);
const IGNORED_DIRECTORIES = new Set([".git", "build", "node_modules", "test-results"]);

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
for (const filename of await sourceFiles(projectDirectory)) {
	const source = await readFile(filename, "utf8");
	const lineCount = source === "" ? 0 : source.split(/\r?\n/).length - (source.endsWith("\n") ? 1 : 0);
	if (lineCount > MAX_LINES) {
		violations.push({ filename: path.relative(projectDirectory, filename), lineCount });
	}
}

if (violations.length) {
	const details = violations.map(({ filename, lineCount }) => `  ${lineCount}  ${filename}`).join("\n");
	throw new Error(`Source files must not exceed ${MAX_LINES} lines:\n${details}`);
}

console.log(`Source size check passed: every JS, MJS, CSS, and HTML file is <= ${MAX_LINES} lines.`);
