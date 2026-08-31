import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { builderApplicationOptions, SUPPORTED_FILE_EXTENSIONS } from "../scripts/nw-build-config.mjs";

test("NW.js v23 distributions declare sviber, JSON, and text file associations", async () => {
	assert.deepEqual([...SUPPORTED_FILE_EXTENSIONS], ["sviber", "json", "txt"]);
	const [linuxMime, desktop, macInfo, inno, packageJson] = await Promise.all([
		readFile(new URL("../packaging/linux/sviber.xml", import.meta.url), "utf8"),
		readFile(new URL("../packaging/linux/sviber.desktop", import.meta.url), "utf8"),
		readFile(new URL("../packaging/macos/Info.plist", import.meta.url), "utf8"),
		readFile(new URL("../packaging/windows/sviber.iss", import.meta.url), "utf8"),
		readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
	]);
	assert.match(linuxMime, /\*\.sviber/);
	assert.match(desktop, /application\/json;text\/plain/);
	assert.match(macInfo, /<string>sviber<\/string>/);
	assert.match(macInfo, /<string>json<\/string>/);
	assert.match(macInfo, /<string>txt<\/string>/);
	assert.match(inno, /Software\\Classes\\\.sviber/);
	assert.equal(packageJson["single-instance"], false);
	assert.deepEqual(builderApplicationOptions("win", packageJson).fileAssociations, ["sviber", "json", "txt"]);
});
