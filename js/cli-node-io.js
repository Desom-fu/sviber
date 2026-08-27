// Node/NW.js implementation of the CLI I/O surface used by js/cli-operations.js.

import { ChartModel } from "./core/chart-model.js";
import { PROJECT_FILENAME } from "./core/project.js";

const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
const CHART_EXTENSION = /\.json$/i;
const ASSET_PATTERN = /\.(mp3|ogg|wav|flac|m4a|aac|opus|webm|png|jpg|jpeg|webp|gif|avif|bmp|svg|md|txt)$/i;
const DISPLAY_TEXT_PATTERN = /^(READ_?ME|LICEN[SC]|NOTICE|COPYING|COPYRIGHT|PATENT|CHANGE_?LOG)/i;

// Reads an .ssc archive into charts plus the raw assets it carries. Only entries at the root of
// the archive count, which is the layout Sunniesnow levels use.
async function readLevelArchive({ fs, JSZip }, pathname) {
	const zip = await JSZip.loadAsync(await fs.promises.readFile(pathname));
	const charts = [];
	const assets = [];
	const names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
	for (const name of names.sort()) {
		if (name.includes("/")) {
			continue;
		}
		if (CHART_EXTENSION.test(name)) {
			const document = JSON.parse(await zip.files[name].async("string"));
			charts.push({
				id: name.replace(CHART_EXTENSION, ""),
				file: name,
				model: ChartModel.import(document),
			});
			continue;
		}
		if (ASSET_PATTERN.test(name)) {
			assets.push({ name, data: await zip.files[name].async("uint8array") });
		}
	}
	if (!charts.length) {
		throw new Error("The level does not contain a chart.");
	}
	return { charts, assets };
}

// The files in a project folder that belong in an exported level: whatever the charts reference
// as music or cover art, plus the readme-style texts Sunniesnow displays.
async function readProjectAssets({ fs, path }, directory, charts) {
	const wanted = new Set();
	for (const chart of charts) {
		for (const field of ["music", "image"]) {
			const reference = String(chart.model[field] || "");
			if (reference && !reference.includes("/") && !reference.includes("\\")) {
				wanted.add(reference);
			}
		}
	}
	const assets = [];
	for (const name of await fs.promises.readdir(directory)) {
		if (name === PROJECT_FILENAME || CHART_EXTENSION.test(name)) {
			continue;
		}
		if (!wanted.has(name) && !DISPLAY_TEXT_PATTERN.test(name)) {
			continue;
		}
		assets.push({ name, data: await fs.promises.readFile(path.join(directory, name)) });
	}
	return assets;
}

// Entry timestamps are pinned so that exporting the same level twice is byte-identical.
async function writeLevelArchive({ fs, JSZip }, pathname, charts, assets) {
	const zip = new JSZip();
	for (const chart of charts) {
		const document = chart.model.exportSunniesnow({ includeSchema: true });
		zip.file(chart.file, `${JSON.stringify(document, null, 2)}\n`, { date: ZIP_EPOCH });
	}
	for (const asset of assets) {
		zip.file(asset.name, asset.data, { date: ZIP_EPOCH });
	}
	const buffer = await zip.generateAsync({
		type: "nodebuffer",
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
		platform: "UNIX",
	});
	await fs.promises.writeFile(pathname, buffer);
}

export function createNodeCliIo(host) {
	const { fs, path, print, printError } = host;
	return {
		join: (...parts) => path.join(...parts),
		print: message => print(`${message}\n`),
		printError: message => printError(`${message}\n`),

		async isDirectory(pathname) {
			try {
				return (await fs.promises.stat(pathname)).isDirectory();
			} catch {
				return false;
			}
		},

		async readText(pathname) {
			return fs.promises.readFile(pathname, "utf8");
		},

		async writeText(pathname, text) {
			await fs.promises.writeFile(pathname, text, "utf8");
		},

		async writeBinary(pathname, data) {
			await fs.promises.writeFile(pathname, Buffer.from(data));
		},

		async makeDirectory(pathname) {
			await fs.promises.mkdir(pathname, { recursive: true });
		},

		readLevel(pathname) {
			return readLevelArchive(host, pathname);
		},

		projectAssets(directory, charts) {
			return readProjectAssets(host, directory, charts);
		},

		writeLevel(pathname, charts, assets) {
			return writeLevelArchive(host, pathname, charts, assets);
		},
	};
}
