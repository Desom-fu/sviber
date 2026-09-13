// Identity of one MCP server run.
//
// A pairing is with one server process, so the default identity is unique per run: two servers
// running side by side must not overwrite each other's announcement or steal each other's
// pairing. Callers that want one reusable identity can pin it with SVIBER_MCP_CLIENT_ID
// (or the matching option) — pinned identities share a pairing by design.

import { randomUUID } from "node:crypto";

const DEFAULT_CLIENT_NAME = "sviber-mcp";

export function resolveMcpClientIdentity({ env = process.env, clientId = "", clientName = "" } = {}) {
	const name = String(clientName || env?.SVIBER_MCP_CLIENT_NAME || DEFAULT_CLIENT_NAME);
	const explicit = String(clientId || env?.SVIBER_MCP_CLIENT_ID || "").trim();
	return { id: explicit || randomUUID(), name };
}
