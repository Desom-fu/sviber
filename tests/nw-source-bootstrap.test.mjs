import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

test("source fonts are ready before CSS when NW.js starts from another directory", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-source-boot-"));
	const application = path.join(directory, "application");
	const cache = path.join(application, "node_modules", ".cache", "sviber", "fonts");
	const fonts = [
		"LXGWWenKai-Regular.ttf",
		"NotoSansMath-Regular.ttf",
		"NotoSansCJKtc-Regular.otf",
		"HanWangShinSuMedium.ttf",
		"YujiBoku-Regular.ttf",
	];
	try {
		await mkdir(cache, { recursive: true });
		await Promise.all(fonts.map(name => writeFile(path.join(cache, name), name)));
		const outputs = [];
		const context = {
			console,
			process: { cwd: () => application },
			nw: {
				App: { startPath: path.join(directory, "project"), manifest: { "sviber-source": true } },
				require(name) {
					if (name === "node:path") {
						return path;
					}
					if (name === "node:fs") {
						return fs;
					}
					assert.equal(name, path.join(application, "scripts", "audio-decoder-bundle.cjs"));
					return { bundleAudioDecoder: async output => outputs.push(output) };
				},
			},
			document: {
				createElement: () => ({}),
				head: {
					append(stylesheet) {
						assert.equal(stylesheet.href, "css/fonts-local.css");
						for (const name of fonts) {
							const filename = path.join(application, "assets", "fonts", name);
							assert.equal(fs.readFileSync(filename, "utf8"), name);
						}
					},
				},
			},
		};
		vm.createContext(context);
		vm.runInContext(await readFile(new URL("../js/boot/nw-source-bootstrap.js", import.meta.url), "utf8"), context);
		vm.runInContext(await readFile(new URL("../js/boot/font-loader.js", import.meta.url), "utf8"), context);
		await context.sviberSourcePreparation;
		assert.equal(context.sviberSourceBootstrapError, undefined);
		assert.deepEqual(outputs, [path.join(application, "js", "audio", "audio-decode.bundle.js")]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
