// A stable identity for the MCP server on this machine.
//
// Pairing is keyed by the client id, so a per-process uuid would ask the user to pair again on
// every launch. The id is therefore persisted once in `~/.sviber/mcp-client-id` and reused by
// every later run; `SVIBER_MCP_CLIENT_ID` / `SVIBER_MCP_CLIENT_NAME` (or the matching options)
// override it for anyone who wants separate identities per client.

import { randomUUID } from "node:crypto";
import { mcpClientIdPath, sviberDirectory } from "./mcp-paths.js";

const DEFAULT_CLIENT_NAME = "sviber-mcp";

export function resolveMcpClientIdentity({ fs, home, env = process.env, clientId = "", clientName = "" } = {}) {
	const name = String(clientName || env?.SVIBER_MCP_CLIENT_NAME || DEFAULT_CLIENT_NAME);
	const explicit = String(clientId || env?.SVIBER_MCP_CLIENT_ID || "").trim();
	if (explicit) {
		return { id: explicit, name };
	}
	const pathname = mcpClientIdPath(home);
	let persisted = "";
	try {
		persisted = String(fs.readFileSync(pathname, "utf8")).trim();
	} catch {
		/* first run */
	}
	if (persisted) {
		return { id: persisted, name };
	}
	const generated = randomUUID();
	try {
		fs.mkdirSync(sviberDirectory(home), { recursive: true });
		fs.writeFileSync(pathname, `${generated}\n`);
	} catch {
		/* read-only home: a per-process id still works, it just re-asks every launch */
	}
	return { id: generated, name };
}
