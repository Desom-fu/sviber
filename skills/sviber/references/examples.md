# Examples

These snippets are JavaScript (MCP-safe). Use them as templates; always probe with `run_expression` before large mutations.

## Probe the open chart

```js
// run_expression
({
  title: Chart.metadata.title,
  events: Chart.events.length,
  channels: Chart.channels.map(c => ({ id: c.id, name: c.name, active: c.active })),
  current: Chart.currentTime,
  channel: Chart.currentChannel && Chart.currentChannel.name,
  selected: Chart.selectedEvents.length,
  snappees: Chart.snappees.length,
})
```

## Place a tap on a named channel at beat 4

```js
// run_snippet
const ch = c("Main"); // get-or-create + select
bBang(4);
const note = t(l(0, 0), "center");
note.tipPoint = tpc(l(0, 80), 1); // chain tip point, 1 beat
console.log("created tap", note.type, "on", ch.name);
```

## Build a 4-beat hold sequence with subdivision

```js
// run_snippet
c("Main");
const mesh = new RectangularMesh(-100, 50, 100, -50, 16, 8, {
  name: "Macro grid",
  color: "#00e0ad",
});
for (let i = 0; i < 8; i++) {
  bBang([i, 2]); // half-beats: 0, 1/2, 1, ...
  const loc = new Location(mesh, i % 16, 4);
  if (i % 2 === 0) t(loc, `n${i}`);
  else h(l(40 - i * 5, 0), [1, 2], `h${i}`);
}
console.log("events now", Chart.events.length);
```

## Group a phrase and copy it forward

```js
// run_snippet
const main = c("Main");
bBang(0);
const phrase = g("#ff8800", () => {
  t(l(-20, 0), "a");
  b([1, 2]);
  t(l(0, 0), "b");
  b([1, 2]);
  t(l(20, 0), "c");
});
const copies = copy([phrase]); // at current time/channel — set cursor first
bBang(4);
const more = copy([phrase]);
console.log("first copy", copies.length, "second", more.length);
```

## Transform (translate + rotate)

```js
// run_snippet
const targets = Event.selection;
if (!targets.length) throw new Error("select events first");
transform(targets, m => m.translate(10, 0).rotate("right"));
console.log("transformed", targets.length);
```

## Tip-point switch at beat 8 (swap two channels)

```js
// run_snippet
const a = Channel.get(1);
const b = Channel.get(2);
Channel.tipPointSwitch(8, { [a.id]: b.id, [b.id]: a.id });
console.log("switch written");
```

## Deactivate drafts, then restore

```js
// run_snippet: mark selected events inactive
for (const e of Event.selection) e.deactivate();
console.log("deactivated", Event.selection.length, "(selection may shrink)");
```

```js
// undo_last_run via MCP if this was the last modifying run
```

## Flick angles

```js
// run_snippet
c("Main");
bBang(2);
const note = f(l(0, 0), "upLeft", "diagonal");
note.tp = tpd(100, "down", [1, 2]); // drop tip: 100 units down, 1/2 beat
console.log(note.angle, note.tp.relative, note.tp.timeInBeats);
```

## Expression-only checks (no mutation)

```js
// run_expression
Chart.selectedEvents.map(e => ({
  type: e.type,
  movable: e.movable,
  perdurant: e.perdurant,
  tipPointable: e.tipPointable,
  time: e.haveTime ? e.time : null,
}))
```

## Ruby equivalent (in-editor only — not MCP)

```ruby
main = c("Main")
mesh = RectangularMesh.new(-100, 50, 100, -50, 16, 8,
                           name: "Macro grid", color: 0x00e0ad)
b! 1
phrase = g(0xff8800) do
  note = t(Location.new(mesh, 8, 4), "center")
  note.tip_point = tpc(l(0, 80), Rational(1, 2))
  b Rational(1, 2)
  h l(40, 0), Rational(1, 2), "hold"
end
copies = copy([phrase])
transform(copies) { translate(10, 0).rotate(:right) }
puts "created #{copies.length} copy"
```

## Typical agent loop

1. `list_instances`
2. `get_open`
3. `run_expression` — counts / selection
4. `run_snippet` — small mutation + `console.log`
5. Inspect `modified` / `stdout` / `stderr`
6. On mistake with `modified: true` → `undo_last_run`
7. Repeat 3–6 until the chart matches the request

## Anti-patterns

- Passing `language: "ruby"` to MCP run tools.
- Using `Float` beats in Ruby (`1.5` invalid; use `Rational(3, 2)`).
- Calling methods on deleted wrappers.
- Assuming `Channel.get(0)` — channels are **1-based**; snappees are **0-based**.
- Expecting positions to clamp to `[-100,100]×[-50,50]` automatically.
- Treating `hidden` channels as inactive for checks.
- Writing `haveDuration` / `haveText` predicates.
