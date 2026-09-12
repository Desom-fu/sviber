# sviber-mcp tools

Source of truth: `js/mcp/mcp-tools.js`, `js/mcp/mcp-editor-handlers.js`, `js/mcp/mcp-editor-tools.js`, `js/mcp/mcp-server.js`, `js/mcp/mcp-paths.js`, `js/mcp/mcp-consent.js`.

## Server

- Entry: `package.json` → `"sviber-mcp": "js/mcp/mcp-main.mjs"` → `startMcpStdio()`.
- Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout. Methods: `initialize`, `initialized` / `notifications/initialized`, `tools/list`, `tools/call`, `ping`. Unknown methods → `-32601`. Tool errors → `-32000` with the error message. **Stdout is protocol-only**; logs go to stderr.
- Backend: Unix/TCP-style socket per editor at `~/.sviber/${pid}.sock` (`SVIBER_DIR_NAME = ".sviber"`, path not customizable).
- First connection: editor shows a consent popup. Warning text: *Allowing this connection makes it possible to make undoable modifications to the chart from outside the editor.*
- `instance` argument is the editor **pid** as a string. Required on every tool except `list_instances`.

## Tool catalogue (exactly 12)

| Tool | Required args | Optional | Returns / notes |
| --- | --- | --- | --- |
| `list_instances` | — | — | Running editor instances (pids). |
| `get_open` | `instance` | — | Whether a chart or project is open and its local path. |
| `list_macros` | `instance` | — | `{ global: [...], project: [...] }` with name/id/filename descriptors. |
| `read_macro` | `instance`, `name` | — | Descriptor + `code`. Match by name, id, or filename. |
| `create_macro` | `instance`, `name`, `code` | `scope` (`global`\|`project`) | Creates macro. Project macros need NW.js project file APIs. Name must be unique for global. Handler defaults language to **javascript** unless `language === "ruby"` (language is not in the advertised schema). |
| `rename_macro` | `instance`, `name`, `newName` | — | Renames; project macros rename the file too. |
| `edit_macro` | `instance`, `name`, `code` | — | Replaces source in place. |
| `run_macro` | `instance`, `name` | — | Runs stored macro; returns `{ stdout, stderr, modified }`. |
| `run_snippet` | `instance`, `code` | `language` | Runs ad-hoc code; same return shape. **Ruby rejected** (see below). |
| `run_expression` | `instance`, `code` | `language` | Wraps `return (code);`; returns `{ value, modified }`. `value` is JSON-ified (`toJSON` when present). |
| `undo_last_run` | `instance` | — | Undoes the last MCP-initiated **modifying** run. Fails if none (`no MCP-initiated modifying run to undo`). Clears the flag after one undo. |
| `get_music_snippet` | `instance`, `start`, `end` | `maxInline` | Audio between two beat times. Base64 when small, local path when large. Needs loaded music (`no music loaded` otherwise). `start`/`end` go through `snippetSeconds`. |

## Run pipeline (important)

`handleRunMacro` / `handleRunSnippet` / `handleRunExpression` all call `runAndApply`:

1. Reject if `app.model.editor.readOnly` → `The chart is read-only.`
2. Reject Ruby: `Ruby MCP runs require a live editor sandbox`. **MCP is JavaScript-only for execution.**
3. Snapshot chart state (`app.model.snapshot()`).
4. Run JS via the same `createSviberMacroApi` used by the in-editor sandbox (`js/mcp/mcp-macro-run.js`).
5. Compare core chart fields (`events`, `channels`, `snappees`, `timing`, `metadata`, `music`, `image`, `currentTime`, `currentChannel`) before/after.
6. If changed: `app.commit("MCP macro", model => model.restore(state))` (or `model.restore`) and set `app.mcpUndoAllowed = true`.
7. Return logs and `modified`. Expression runs also return `value`.

`undo_last_run` calls `app.undo()` once and clears `mcpUndoAllowed`.

## Practical agent guidance

- Always `list_instances` → `get_open` before mutating.
- Prefer `run_expression` for probes (`Chart.events.length`, selection size, channel names).
- Prefer short `run_snippet` mutations with `console.log` diagnostics rather than one giant script.
- After a bad mutation with `modified: true`, call `undo_last_run` immediately before more edits.
- Do not claim Ruby execution over MCP. If the user needs Ruby, either convert the logic to JS for MCP or tell them to run F8 in the macro window.
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
- `Ruby MCP runs require a live editor sandbox`
- `no MCP-initiated modifying run to undo`
- `no music loaded`
