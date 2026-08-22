# PROMPT v14 implementation

This release implements every added or changed hunk in `PROMPT-v14.md` relative to `PROMPT-v13.md`. Version metadata is `0.5.0`.

## Hunk → change map

| v13→v14 hunk | Implementation | Verification |
| --- | --- | --- |
| Shift+wheel scrolls timeline channels even outside the timeline canvas, unless the pointer is in a scrollable DOM element | `isScrollableDomTarget()` in `js/app-helpers.js`; global `wheel` handler in `js/app-core.js`; `TimelineView.scrollChannelsBy()` in `js/render/timeline.js` | `tests/v14-features.test.mjs`; browser `runV14BrowserChecks` |
| Alt+Up/Down/number/0 channel changes do not exit event-creation mode | Command-mode subscriber skips `channel.select*` | `tests/v14-features.test.mjs` asserts the skip in `app-core.js` |
| Status checkbox Rulers (`rulers.svg`), default off | `editor.showRulers` in `ChartModel`; checkbox in `index.html`; icon `svg/icons/rulers.svg` | Default-off round-trip test; browser checkbox |
| Rulers: top+left, white inside chart, light-gray outside, dark-gray ticks/numbers, noticeable triangle marker, zoom-dependent scales | `StageView._drawRulers()` in `js/render/stage-notes.js` | Structural test + browser ruler toggle |
| Main-field group rings larger than the note body | Group ring radius `noteRadius + 6 + index * 4` | `tests/v14-features.test.mjs` |
| Selected-snappee attach ring in the snappee's color, same size rule | `_drawSnappeeAttachRings()` | Structural test |
| HUD top-left pause button = play/pause, lower hit priority than events/snappees | Drawn in `_drawHud`; hit type `hud-pause` last in `_hitTest`; `onHudPause` → `music.playPause` | Browser HUD pause region |
| Scroll-view x-range = Sunniesnow default play-field width (250) | `SUNNIESNOW_PLAYFIELD_WIDTH` in `js/render/stage-helpers.js`; mapping in `js/render/scroll-view.js` | Existing playfield-scale tests plus mapping change |
| Scroll-view A-B blue lines and translucent band | `#drawAbLoop()` | Structural + help |
| File menu Export Lyrica chart... | `file.exportLyrica` in `js/commands.js`; `exportLyrica()` in `js/app-file-workflows.js` | Command/menu tests |
| Import accepts JSON, `.ssc`, and Lyrica `.txt` | `accept` on `#open-file-input`; `FileManager.parseFile` | Import tests |
| Lyrica import dialog: Charter, PRNG seed, Quantization denominator | `requestLyricaImportOptions()` | i18n + help |
| Every Lyrica channel → one sviber channel; disabled → inactive | `importLyricaChart()` | Import unit test |
| Spawn absolute iff determined by a main-channel event position; beats iff determined by an event time | `evaluateLyricaSpawn()` flags + `spawnFields()` | Spawn unit test |
| Export: sole-event chains → independent; pack multi-event onto main+normal; dump a whole chain to no-tip-point if **more than four** multi-event tip points coincide, minimizing dump | `assignLyricaExportChannels()` (four slots: main + three normal) + `exportLyricaChart()` | Export unit test: four overlapping chains stay packed; a fifth dumps |
| Never pick random Lyrica spawn types; closest spawn position; ignore spawn time | `chooseClosestNonRandomSpawn()` / `deterministicSpawnCandidates()` | Export test forbids `b` 2/3/4 |
| `bar-line.svg` on Bar line | Command icon + `svg/icons/bar-line.svg` | Command test |
| Move to channel above/below live only under Channel (with separators), not Events | `MENU_DEFINITION` | Command test |
| Newly created rectangular mesh is selected immediately | `showSnappeeDialog` selects the created snappee | Implementation + help |
| Free-transform translation, scaling, **and rotation** clamp to the chart rectangle | `clampAffineToChartBounds()` interpolates rotation angle | `tests/core.test.mjs`, `v12-features`, `v14-features` |
| Inspector matrix numbers update live; Enter submits that element | Already shipped in v0.4.4; retained | Existing v0.4.4 tests |
| Other subdivisions shortcut `0` | `music.subdivisionOther` | Command + help `<kbd>0</kbd>` |
| Hit effects disappear immediately when music stops | `StageView.clearHitEffects()` on pause/ended | `sunniesnow-render-parity` + `v14-features` |
| Toolbar lists Bar line plus Channel move items | `TOOLBAR_ITEMS` | Command test |
| inherit/none hide every tip-point field except spawn type | Inspector `spawnFieldsEnabled` | Existing hide tests + help |
| inherit → chain/drop fills inherited spawn params if any, else defaults | `js/core/tip-point.js` | Inherit fill unit test |
| Macros window including console follows main theme | `theme-dark`/`theme-light` classes; console uses theme CSS variables | `macros.css` + theme bootstrap |
| New... defaults scope to current tab and language to last choice (Ruby if none) | `newMacro()` in `js/macros.js` | Structural test |
| Extra undocumented functions/classes are not user-facing | Unchanged v13 sandbox surface | Existing v13 manual test |
| Lyrica chart format section (header `|` fields, `#1`–`#4`, type tables, ignore 11/12/13 and anomalous properties, first-event / `b'`/`c'` / spawn table / non-independent spawn-time clamp; two `b=4` rows = random row) | `js/core/lyrica.js` | Parse/import/export tests |
| Per-frame Bézier/pen/free-transform + ≤1 frame drop on edits | Retained v13 hot-path work | Existing perf tests; no fake oracle |
| Chinese calls Lyrica "阳春白雪" | `json/i18n.zh-CN.json` and ZH manual | Localization test |
| Non-coprime beat numerator/denominator accepted and auto-reduced | `canonicalizeRationalTuple()` + `validateField` | `v14` + updated `v9` tests |

## File layout notes

- Lyrica convert is a DOM-free module (`js/core/lyrica.js`) so `node:test` feeds `.txt` strings and chart snapshots into the shipped functions.
- Icons live in `svg/icons/` (`rulers.svg`, `bar-line.svg`). The staging `new-icons-7/` copies were removed so the source-size check stays clean.
- Help (EN/ZH) and the in-app shortcut overlay (from `COMMAND_DEFINITIONS`) describe Export Lyrica, Lyrica import fields, Rulers, HUD pause, Channel move-to-channel, Other subdivisions `0`, and 阳春白雪.

## Verification

- `node scripts/check-source-size.mjs`: passed.
- `node --test tests/*.test.mjs`: 191 passed after the dump-threshold wording update (same 191 as the earlier full-suite runs).
- Browser harness extended in `scripts/verify-browser-v14.mjs` for Rulers, HUD pause, toolbar Channel items, and channel-offset helper.

## Second prompt-diff audit

Re-read `git diff --no-index PROMPT-v13.md PROMPT-v14.md` after the working-copy wording change (`e2562af` → `9b4cbeb`: dump when **more than four** multi-event tip points coincide). Every added or changed hunk still maps to shipped code; no extra convert/placeholder path was added.

The only prompt delta since the first v0.5.0 commit is that dump threshold. `LYRICA_MULTI_TIP_CHANNELS` already has four slots (`-60`, `-40`, `-20`, `0`); `assignLyricaExportChannels()` ranks multi-event chains by length descending so the shortest leftover chain is dumped. Four overlapping chains dump nothing; a fifth overlapping chain dumps one chain.

Prompt typos left unchanged: `clarificastion`, `Remoeve`, `trangle`, `tranlating`. They are not behavior changes.
