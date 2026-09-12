# Macro system

Sources: `js/macro/macro-api.js`, `macro-api-*.js`, `macro-sandbox.js`, `macro-api.rb`, `js/mcp/mcp-macro-run.js`, help manual Macros Interface.

## Languages and sandbox

- A macro is **JavaScript** or **Ruby**.
- Runs execute against a **deep-cloned copy** of chart state (`clone(sourceState)`), not the live document.
- Success → the resulting state is validated and applied as **one undoable history step**.
- Any raise / invalid data → error in the macro console (or MCP `stderr`) and **nothing is applied**.
- The sandbox has **no filesystem access**. Undocumented sandbox internals are not user-facing.
- JS runs as an `AsyncFunction` with API globals injected as parameters. `console.log/info/warn/error` are forwarded.
- Ruby runs in ruby.wasm (editor iframe sandbox for F8; MCP uses the Node `@ruby/wasm-wasi` runner with the same `macro-api.rb`).

## Naming

| | JavaScript | Ruby |
| --- | --- | --- |
| Style | camelCase | snake_case |
| Examples | `currentTime`, `tipPoint`, `bgNote`, `haveTime`, `bBang` | `current_time`, `tip_point`, `bg_note`, `have_time?`, `b!` |
| Type symbols | `event.type === "bgNote"` | `event.type == :bg_note` |
| Construction | `new Tap({...})` | `Tap.new(...)` / keyword args |

There is **no** API container object and **no** raw chart object. Names are top-level globals.

## Beats, angles, colors

**Beats (JS):** number, `[numerator, denominator]`, or file-format `[whole, numerator, denominator]`.
**Beats (Ruby):** **only** `Integer` and `Rational`. `Float` is invalid.

**Angles:** finite radians or direction names. Cardinal: `right`/`r`=0, `up`/`u`=π/2, `left`/`l`=π, `down`/`d`=-π/2. Diagonals: JS camelCase (`upLeft`/`leftUp`) and short aliases (`ul`/`lu`); Ruby symbols (`:up_left`/`:left_up`) plus the same short aliases.

**Colors:** hex integer or CSS color string; normalized. Named: red, green, blue, white, black, yellow, magenta, cyan, transparent.

## Core classes

### Chart (facade)

- `metadata` — **immutable/frozen** object: `title`, `artist`, `charter`, `difficulty_name`, `difficulty`, `difficulty_color`, `difficulty_sup`, `music`, `image`. Macros cannot write metadata through this object.
- `currentTime` — read/write beat; sets editor time snapped.
- `channels`, `currentChannel`, `snappees`, `selectedSnappee`, `clips`, `events`, `selectedEvents`.
- `offset`, `initialBpm` — read/write numbers.
- `bpmChanges`, `barLines`.

### Location

- `new Location(x, y)`, `Location(curve, i)`, `Location(mesh, i, j)` — curve form needs exactly one integer index; mesh form two.
- `pos` → `Vector2D`; `attached` / `attach` / `detach`; read/write `snappee`, `x`, `y`.
- `attach` snaps to the nearest point among **active** snappees.
- Assigning a snappee attaches to its nearest point; assigning null or either coordinate detaches.

### TipPoint

- Factories: `inherit`, `none`, `chain({distance, angle, location, timeSeconds, timeBeats})`, `drop({...})`.
- Relative mode: `distance` + `angle`. Absolute mode: `location`. Setting one clears the other.
- Time: seconds **or** beats, not both. JS helpers `tpc` / `tpd` accept `(location, time)` or `(distance, angle, time)`; fractional JS number or Ruby `Float` means seconds; integral/rational means beats.
- Absolute/relative predicates: `absolute`/`relative` (+ Ruby `?` forms).

### Vector2D / AffineMatrix2D

- `Vector2D`: read/write `x`,`y`; JS `add/sub/mul/div`; Ruby `+ - * /` and `to_ary`.
- `AffineMatrix2D(a,b,c,d,tx,ty)`: `translate`, `scale`, `rotate`, `compose`, `horizontalFlip`/`horizontal_flip` (also `flipHorizontally`), vertical counterparts. Mutates and returns self.

### Timing

- `BpmChange(time, bpm)` — read `time`, read/write `bpm`, `delete`, `list`.
- `BarLine(time)` — read `time`, `delete`, `list`.

### Channel

- `new Channel({name, color})`; `get` (1-based number **or** name), `getById`, `current`, `list`.
- `Channel.tipPointSwitch(time, map)` — `map` is a permutation of channels at that beat (object/Map by id or Channel). Implements tip-point track switches (`js/core/tip-point-track.js`).
- Instance: reorder `moveUp`/`moveDown`, name/color, `id`, `activate`/`deactivate`, `active`/`active?`/`active=`, `current`/`current?`, `select`, `delete`, top-level non-group `events`. Serialize: JS `toJSON`, Ruby `to_h`/`to_json`.

### Snappee

Concrete constructors:

- Mesh: `RectangularMesh(tlX,tlY,brX,brY,hTiles,vTiles)`, `RadialMesh(cx,cy,radius,azTiles,radTiles,startAngle)`, `ParametricMesh(iRange,jRange,xExpr,yExpr)`.
- Curve: `RegularPolygonCurve(cx,cy,radius,angle,sides,segmentsPerSide)`, `BezierCurve(degree,controlPoints,segments)`, `PenCurve(commands,segments,closed)`, `ParametricCurve(iRange,xExpr,yExpr)`.
- JS: append `{name, color}`. Ruby: keyword args.
- Lookup: `get` is **0-based** number or name (channels are 1-based — do not mix).
- Instance: reorder, name/color, activate/deactivate/selected/select, `pos(i)` or `pos(i,j)`, `duplicate`, `delete`, serialize.
- `Snappee.list`, `Snappee.selected`, `Snappee.deselect`.

### Events

Create with `new Event({type, ...})` / named classes: `Tap`, `Hold`, `Drag`, `Flick`, `BgNote`, `BigText`, `Grid`, `DiamondGrid`, `Hexagon`, `Checkerboard`, `Pentagon`, `Turntable`, `Hexagram`, `Comment`, `Group`.

`Event.list` ≡ `Chart.events`; `Event.selection` ≡ selected events (including nested group descendants that are selected).

**Capability predicates** (there is no `haveDuration` / `haveText`):

| Predicate | True for |
| --- | --- |
| `movable` | tap, hold, drag, flick, bgNote, group |
| `haveTime` | non-group with time, or group (earliest descendant) |
| `haveChannel` | non-group with a channel |
| `perdurant` | hold, bgNote, bigText, patterns, comment |
| `textable` | tap, hold, flick, bgNote, bigText, comment |
| `tipPointable` | tap, hold, drag, flick |
| `group` | group |
| `background` | bgNote, bigText, patterns |

**Flags:** `locked`/`lock`/`unlock`, `active`/`activate`/`deactivate` (`active` defaults true; `active === false` is the inactive draft state).

**Fields (only when capability allows):**

- `location` — movable events; **group `location` assignment translates every movable descendant**.
- `anchor` — groups only; does **not** translate children.
- `text`, `angle` (flick only), `time`, `channel` (not groups), `events`/`color` (groups only).
- `tipPoint` / `tp` — tip-pointable only.
- Group `time` is the earliest descendant time; assigning a new time **translates all descendant times** by the delta.
- Changing `type` rebuilds fields for the destination type (invalid fields stripped).
- `delete` removes the event and **invalidates** the wrapper.

### Clip

`new Clip(events, name)` / `Clip.get(n)`. `moveUp`/`moveDown`, name, `delete`, `paste(time, channel)`, serialize. Paste returns new event wrappers. Clip payload stores relative times/channels plus referenced channels and snappees (version 1).

## Top-level helpers

| JS | Ruby | Effect |
| --- | --- | --- |
| `b()`, `b(n)`, `bBang()`, `bBang(n)` | `b`, `b(n)`, `b!`, `b!(n)` | Read / advance / set `Chart.currentTime`. |
| `bpm(value)` | same | Create/update BPM change at cursor. |
| `c(name)` | same | Get-or-create channel by name and **select** it. |
| `s(n)` | same | Get snappee. |
| `l(...)` | same | New `Location`. |
| `tpc` / `tpd` | same positional forms | Chain / drop tip points. |
| `t(location, text="")` | same | Tap at current time/channel. |
| `h(location, duration, text="")` | same | Hold. |
| `d(location)` | same | Drag (no text/angle/tip point). |
| `f(location, angle, text="")` | same | Flick. |
| `bgNote(location, duration=0, text="")` | `bg_note` | Bg note; lone string in duration slot is treated as text. |
| `bigText(duration, text="")` | `big_text` | Big text. |
| `grid` / `diamondGrid` / `hexagon` / `checkerboard` / `pentagon` / `turntable` / `hexagram` | snake_case forms | Background patterns at current time/channel. |
| `g(events, color)` or `g(color, callback)` | `g(...) { ... }` | Group supplied or newly created events; default group color `#ff9d3d`. |
| `copy(events)` | same | Copy at current time/channel, preserving relative time and channel **order**. Not system clipboard; not chart clips. |
| `transform(things, matrix\|callback)` | same | Affine transform of events **or** snappees (cannot mix). Transforms locations, flick angles, and chain/drop tip-point vectors/positions together; attached positions become free coordinates. |

## Ids and lifetime

- Ids allocate per collection; event ids consider nested group descendants.
- Deleting a BPM change, bar line, channel, snappee, event, or clip marks `__deleted`; any later wrapper use throws `... has been deleted`.
- Positions are **not** clamped to the chart boundary. Invalid chart data is rejected at apply time (nothing applied).

## What macros can do

Place and edit every supported event type; create/reorder/delete channels and snappees; write BPM changes and bar lines; tip-point fields and channel tip-point switches; groups and clips; selection-aware copies; affine transforms; read chart/metadata/selection; print to the console; move the current time/channel.

## What macros cannot do

Open/save files, import/export, change editor preferences, play audio, render video or covers, talk to the network, touch the OS, access the filesystem, mutate `Chart.metadata`, or call undocumented sandbox internals as a stable API.
