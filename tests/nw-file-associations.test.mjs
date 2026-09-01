import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	builderApplicationOptions,
	SUPPORTED_FILE_EXTENSIONS,
	SUPPORTED_MIME_TYPES,
} from "../scripts/nw-build-config.mjs";

test("NW.js distributions declare sviber, JSON, and text file associations", async () => {
	assert.deepEqual([...SUPPORTED_FILE_EXTENSIONS], ["sviber", "json", "txt"]);
	assert.deepEqual([...SUPPORTED_MIME_TYPES], ["application/x-sviber", "application/json", "text/plain"]);
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
	assert.deepEqual(builderApplicationOptions("linux", packageJson).mimeType, [...SUPPORTED_MIME_TYPES]);
	assert.equal(builderApplicationOptions("linux", packageJson).exec, "sviber %F");
	assert.deepEqual(builderApplicationOptions("win", packageJson).fileAssociations, ["sviber", "json", "txt"]);
	const buildScript = await readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8");
	assert.match(buildScript, /copyDistributionAssociationMetadata/);
	assert.match(buildScript, /parsePlist/);
	assert.match(buildScript, /CFBundleDocumentTypes/);
	const [packageWorkflow, releaseWorkflow] = await Promise.all([
		readFile(new URL("../.github/workflows/package.yml", import.meta.url), "utf8"),
		readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
	]);
	assert.match(packageWorkflow, /Compile Windows installer/);
	assert.match(packageWorkflow, /name: sviber-\$\{\{ env\.version \}\}-\$\{\{ matrix\.osName \}\}-\$\{\{ matrix\.archName \}\}-installer/);
	assert.match(releaseWorkflow, /release\/\*-setup\.exe/);
	assert.match(inno, /OutputBaseFilename=sviber-\{#AppVersion\}-\{#Architecture\}-setup/);
	assert.match(inno, /OutputDir=\.\.\\\.\.\\build\\installer/);
	assert.match(inno, /Source: "\.\.\\\.\.\\build\\nw\\\*"/);
});
