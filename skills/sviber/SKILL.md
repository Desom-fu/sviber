---
name: sviber
description: Use sviber-mcp and the sviber macro system to assist Sunniesnow charting. Trigger when the user mentions sviber, sviber-mcp, Sunniesnow charting, chart macros, placing/transforming notes in a running sviber editor, tip points, snappees, or bilingual/Japanese charting terminology. Do not use for Lyrica-only charts, unrelated DAW work, or when no sviber editor instance is available.
---

# sviber skill

Talk to a running **sviber** chart editor through the `sviber-mcp` MCP server, then drive chart edits with the sandboxed JavaScript or Ruby macro API.

sviber is a browser/NW.js chart editor for [Sunniesnow](https://sunniesnow.github.io/game-unstable).

Charts are a strict subset of the Sunniesnow format:

- Notes: tap, hold, drag, flick (one angle)
- Background: bg notes, big text, background patterns
- Structure: comments, groups
- Timing: offset, initial BPM, BPM changes, bar lines
- Geometry: channels, snappees (meshes/curves), tip points

Coordinates use the Sunniesnow chart system (playfield about `x ∈ [-100, 100]`, `y ∈ [-50, 50]`).

## What each reference file is for

Read only what the current step needs.

### references/mcp-tools.md

Read **before any `sviber-mcp` tool call**.

Covers:

- Server entry and JSON-RPC surface
- Socket path `~/.sviber/${pid}.sock` and consent popup
- The exact 12 tools and their arguments
- Run pipeline (`readOnly` gate, JS/Ruby execution, modify detection, undo flag)
- Practical agent loop and real error strings

### references/macro-system.md

Read **before writing or editing a macro**.

Covers:

- JavaScript vs Ruby sandbox model
- camelCase / snake_case mapping
- Beat, angle, and color value rules
- Chart, Location, TipPoint, Vector2D, AffineMatrix2D
- BpmChange, BarLine, Channel, Snappee
- Event classes, capability predicates, flags, fields
- Clips, top-level helpers (`b`, `t`, `h`, `d`, `f`, `g`, `copy`, `transform`, …)
- Id allocation, deleted-wrapper lifetime, apply-time validation

### references/mechanics.md

Read **before reasoning about Sunniesnow or sviber behavior**.

Covers:

- Document model and default Playfield grid
- Full event-type capability table
- Active vs inactive vs hidden (channel and event)
- Snappee attach/detach rules
- Tip-point spawn types, tracks, and switches
- Group translate vs anchor
- Checks ignore rules
- What is Sunniesnow-facing vs editor-only state

### references/capabilities.md

Read **when unsure whether a request is possible**.

Covers:

- What macros can do
- What only MCP can do
- Hard cannot-do lists (sandbox, MCP, product limits)
- Failure modes and recovery table
- Agent policy (never invent tools)

### references/examples.md

Read **when drafting concrete code**.

Covers:

- Probe expressions
- Placement, hold sequences, groups, copy/transform
- Tip-point switches, flick angles
- Full Ruby example (also MCP-runnable)
- Typical agent loop and anti-patterns

### references/terms.md

Read **when translating or matching UI language**.

Covers:

- EN / 简体中文 / 日本語 tables for core nouns, workspace, channels, events, tip points, macros
- Capability-query glosses
- Direction-name table
- JS↔Ruby API name cheat sheet
- Known bad ja UI strings and how to say them correctly

## Connect (always do this first)

1. Confirm one or more sviber editor windows are running.
2. Start `sviber-mcp` (same Node runtime as the packaged NW.js app; `package.json` bin maps it to `js/mcp/mcp-main.mjs`).
3. It speaks MCP JSON-RPC on stdio: `initialize`, then `tools/list` / `tools/call`.
4. **Stdout is protocol-only.** Logs belong on stderr.
5. Each editor listens at `~/.sviber/${pid}.sock` (not customizable).
6. The first connection shows an allow/deny popup.
7. Allowing makes **undoable** chart edits from outside the editor possible.
8. Call `list_instances`, pick an `instance` (the pid), then `get_open`.
9. Every tool except `list_instances` requires `instance`.

## Preferred workflow

1. `list_instances` → `get_open` → `list_macros`.
2. Prefer **read-only** probes first: `run_expression` for counts/selection.
3. Use `run_snippet` only when mutating.
4. Prefer **JavaScript** for simple MCP probes. **Ruby is also supported** over MCP (`run_macro` / `run_snippet` / `run_expression` accept `language: "ruby"`); it runs through the same `@ruby/wasm-wasi` + `macro-api.rb` surface as the editor sandbox. First Ruby run may take ~1s while wasm boots.
5. In-editor F8 still runs Ruby in the iframe sandbox.
6. Mutate with small snippets; check `stdout`, `stderr`, and `modified`.
7. If a modifying run went wrong and `modified` was true, call `undo_last_run`.
8. For audio alignment, use `get_music_snippet` (base64 or local path when large).

## Hard rules

- Macros run on a **copy** of the chart.
- A successful run becomes **one undoable history step**.
- Raises or invalid chart data → error reported, **nothing applied**.
- Wrapper objects die after `delete`; later use raises (`has been deleted`).
- There is **no** `#haveDuration?` / `haveDuration` and **no** `#haveText?` / `haveText`.
- Use `perdurant` and `textable` instead.
- JS beats: number, `[numerator, denominator]`, or `[whole, numerator, denominator]`.
- Ruby beats: **Integer or Rational only** (no Float).
- JS is camelCase; Ruby is snake_case.
- Examples: `currentTime` / `current_time`, `tipPoint` / `tip_point`, `bgNote` / `bg_note`.
- Macros cannot open/save files, change preferences, play audio, render video/cover, use the network, or touch the OS.
- The sandbox has no filesystem access.
- Do not invent MCP tools beyond the 12 in `js/mcp/mcp-tools.js`.
- Do not invent undocumented sandbox globals.

## Quick capability map

### Can place/edit via macros

- Events of every supported type
- Channels
- Snappees
- Clips
- BPM changes and bar lines
- Tip points and tip-point switches
- Groups
- Affine transforms
- Selection-aware copies at current time/channel

### Cannot via macros/MCP

- File open/save/export
- Editor preferences
- Audio playback
- Render/export UI
- Network
- OS access
- Raw chart object access
- Anything outside sandboxed chart state

## Channel index footguns

- `Channel.get(n)` is **1-based** (or by name).
- `Snappee.get(n)` is **0-based** (or by name).
- Do not mix them.

## Term notes (summary)

Full EN / 中文 / 日本語 tables live in [references/terms.md](references/terms.md).

Start with:

| English | 中文 | 日本語 |
| --- | --- | --- |
| Chart | 谱面 | 譜面 |
| Channel | 通道 | チャンネル |
| Event | 事件 | イベント |
| Snappee | 吸附器 | スナッピー |
| Tip point | 提示点 / 游标 | チップポイント |
| Macro | 宏 | マクロ |
| Perdurant | 有持续时长 | 持続あり |
| Background pattern | 背景图案 | 背景パターン |
| Inactive | 停用 | 無効 |
| Hidden | 隐藏 | 非表示 |
| Charter | 谱师 | 譜面作者 |

## Checklist before you finish a charting task

1. Instance and open document confirmed.
2. Mutations used a supported language (JS or Ruby) over MCP.
3. Each mutation was small and logged.
4. Mistakes were undone with `undo_last_run` when applicable.
5. No claim was made about file I/O, render, prefs, or network from macros.
6. User-facing terms match [references/terms.md](references/terms.md) when translating.
