# sviber and Sunniesnow mechanics

Sources: `js/core/chart-vocabulary.js`, `chart-events.js`, `chart-model.js`, `tip-point-track.js`, `geometry.js`, `checks.js`, help manual, Sunniesnow schema reference.

## Document model

An editable chart is JSON with `sviber` extension: metadata, timing (offset, initial BPM, BPM changes, bar lines), channels, snappees, events, clips, checks, editor state, and `music` / `image` references. Sunniesnow export uses schema `https://sunniesnow.github.io/schema/chart-1.0.json`.

A new chart starts with an **active rectangular Playfield snappee** from `(-100, 50)` to `(100, -50)`, divided into **16 × 8** tiles. Chart bounds in code: `x ∈ [-100, 100]`, `y ∈ [-50, 50]`.

Offset is the **audio time of beat zero**. Initial BPM + ordered BPM changes convert beats ↔ seconds. Beat zero may lie before or after audio start.

## Event types (fixed vocabulary)

| Type | Movable | Duration | Text | Tip point | Background |
| --- | --- | --- | --- | --- | --- |
| `tap` | ✓ | | ✓ | ✓ | |
| `hold` | ✓ | ✓ | ✓ | ✓ | |
| `drag` | ✓ | | | ✓ | |
| `flick` | ✓ | | ✓ | ✓ (one `angle`) | |
| `bgNote` | ✓ | ✓ (default 0) | ✓ | | ✓ |
| `bigText` | | ✓ (default 1) | ✓ | | ✓ |
| `grid`, `hexagon`, `checkerboard`, `diamondGrid`, `pentagon`, `turntable`, `hexagram` | | ✓ (default 1) | | | ✓ |
| `comment` | | ✓ (default 0) | ✓ | | |
| `group` | ✓ (translates descendants) | | | | |

- Notes / hit objects: tap, hold, drag, flick.
- Background events: bgNote + patterns + bigText.
- Positive-duration defaults exclude bgNote and comment (those default duration 0).
- Groups have no time/channel of their own; they have `color` (default `#ff9d3d`) and child `events`.

## Channels vs events: active vs hidden

These are **different** flags (v25 / checks comments):

| Flag | Where | Meaning |
| --- | --- | --- |
| Channel `active === false` | channel | **Deactivated / draft lane.** Events stay on the timeline but leave the main field, scroll view, tip-point chains, hit sounds, checks, and selection filters. Inactive channels cannot be selected, made current, or dragged into. |
| Channel `hidden === true` | channel | **UI-only collapse.** The lane collapses out of the timeline. Checks still see active events on hidden channels. |
| Event `active === false` | event | **Inactive event draft.** Stays in the timeline; leaves main field, scroll view, tip-point chains, hit sounds; excluded from checks. |
| Event `locked` | event | Locks editing in the UI; macros can still set `locked`. |

Mental model: **inactive = draft content that checks and gameplay ignore; hidden = just hide the lane UI.**

## Snappees (attachable geometry)

Types: `rectangularMesh`, `radialMesh`, `parametricMesh`, `regularPolygonCurve`, `bezierCurve`, `circularArcCurve`, `penCurve`, `parametricCurve`.

- Events may be **attached** to a snappee via `snappee` + `snapPoint`, or free via `x`/`y`.
- Attaching follows the nearest snap point among **active** snappees.
- Location helpers: `Location(mesh, i, j)`, `Location(curve, i)`.
- Snappee lookup in macros: `Snappee.get` is **0-based**; `Channel.get` is **1-based**.
- Inactive snappees are skipped by `Location#attach`.

## Tip points (游标 / チップポイント)

Spawn types: `inherit` | `chain` | `drop` | `none`.

- **inherit** — continue the track that would hit this note.
- **chain** — spawn a connection from previous tip-point state.
- **drop** — spawn a disconnected / dropped tip point.
- **none** — no tip point.

Relative spawn: `distance` + `angle` from the note. Absolute spawn: `location` (free or attached). Time: `timeSeconds` **or** `timeBeats` (default ~1 second / 1 beat depending on mode; code defaults time to 1 and distance 100, angle π/2 when relative).

**Tip-point switches** (`Channel.tipPointSwitch`): a permutation of channels at a beat. A **track** T(C) concatenates tip-pointable events of the image of C under elapsed switches. Spawn inheritance follows the **track**, not the raw channel id. Inactive channels never contribute.

Checks related to tip points: short lifetime, sharp turn, teleport (same tip point, simultaneous notes must share position), drifting gaps.

## Timing and subdivision

- Beat times are rationals (`[whole, num, den]` in the file).
- Editor has subdivision snapping (default 2), current time, visible range, AB loop marks, metronome, playback speed.
- Timeline: waveform, beat lines, channel lanes, density heatmap (non-drag notes/sec), yellow current-time line, green range handles.

## Groups

- Nesting allowed (groups inside groups).
- Moving a group (`location =`) translates every movable descendant.
- Setting `anchor` does **not** translate children.
- Group time = earliest descendant time; assigning group time translates all descendant times by the same delta.

## Checks (quality gates)

All checks **ignore** inactive events, inactive channels, and comments. Typical checks include out-of-boundary notes (optional bgNote inclusion), short tip-point lifetime, sharp tip-point turns, teleporting tip points, drifting tip points. Macros do not run checks directly; invalid **structure** is rejected when applying macro state, but chart-quality check rules are editor features.

## Projects (NW.js only)

- Browser build edits one standalone chart.
- NW.js projects: manifest with `charts: [{file,id}]`, `activeChart`, `macros: [{file,name}]`.
- Project macros are `.js` / `.rb` files listed in the project. Global macros live in sviber storage.
- While the main editor is read-only: global macros stay editable, project editing controls disable, no macro can run (editor); MCP run also rejects read-only.

## What Sunniesnow cares about vs sviber-only

Sunniesnow-facing chart content: timing, channels, events (notes + bg + comments if exported), tip-point spawn fields, metadata, media references.

sviber-only editor state (not gameplay): UI prefs, visible ranges, spectrogram, bookmarks, checks config, clip library, hidden/selected flags, panel expansion, history.

When exporting, sviber maps to the Sunniesnow chart subset (and can also export Lyrica, which is out of scope for this skill unless the user asks).
