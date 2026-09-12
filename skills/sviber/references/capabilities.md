# What macros and MCP can and cannot do

This file is the hard capability boundary. If a request is outside **Can**, do not invent workarounds that pretend it is possible — tell the user and offer the closest legitimate alternative.

## Can (via macros)

1. **Create / edit / delete events** of every supported type (tap, hold, drag, flick, bgNote, bigText, seven background patterns, comment, group).
2. **Set event fields** valid for that type: time, channel, location/attached snap point, duration, text, flick angle, tip-point spawn (type, relative distance/angle or absolute location, time in seconds or beats), lock, active, selection as left by constructors (new events start `selected: true`).
3. **Create / rename / reorder / delete channels**; activate/deactivate; select current channel; read channel events.
4. **Write tip-point switches** at a beat via `Channel.tipPointSwitch(time, map)`.
5. **Create / edit / reorder / delete snappees** (all mesh/curve types exposed in the macro API); sample positions with `pos`; duplicate; select; activate/deactivate.
6. **BPM changes and bar lines**: create, read, change BPM, delete.
7. **Timing facade**: read/write `Chart.offset`, `Chart.initialBpm`, `Chart.currentTime`.
8. **Groups**: nest, color, translate via location/time, manage children; helpers `g(...)`.
9. **Clips**: capture event sets into clips, paste at a time/channel, reorder, delete.
10. **Copy & transform**: `copy` at current time/channel (relative structure preserved); `transform` with `AffineMatrix2D` over events or snappees (not mixed arrays).
11. **Read**: metadata (immutable), collections, selection, snappee selection.
12. **Console**: JS `console.*` / Ruby `puts` / stderr for agent-visible diagnostics.
13. **Undo granularity**: one successful macro/MCP modifying run = one editor undo step; MCP can `undo_last_run` once while the flag is set.

## Can (via MCP tools only)

- Discover instances and open document path.
- List/read/create/rename/edit macros (global or project).
- Run **JavaScript and Ruby** macros, snippets, and expressions against the live editor.
- Undo the last MCP-initiated modifying run.
- Extract a music snippet between two beat times (base64 or file path).

## Cannot (macros — sandbox / API limits)

- Open or save chart/project files; import/export Sunniesnow or Lyrica.
- Change editor **preferences** (theme, language, volumes, autosave, note speed, etc.).
- Play audio, seek playback as a player, or trigger SE.
- Render video, covers, or screenshots.
- Network access of any kind; OS/fs/process access.
- Mutate `Chart.metadata` (frozen facade).
- Access a raw chart object or stable undocumented sandbox internals.
- Clamp or freely place positions outside chart bounds during the run — positions are **not** constrained; only apply-time validation can reject the whole result.
- Keep using a wrapper after its entity is deleted (raises).
- Use `haveDuration` / `haveText` (do not exist).
- Use Float beats in Ruby.

## Cannot (MCP-specific)

- Edit while the chart is `readOnly`.
- Undo more than the single last MCP modifying run via `undo_last_run`.
- Customize the socket path (`~/.sviber/${pid}.sock` only).
- Bypass the consent popup (user must allow the connection).
- Call tools that are not in the 12-tool catalogue.
- Play music or perform live hosting / render / file dialogs.

## Cannot (Sunniesnow / product reality)

- Multi-note flick angles — flick has **one** angle.
- Per-event tip points on bg notes or patterns — only tap/hold/drag/flick are tip-pointable (import even warns and omits bgNote tip points).
- Making inactive channels “participate” in checks/playback without activating them.
- Treating hidden channels as absent from checks (hidden is UI-only).

## Failure modes and recovery

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Macro raises | Bad API use, deleted wrapper, invalid types | Fix code; nothing was applied. |
| Invalid chart data rejected | Apply-time validation failed | Nothing applied; inspect fields. |
| `The chart is read-only.` | Editor read-only | User must unlock. |
| `ruby.wasm binary is unavailable.` | Missing wasm/runtime | Reinstall deps or check `@ruby/4.0-wasm-wasi`. |
| `no MCP-initiated modifying run to undo` | Flag cleared or no modify | Re-run a modifying snippet if needed. |
| `macro not found` | Wrong name/id/filename | `list_macros` again. |
| `project macros are unavailable` | No NW.js project | Use `scope: global`. |
| `no music loaded` | Empty audio | User sets music in editor. |
| Consent denied | User rejected socket | User must allow; reconnect. |

## Agent policy

1. Never claim a macro can save files, export, render, or hit the network.
2. Prefer small reversible snippets; use `undo_last_run` promptly on mistakes.
3. When the user wants file/export/render/prefs work, say macros cannot do it and point them to the editor UI (or stop at chart-state edits).
5. When positions look out of bounds, they may still be applied unless validation rejects them — do not assume silent clamping.
