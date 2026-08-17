import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import nwbuild from "nw-builder";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sviberDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(sviberDirectory, "..");
const buildDirectory = path.join(sviberDirectory, "build");
const stageDirectory = path.join(buildDirectory, "stage");
const outputDirectory = path.join(buildDirectory, "nw");
const fontCacheDirectory = path.join(sviberDirectory, "node_modules", ".cache", "sviber", "fonts");
const FONT_ASSETS = [
	{
		name: "LXGWWenKai-Regular.ttf",
		sha256: "9D5FB31B282E4AC16B6B9AAA0D40C21E947AC6BD2A7F32C814D43F7F5F396BF9",
		urls: [
			"https://fastly.jsdelivr.net/gh/lxgw/LxgwWenKai@1.245.1/fonts/TTF/LXGWWenKai-Regular.ttf",
			"https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@1.245.1/fonts/TTF/LXGWWenKai-Regular.ttf",
		],
	},
	{
		name: "NotoSansMath-Regular.ttf",
		sha256: "92CEA8BC749CE778118FC6D3B52DCCEAE3F59B6CFE00D241849BE09FECC006C2",
		urls: [
			"https://fastly.jsdelivr.net/gh/notofonts/math@53eb8eb200ed8fc73fa13d97d26a2c9c56428c17/fonts/NotoSansMath/full/ttf/NotoSansMath-Regular.ttf",
			"https://cdn.jsdelivr.net/gh/notofonts/math@53eb8eb200ed8fc73fa13d97d26a2c9c56428c17/fonts/NotoSansMath/full/ttf/NotoSansMath-Regular.ttf",
		],
	},
	{
		name: "NotoSansCJKtc-Regular.otf",
		sha256: "DCE08BD4FD91AA8AA76ED8FEA4B694C2DFB8550F67871E326843212DDBEB88B4",
		urls: [
			"https://fastly.jsdelivr.net/gh/notofonts/noto-cjk@f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf",
			"https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf",
		],
	},
	{
		name: "HanWangShinSuMedium.ttf",
		sha256: "50A8C5F2C8CFE6D218EC2041DEB1902ADD56882348A86C518EAEAB685678C0FE",
		urls: [
			"https://fastly.jsdelivr.net/gh/kaio/wangfonts@268666d80f8029bb8c61b9668352c7a375873301/TrueType/wt071.ttf",
			"https://cdn.jsdelivr.net/gh/kaio/wangfonts@268666d80f8029bb8c61b9668352c7a375873301/TrueType/wt071.ttf",
		],
	},
	{
		name: "YujiBoku-Regular.ttf",
		sha256: "94FDA16384F3BDAC24376A000C57E99ABFA314961BD89EF27BADFB7410322003",
		urls: [
			"https://fastly.jsdelivr.net/gh/Kinutafontfactory/Yuji@efec977b14b57c19eb85d468edcfbbad13139e67/fonts/ttf/YujiBoku-Regular.ttf",
			"https://cdn.jsdelivr.net/gh/Kinutafontfactory/Yuji@efec977b14b57c19eb85d468edcfbbad13139e67/fonts/ttf/YujiBoku-Regular.ttf",
		],
	},
	{
		name: "LICENSE-HanWang-GPL-2.0.txt",
		sha256: "DB511383A96A22DB478AE02390B8AB8EA8C7DA44020C8A4FB59B1B2D7BBA538E",
		urls: [
			"https://cdn.jsdelivr.net/gh/kaio/wangfonts@268666d80f8029bb8c61b9668352c7a375873301/COPYING",
		],
	},
	{
		name: "LICENSE-YujiBoku-OFL-1.1.txt",
		sha256: "EF7C85C72AE94381C8BC4832AE4E6FBABDEAFA2BB8A31313CD75DCE95A690256",
		urls: [
			"https://cdn.jsdelivr.net/gh/Kinutafontfactory/Yuji@efec977b14b57c19eb85d468edcfbbad13139e67/OFL.txt",
		],
	},
	{
		name: "LICENSE-NotoSansCJK-OFL-1.1.txt",
		sha256: "6A73F9541C2DE74158C0E7CF6B0A58EF774F5A780BF191F2D7EC9CC53EFE2BF2",
		urls: [
			"https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/LICENSE",
		],
	},
	{
		name: "LICENSE-LXGW-OFL-1.1.txt",
		sha256: "C7BAA4A26B1723314991E3FF7925DCCBAA62A49DA13AEC4785EF73089301B218",
		urls: [
			"https://fastly.jsdelivr.net/gh/lxgw/LxgwWenKai@1.245.1/OFL.txt",
			"https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@1.245.1/OFL.txt",
		],
	},
	{
		name: "LICENSE-NotoSansMath-OFL-1.1.txt",
		sha256: "0DAB92D0544F7B233403F14B84A663BDBFA746982EDA629E7F4F9FFE1B036FEB",
		urls: [
			"https://fastly.jsdelivr.net/gh/notofonts/noto-fonts@ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE",
			"https://cdn.jsdelivr.net/gh/notofonts/noto-fonts@ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE",
		],
	},
];

async function fileSha256(filename) {
	return createHash("sha256").update(await readFile(filename)).digest("hex").toUpperCase();
}

async function verifyAsset(asset, filename) {
	const actual = await fileSha256(filename);
	if (actual !== asset.sha256) {
		throw new Error(`${asset.name} SHA-256 mismatch: expected ${asset.sha256}, received ${actual}`);
	}
}

async function downloadWithCurl(url, destination) {
	const partial = `${destination}.part`;
	await rm(partial, { force: true });
	const executable = process.platform === "win32" ? "curl.exe" : "curl";
	try {
		await new Promise((resolve, reject) => {
			const child = spawn(executable, [
				"--fail", "--location", "--silent", "--show-error",
				"--retry", "2", "--retry-all-errors", "--connect-timeout", "20", "--max-time", "180",
				"--output", partial, url,
			], { stdio: "inherit", windowsHide: true });
			child.once("error", reject);
			child.once("exit", code => code === 0 ? resolve() : reject(new Error(`curl exited with code ${code}`)));
		});
		await rename(partial, destination);
	} catch (error) {
		await rm(partial, { force: true });
		throw error;
	}
}

async function downloadWithFetch(url, destination) {
	const partial = `${destination}.part`;
	await rm(partial, { force: true });
	try {
		const response = await fetch(url, {
			redirect: "follow",
			signal: AbortSignal.timeout(300_000),
			headers: { "User-Agent": "sviber-nw-builder/0.1" },
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		await writeFile(partial, new Uint8Array(await response.arrayBuffer()));
		await rename(partial, destination);
	} catch (error) {
		await rm(partial, { force: true });
		throw error;
	}
}

async function downloadAsset(asset, destination) {
	const failures = [];
	for (const url of asset.urls) {
		try {
			await downloadWithCurl(url, destination);
			await verifyAsset(asset, destination);
			return;
		} catch (error) {
			failures.push(`${url}: ${error.message}`);
			await rm(destination, { force: true });
		}
	}
	try {
		await downloadWithFetch(asset.urls[0], destination);
		await verifyAsset(asset, destination);
		return;
	} catch (error) {
		failures.push(`fetch fallback: ${error.message}`);
		await rm(destination, { force: true });
	}
	throw new Error(`Unable to download ${asset.name}:\n${failures.join("\n")}`);
}

async function downloadFonts() {
	const destination = path.join(stageDirectory, "sviber", "assets", "fonts");
	await Promise.all([mkdir(destination, { recursive: true }), mkdir(fontCacheDirectory, { recursive: true })]);
	await Promise.all(FONT_ASSETS.map(async asset => {
		const cached = path.join(fontCacheDirectory, asset.name);
		if (existsSync(cached)) {
			try {
				await verifyAsset(asset, cached);
			} catch (error) {
				console.warn(`Discarding invalid cached font: ${error.message}`);
				await rm(cached, { force: true });
			}
		}
		if (!existsSync(cached)) await downloadAsset(asset, cached);
		const output = path.join(destination, asset.name);
		await cp(cached, output);
		await verifyAsset(asset, output);
	}));
}

async function copyProductionDependencies(applicationDirectory) {
	const lockfile = JSON.parse(await readFile(path.join(sviberDirectory, "package-lock.json"), "utf8"));
	if (!lockfile.packages || typeof lockfile.packages !== "object") {
		throw new Error("package-lock.json must use lockfileVersion 2 or newer.");
	}
	const prefix = "node_modules/";
	const packages = Object.entries(lockfile.packages)
		.filter(([name, metadata]) => name.startsWith(prefix) && metadata.dev !== true)
		.map(([name, metadata]) => ({ name: name.slice(prefix.length), metadata }))
		.sort((left, right) => left.name.split("/").length - right.name.split("/").length
			|| left.name.localeCompare(right.name));
	const sourceDirectory = path.join(sviberDirectory, "node_modules");
	const destinationDirectory = path.join(applicationDirectory, "node_modules");
	await mkdir(destinationDirectory, { recursive: true });
	for (const { name: packageName, metadata } of packages) {
		if (metadata.link) throw new Error(`Linked production dependencies are not supported: ${packageName}`);
		const source = path.join(sourceDirectory, ...packageName.split("/"));
		if (!existsSync(source)) {
			if (metadata.optional) continue;
			throw new Error(`Production dependency is missing: ${packageName}`);
		}
		const destination = path.join(destinationDirectory, ...packageName.split("/"));
		await mkdir(path.dirname(destination), { recursive: true });
		await cp(source, destination, {
			recursive: true,
			filter(entry) {
				const relative = path.relative(source, entry);
				return relative !== "node_modules" && !relative.startsWith(`node_modules${path.sep}`);
			},
		});
	}
}

async function bundleAudioDecoder(applicationDirectory) {
	await esbuild({
		entryPoints: [path.join(sviberDirectory, "node_modules", "audio-decode", "audio-decode.js")],
		outfile: path.join(applicationDirectory, "audio", "audio-decode.bundle.js"),
		bundle: true,
		define: {
			process: "undefined",
			"globalThis.process": "undefined",
		},
		external: ["node:module"],
		format: "esm",
		legalComments: "eof",
		platform: "browser",
		target: "chrome136",
	});
}

async function localizePackagedFontCss(applicationDirectory) {
	const filename = path.join(applicationDirectory, "css", "app.css");
	const source = await readFile(filename, "utf8");
	const localized = source.replace(
		/,\s*url\((["'])https?:\/\/.*?\1\)\s*format\((["']).*?\2\)/g,
		"",
	);
	for (const block of localized.matchAll(/@font-face\s*\{[\s\S]*?\}/g)) {
		if (/https?:\/\//i.test(block[0])) throw new Error("Packaged @font-face rules must not contain remote URLs.");
	}
	if (localized === source) throw new Error("No remote font fallbacks were removed from packaged app.css.");
	await writeFile(filename, localized);
}

async function copyApplication() {
	await rm(buildDirectory, { recursive: true, force: true });
	const applicationDirectory = path.join(stageDirectory, "sviber");
	await mkdir(applicationDirectory, { recursive: true });
	const excludedEntries = new Set(["build", "tests", "test-results", "node_modules", "package-lock.json"]);
	for (const entry of await readdir(sviberDirectory, { withFileTypes: true })) {
		if (excludedEntries.has(entry.name)) continue;
		await cp(path.join(sviberDirectory, entry.name), path.join(applicationDirectory, entry.name), {
			recursive: entry.isDirectory(),
		});
	}
	const repositoryLicense = path.join(repositoryDirectory, "LICENSE");
	if (!existsSync(repositoryLicense)) throw new Error(`Missing repository license: ${repositoryLicense}`);
	await cp(repositoryLicense, path.join(stageDirectory, "LICENSE"));
	await cp(repositoryLicense, path.join(applicationDirectory, "LICENSE"));
	await copyProductionDependencies(applicationDirectory);
	await bundleAudioDecoder(applicationDirectory);
	await localizePackagedFontCss(applicationDirectory);

	const sourcePackage = JSON.parse(await readFile(path.join(sviberDirectory, "package.json"), "utf8"));
	const packageJson = {
		name: sourcePackage.name,
		version: sourcePackage.version,
		main: "sviber/index.html",
		window: {
			...sourcePackage.window,
			icon: "sviber/icon.ico",
		},
	};
	await writeFile(path.join(stageDirectory, "package.json"), `${JSON.stringify(packageJson, null, "\t")}\n`);
}

async function runBuilder() {
	const nwPackage = JSON.parse(await readFile(path.join(sviberDirectory, "node_modules", "nw", "package.json"), "utf8"));
	const previousDirectory = process.cwd();
	process.chdir(stageDirectory);
	try {
		await nwbuild({
			mode: "build",
			version: nwPackage.version,
			flavor: "normal",
			glob: false,
			srcDir: stageDirectory,
			outDir: outputDirectory,
			cacheDir: path.join(sviberDirectory, "node_modules", "nw"),
			logLevel: "info",
		});
	} finally {
		process.chdir(previousDirectory);
	}
}

if (!existsSync(path.join(sviberDirectory, "node_modules"))) {
	throw new Error("Run npm install before building the NW.js application.");
}

await copyApplication();
await downloadFonts();
await runBuilder();
console.log(`NW.js build written to ${outputDirectory}`);
