# PROMPT v15 implementation

This release implements every added or changed hunk in `PROMPT-v15.md` relative to `PROMPT-v14.md`. Version metadata is `0.6.0`.

## Hunk → change map

| v14→v15 hunk | Implementation | Verification |
| --- | --- | --- |
| Show HUD checkbox (`show-hud.svg`), default on | `editor.showHud`; status checkbox; `_drawHud` / progress seek gated | `tests/v15-features.test.mjs` |
| Enter in inspector applies the focused field | `keydown` Enter on inspector inputs, rationals, expressions, angles | Source + help |
| Matrix 6 fields in 3-column conventional form | Already shipped in 0.5.4 (`AFFINE_MATRIX_GRID`) | Existing v14 tests |
| File: Open recent... | Recent list in `localStorage`; picker opens chart/project | Command/menu tests |
| File: Open auto-save... | `AutosaveManager.listed()` + picker | Unit test lists older saves |
| Lyrica import: difficulty fields + default charter RNOVA | `requestLyricaImportOptions()` uses chart defaults and color listener | Import test |
| All official Lyrica channels created; names are channel numbers | `lyricaChannelName()` returns `"-60"` etc. | Import test |
| Channel 100 imported as inactive bg-note channel | `LYRICA_BG_NOTE_CHANNELS` includes 100; inactive on import | Import test |
| Simultaneous taps export as type 2 | Already shipped in 0.5.4 | Existing v14 export test |
| Macros: Run macro... | Radio global/project + sandbox run | Command/menu tests |
| Live-hosting connect/disconnect toast with client IP | `LiveHosting` stores `client.address`; toasts on connect/close | Implementation + i18n |

## Prompt wording

“Every Lyrica channel (not including those ever used…)” is implemented as: always create the official Lyrica channels, including unused ones, and name them by number.
