import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nwbuild from "nw-builder";
import sharp from "sharp";
import decoderBundler from "./audio-decoder-bundle.cjs";
import { builderApplicationOptions, PACKAGED_WINDOW_ICON } from "./nw-build-config.mjs";

const { bundleAudioDecoder: bundleAudioDecoderFile } = decoderBundler;

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

function gitOutput(args) {
	return new Promise((resolve, reject) => {
		const child = spawn("git", args, { cwd: sviberDirectory, windowsHide: true });
		let output = "";
		let errors = "";
		child.stdout.on("data", chunk => { output += chunk; });
		child.stderr.on("data", chunk => { errors += chunk; });
		child.once("error", reject);
		child.once("exit", code => code === 0 ? resolve(output.trim())
			: reject(new Error(errors.trim() || `git exited with code ${code}`)));
	});
}

async function writeBuildInformation(applicationDirectory) {
	const information = {};
	try {
		information.commit = await gitOutput(["rev-parse", "HEAD"]);
		information.commitDate = await gitOutput(["show", "-s", "--format=%cI", "HEAD"]);
	} catch (error) {
		console.warn(`Build metadata unavailable: ${error.message}`);
	}
	await writeFile(path.join(applicationDirectory, "build-info.json"), `${JSON.stringify(information, null, "\t")}\n`);
}

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

async function verifyPackagedFontCss(applicationDirectory) {
	const source = await readFile(path.join(applicationDirectory, "css", "fonts-local.css"), "utf8");
	if (/https?:\/\//i.test(source)) throw new Error("Packaged local font CSS must not contain remote URLs.");
}

async function generateWindowsIcon(source, destination) {
	const sizes = [16, 32, 48, 64, 128, 256];
	const images = await Promise.all(sizes.map(size => sharp(source)
		.resize(size, size, { fit: "contain" })
		.png()
		.toBuffer()));
	const headerSize = 6 + images.length * 16;
	const header = Buffer.alloc(headerSize);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = headerSize;
	images.forEach((image, index) => {
		const size = sizes[index];
		const entry = 6 + index * 16;
		header.writeUInt8(size === 256 ? 0 : size, entry);
		header.writeUInt8(size === 256 ? 0 : size, entry + 1);
		header.writeUInt16LE(1, entry + 4);
		header.writeUInt16LE(32, entry + 6);
		header.writeUInt32LE(image.length, entry + 8);
		header.writeUInt32LE(offset, entry + 12);
		offset += image.length;
	});
	await writeFile(destination, Buffer.concat([header, ...images]));
}

async function generateMacosIcon(source, destination) {
	const iconsetDirectory = path.join(path.dirname(destination), "icon.iconset");
	const images = [
		["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
		["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
		["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
		["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
		["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
	];
	await rm(iconsetDirectory, { recursive: true, force: true });
	await mkdir(iconsetDirectory, { recursive: true });
	try {
		await Promise.all(images.map(([filename, size]) => sharp(source)
			.resize(size, size, { fit: "contain" }).png()
			.toFile(path.join(iconsetDirectory, filename))));
		await new Promise((resolve, reject) => {
			const child = spawn("iconutil", ["--convert", "icns", "--output", destination, iconsetDirectory], {
				stdio: "inherit", windowsHide: true,
			});
			child.once("error", reject);
			child.once("exit", code => code === 0 ? resolve()
				: reject(new Error(`iconutil exited with code ${code}`)));
		});
	} finally {
		await rm(iconsetDirectory, { recursive: true, force: true });
	}
}

async function generatePackagedIcons(applicationDirectory) {
	const source = path.join(applicationDirectory, "svg", "icon.svg");
	const tasks = [
		generateWindowsIcon(source, path.join(applicationDirectory, "icon.ico")),
		sharp(source).resize(512, 512, { fit: "contain" }).png()
			.toFile(path.join(applicationDirectory, "icon.png")),
	];
	if (process.platform === "darwin") {
		tasks.push(generateMacosIcon(source, path.join(applicationDirectory, "icon.icns")));
	}
	await Promise.all(tasks);
}

async function copyApplication() {
	await rm(buildDirectory, { recursive: true, force: true });
	const applicationDirectory = path.join(stageDirectory, "sviber");
	await mkdir(applicationDirectory, { recursive: true });
	const excludedEntries = new Set([".git", "build", "tests", "test-results", "node_modules", "package-lock.json"]);
	for (const entry of await readdir(sviberDirectory, { withFileTypes: true })) {
		if (excludedEntries.has(entry.name)) continue;
		await cp(path.join(sviberDirectory, entry.name), path.join(applicationDirectory, entry.name), {
			recursive: entry.isDirectory(),
		});
	}
	const applicationLicense = path.join(sviberDirectory, "LICENSE");
	if (!existsSync(applicationLicense)) throw new Error(`Missing application license: ${applicationLicense}`);
	await cp(applicationLicense, path.join(stageDirectory, "LICENSE"));
	await cp(applicationLicense, path.join(applicationDirectory, "LICENSE"));
	await writeBuildInformation(applicationDirectory);
	await copyProductionDependencies(applicationDirectory);
	await bundleAudioDecoderFile(path.join(applicationDirectory, "js", "audio", "audio-decode.bundle.js"), { minify: true });
	await generatePackagedIcons(applicationDirectory);
	await verifyPackagedFontCss(applicationDirectory);

	const sourcePackage = JSON.parse(await readFile(path.join(sviberDirectory, "package.json"), "utf8"));
	const packageJson = {
		name: sourcePackage.name,
		version: sourcePackage.version,
		license: sourcePackage.license,
		repository: sourcePackage.repository,
		bugs: sourcePackage.bugs,
		main: "sviber/index.html",
		window: {
			...sourcePackage.window,
			icon: PACKAGED_WINDOW_ICON,
		},
	};
	await writeFile(path.join(stageDirectory, "package.json"), `${JSON.stringify(packageJson, null, "\t")}\n`);
}

async function runBuilder() {
	const nwPackage = JSON.parse(await readFile(path.join(sviberDirectory, "node_modules", "nw", "package.json"), "utf8"));
	const sourcePackage = JSON.parse(await readFile(path.join(sviberDirectory, "package.json"), "utf8"));
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
			app: builderApplicationOptions(process.platform, sourcePackage),
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
