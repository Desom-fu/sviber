import assert from "node:assert/strict";
import test from "node:test";
import { isHeadlessInvocation, parseCliArguments, versionText } from "../js/cli/cli.js";
import { runCli } from "../js/cli/cli-operations.js";
import packageJson from "../package.json" with { type: "json" };

test("CLI --version prints package version and skips the GUI", async () => {
	assert.equal(parseCliArguments(["--version"]).version, true);
	assert.equal(isHeadlessInvocation(parseCliArguments(["--version"])), true);
	const lines = { out: [], error: [] };
	const code = await runCli(["--version"], {
		print: text => lines.out.push(text),
		printError: text => lines.error.push(text),
	});
	assert.equal(code, 0);
	assert.equal(lines.out.join(""), versionText(packageJson.version));
	assert.match(versionText(packageJson.version), /^sviber /);
});
