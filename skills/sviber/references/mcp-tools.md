# sviber-mcp tools

Source of truth: `js/mcp/mcp-tools.js`, `js/mcp/mcp-editor-handlers.js`, `js/mcp/mcp-editor-tools.js`, `js/mcp/mcp-server.js`, `js/mcp/mcp-paths.js`, `js/mcp/mcp-consent.js`, `js/mcp/mcp-macro-ruby-run.js`.

## Server

- Entry: `package.json` → `"sviber-mcp": "js/mcp/mcp-main.mjs"` → `startMcpStdio()`.
- Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout. Methods: `initialize`, `initialized` / `notifications/initialized`, `tools/list`, `tools/call`, `ping`. Unknown methods → `-32601`. Tool errors → `-32000` with the error message. **Stdout is protocol-only**; logs go to stderr.
- Backend: one endpoint per editor, not customizable. POSIX uses a Unix socket at `~/.sviber/${pid}.sock`. Windows uses a named pipe `\\.\pipe\sviber-<pid>` plus an empty `<pid>.sock` marker file, because Node's Windows local domain is pipes-only — `listen()`/`connect()` on a filesystem socket path returns `EACCES` there. `SVIBER_DIR_NAME = ".sviber"`. Instances are discovered by listing `<pid>.sock` in that directory.
- Consent is **pairing**, and it is per run and per editor instance. The server announces itself in `~/.sviber/pairing/<id>.json` the moment it starts (the client id is stable, persisted in `~/.sviber/mcp-client-id`; `SVIBER_MCP_CLIENT_ID` / `SVIBER_MCP_CLIENT_NAME` override it). Editors scan that directory at startup and watch it live, so the allow/deny prompt appears when a side starts — not on the first tool call. The prompt shows which client is asking and which sviber instance it would drive.
- A pairing lives in that editor window's memory only: closing the editor or the server and starting it again asks again, two running editors pair separately, and while both stay open nothing prompts. `list_instances` reports `pairedWith` — which editor instance a client paired with.
- A client that never announced itself (older build, or a one-shot process) still gets a one-time prompt. Warning text: *Allowing this connection makes it possible to make undoable modifications to the chart from outside the editor.*
- `instance` argument is the editor **pid** as a string. Required on every tool except `list_instances`.

### Driving the tools without an MCP client (repo work)

When no MCP client is configured but an editor is running, call the dispatcher directly instead
of spawning `sviber-mcp` per call — a fresh process would get a fresh random `client` id and
re-prompt every time:

```js
const { dispatchMcpLine } = await import("<repo>/js/mcp/mcp-server.js");
const { createSocketBackend } = await import("<repo>/js/mcp/mcp-socket-backend.js");
const backend = createSocketBackend(undefined, { clientId: "my-agent" }); // stable id
const line = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
  params: { name: "get_open", arguments: { instance: "63280" } } });
console.log(JSON.stringify(await dispatchMcpLine(line, backend)));
```

Run it with the runtime bundled in the packaged app (`build/nw/package.nw/sviber/runtime/node.exe`)
so the same Node version as the app is used. Reusing that `clientId` keeps you paired for as long
as the editor instance stays open; a fresh editor asks once more, so `get_open` is the cheapest
first call to trigger the prompt. Every tool call is also logged to the server's stderr, so the
client's log shows exactly what was done.

## Tool catalogue (exactly 12)

| Tool | Required args | Optional | Returns / notes |
| --- | --- | --- | --- |
| `list_instances` | — | — | Running editor instances (pids). |
| `get_open` | `instance` | — | Whether a chart or project is open and its local path. |
| `list_macros` | `instance` | — | `{ global: [...], project: [...] }` with name/id/filename descriptors. |
| `read_macro` | `instance`, `name` | — | Descriptor + `code`. Match by name, id, or filename. |
| `create_macro` | `instance`, `name`, `code` | `scope` (`global`\|`project`), `language` (`javascript`\|`ruby`) | Creates macro. Project macros need NW.js project file APIs. Name must be unique for global. Defaults to JavaScript. |
| `rename_macro` | `instance`, `name`, `newName` | — | Renames; project macros rename the file too. |
| `edit_macro` | `instance`, `name`, `code` | — | Replaces source in place. |
| `run_macro` | `instance`, `name` | — | Runs stored macro (JS or Ruby); returns `{ stdout, stderr, modified }`. |
| `run_snippet` | `instance`, `code` | `language` (`javascript`\|`ruby`) | Runs ad-hoc code; same return shape. |
| `run_expression` | `instance`, `code` | `language` (`javascript`\|`ruby`) | Evaluates as an expression; returns `{ value, modified }`. `value` is JSON-ified (`toJSON` when present). |
| `undo_last_run` | `instance` | — | Undoes the last MCP-initiated **modifying** run. Fails if none (`no MCP-initiated modifying run to undo`). Clears the flag after one undo. |
| `get_music_snippet` | `instance`, `start`, `end` | `maxInline` | Audio between two beat times. Base64 when small, local path when large. Needs loaded music (`no music loaded` otherwise). `start`/`end` go through `snippetSeconds`. |

## Run pipeline (important)

`handleRunMacro` / `handleRunSnippet` / `handleRunExpression` all call `runAndApply`:

1. Reject if `app.model.editor.readOnly` → `The chart is read-only.`
2. Language is `ruby` or `javascript` (default JS).
3. Snapshot chart state (`app.model.snapshot()`).
4. Run JavaScript via `createSviberMacroApi` (`js/mcp/mcp-macro-run.js`), or Ruby via `@ruby/wasm-wasi` + `macro-api.rb` (`js/mcp/mcp-macro-ruby-run.js`).
5. Compare core chart fields (`events`, `channels`, `snappees`, `timing`, `metadata`, `music`, `image`, `currentTime`, `currentChannel`) before/after.
6. If changed: `app.commit("MCP macro", model => model.restore(state))` (or `model.restore`) and set `app.mcpUndoAllowed = true`.
7. Return logs and `modified`. Expression runs also return `value`.

`undo_last_run` calls `app.undo()` once and clears `mcpUndoAllowed`.

Ruby over MCP uses the same `macro-api.rb` surface as the editor sandbox. The first Ruby run boots wasm (~1s); later runs reuse the cached VM. Ruby beats must be `Integer` or `Rational`.

## Practical agent guidance

- Always `list_instances` → `get_open` before mutating.
- Prefer `run_expression` for probes (`Chart.events.length`, selection size, channel names).
- Prefer short `run_snippet` mutations with `console.log` / `puts` diagnostics rather than one giant script.
- Both `javascript` and `ruby` work for run tools.
- After a bad mutation with `modified: true`, call `undo_last_run` immediately before more edits.
- Project macros require an open NW.js project; browser/single-chart mode has no project list.
- `get_music_snippet` is the only audio-related MCP tool; it does not play sound.

## Error strings you will actually see

- `instance is required`
- `unknown tool: ...`
- `unsupported tool: ...` (instance handler)
- `macro not found: ...`
- `macro name is required` / `newName is required`
- `macro already exists: ...`
- `project macros are unavailable`
- `The chart is read-only.`
- `ruby.wasm binary is unavailable.` / ruby.wasm load failures
- `no MCP-initiated modifying run to undo`
- `no music loaded`
