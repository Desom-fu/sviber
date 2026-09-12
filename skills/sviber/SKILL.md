---
name: sviber
description: Use sviber-mcp and the sviber macro system to assist Sunniesnow charting.
---

# sviber skill

Talk to a running **sviber** chart editor through the `sviber-mcp` MCP server. The editor is a desktop-style Sunniesnow chart maker. Charts are a strict subset of the Sunniesnow format: taps, holds, drags, flicks (one angle), bg notes, big text, background patterns, comments, and groups.

## Connect

1. Start one or more sviber editor windows.
2. Run `sviber-mcp` (same Node runtime as the NW.js app). It speaks MCP JSON-RPC on stdio (`initialize`, then `tools/list` / `tools/call`). Stdout is protocol-only.
3. Each editor listens at `~/.sviber/${pid}.sock` (this path cannot be customized). The first connection shows an allow/deny popup. Allowing makes **undoable** chart edits from outside the editor possible.
4. Every tool except `list_instances` needs an `instance` (the pid).

## Tools

- `list_instances` — running editors
- `get_open` — chart vs project and the local path
- `list_macros` / `read_macro` / `create_macro` / `rename_macro` / `edit_macro`
- `run_macro` / `run_snippet` — stdout and stderr
- `run_expression` — JSON return value
- `undo_last_run` — only if the last MCP-initiated run actually modified the chart
- `get_music_snippet` — audio between two beat times, as base64 or a local path when large

## Macro system

Macros are JavaScript or Ruby. They run in a sandbox against a copy of the chart. A successful run is one undoable history step inside the editor; MCP-initiated runs can also be undone with `undo_last_run` when they changed the chart.

Ruby is snake_case (`current_time`, `perdurant?`). JavaScript is camelCase (`currentTime`, `perdurant`). Beats in Ruby are `Integer` or `Rational` only.

### Chart

`Chart.metadata` is an immutable `Data`/`frozen` object: `title`, `artist`, `charter`, `difficulty_name`, `difficulty`, `difficulty_color`, `difficulty_sup`, `music`, `image`. Also `current_time`, `channels`, `current_channel`, events, snappees, clips, offset, BPM, bar lines.

### Channels

`Channel.tip_point_switch(time, map)` where `map[channel]` is the image channel. `#active` / `#active=` plus `activate` / `deactivate` / `active?`.

### Events

Capabilities: `movable?`, `have_time?`, `have_channel?`, `perdurant?`, `textable?`, `tip_pointable?`, `group?`, `background?`. There is **no** `#have_duration?` or `#have_text?` (and no JS `haveDuration` / `haveText`).

Lock: `locked`, `locked=`, `lock`, `unlock`, `locked?`. Active: `active`, `active=`, `activate`, `deactivate`, `active?`. `#tp` / `#tp=` alias `#tip_point`. Time assignment is for events other than `group`; groups translate descendants.

### What macros can do

Place and edit events, channels, snappees, clips, BPM/bar lines, tip points, groups, transforms. Print to the macro console.

### What macros cannot do

Open/save files, change editor preferences, play audio, render video/cover, talk to the network, or touch the OS. After a wrapper is deleted, using it raises. Positions are not clamped to the chart boundary; invalid results are rejected and nothing is applied.

## Sunniesnow / sviber mechanics (short)

- Coordinates are the Sunniesnow chart system (see `doc/chart.md` on the website).
- Tip-point tracks follow switches; spawn types are inherit / chain / drop / none.
- Inactive channels and inactive events are drafts: they stay on the timeline but leave the stage, heatmap, checks, and (for channels) filters.
- Hidden channels collapse out of the timeline only.
- Perdurant events have duration tails; background events are patterns plus bg notes and big text.

## Term notes

| English | 中文 | 日本語 |
| --- | --- | --- |
| Chart | 谱面 | 譜面 |
| Channel | 通道 | チャンネル |
| Event | 事件 | イベント |
| Snappee | 吸附器 | スナッピー |
| Tip point | 提示点 / 游标 | チップポイント |
| Bookmark | 书签 | ブックマーク |
| Spectrogram | 频谱图 | スペクトログラム |
| Subdivision | 细分 | 細分 |
| Macro | 宏 | マクロ |
| Perdurant | 有持续时长 | 持続あり |
| Textable | 可带文本 | テキスト可 |
| Background pattern | 背景图案 | 背景パターン |
| Inactive | 停用 | 無効 |
| Hidden | 隐藏 | 非表示 |
| Charter | 谱师 | 譜面作者 |
