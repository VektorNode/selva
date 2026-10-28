# Dynamic value list: resolve the selection in Grasshopper, so lists can drive lists

**Unfiled.** Design only; file an epic when someone commits to it.

Scope: where a dynamic value list's selection is checked against its options, and what that means
for one list driving another (A's selection computes B's options). Spans `Plugin/Selva.GH`,
`@selvajs/ui`, `@selvajs/solve` and the compute fork. Companion to
[dynamic-value-list-loop.md](../fixes/dynamic-value-list-loop.md), whose premises this changes in
two places (see "What this changes in the loop plan").

## How it works today: the browser reconciles, one solve late

1. `Set DynVL` computes options during solve N and ships `{ targetInputId, options }`.
2. The browser routes them to the target input (`buildDynamicValueListOptions`), and the
   `$effect` in `InputControl.svelte` checks the current selection against them. If it's gone, it
   picks the first option and force-solves.
3. Solve N+1 applies the corrected selection.

Grasshopper never checks anything. `GetDynamicValueListParameter` resolves a selection against
`_storedItems` and passes an unmatched value through verbatim. `_storedItems` comes only from the
saved file or from wired sources: `LoadItems` has no caller anywhere (its comment says the web UI
calls it; nothing does). What saves the day is that the UI sends the option's **value**, not its
name, so a verbatim pass-through is still the right value.

That model has a cost per link of a chain, and a set of defects, all from the selection being
fixed one solve after the options it depends on:

- **Every chain link is a solve, and the first one is wrong.** Change A: solve 1 runs with A new
  and B's old selection, which may not exist in B's new options. Its geometry is shown, then B is
  re-picked and solve 2 runs. A→B→C is three solves and two wrong intermediate results.
- **The loop breaker never trips.** The budget resets whenever the selection is valid, and right
  after an auto-pick it is, so a self-oscillating definition picks one, resets, picks one, forever.
- **Identity is the value, so equal values hide a change.** Options valued `0, 1, 2` by index:
  A changes, the names change, `1` still exists, so B silently points at a different item.
- **A blocked or aborted solve forgets the options.** `report()` blanks outputs, the control falls
  back to `defaultOptions`, and the selection is re-picked and force-solved. The fork now forwards
  the plugin's own aborts, so this happens on every Selva abort.
- **A late result reconciles against old options.** In cloud mode a result superseded by a newer
  request is still applied, so B is re-picked against options for the previous A.
- **Reconciliation needs the control mounted.** A list on an inactive tab keeps sending an invalid
  value; opening the tab re-picks and force-solves unasked (inferred from tab unmounting, not run).
- **Lists that depend on each other ping-pong without bound** (follows from the budget defect).

Smaller ones found on the way, worth an issue each: two outputs targeting one input, last wins
silently; numeric option values never validate (the check wants strings) and re-pick until the
budget runs out; the first solve sends `null`, contradicting the "never empty" invariant; the
cloud input tree is keyed by nickname, so two inputs with the same nickname overwrite each other.

## Design: resolve in the same solve, in Grasshopper

The options already exist inside the solve that changed them. Resolve there, and tell the browser
the answer instead of letting it guess one solve later.

### 1. The Get param reads current options through a wire

`GetDynamicValueListParameter` already reads `"key" = value` pairs from wired sources into
`_storedItems` (`ReadInitialOptionsFromSources`, meant for seed options). The author wires the same
options list into both `Set DynVL` and the target `Get DynVL`. A wire is what gives the ordering
guarantee: Grasshopper computes the Get param after its options, in the same solve, and expires it
whenever anything upstream of the options changes.

In `EmitData`, with wired options present: a selection that matches an option resolves to it; one
that doesn't falls back to the first option (checklist: prune to survivors, empty → first), with a
Remark naming both. Resolution is a pure function of selection and options each solve;
`_selectedValues` keeps what was applied. Put it in `DynamicValueListLogic` so it is unit-tested
without Grasshopper.

### 2. The payload carries the resolved selection

`{ targetInputId, options, selected }`. `Set DynVL` can't read it in `SolveInstance`, since nothing
orders it after the Get param. But the payload is serialized after the solution, during harvest
(compute's `Solve`, the plugin's `ValueCollector`), when the Get param has resolved. So the goo
holds a reference to its target param, taken in `SolveInstance` from the document, and reads the
param's resolved data when it serializes. No new input on `Set DynVL`: adding one changes the param
list of a released component, which needs the OBSOLETE + upgrader procedure.

All three serialization paths (`ToJObject`, `ToCollectorPayload`, `FromJson`) change together,
pinned by the golden fixture both stacks load. `selected` is absent when the Get param has no wired
options, which is how the browser tells the two modes apart.

### 3. Identity becomes the option name

With `selected` present, the browser sends the option **name**, and the Get param resolves it to
the value against the current options. Names are unique (`Set DynVL` rejects duplicates); values
aren't, which is the index-valued defect above. Without `selected` (unwired Get, older plugin),
the browser keeps sending values, since a verbatim pass-through needs one.

### 4. The browser adopts instead of reconciling

When the payload has `selected`, the control shows it and sets the value without a solve: the
solve that produced it already used it. No auto-pick, no budget, no forced solve. The reconciler
stays only for payloads without `selected`, where the loop plan's session-level reconciler with a
global budget still applies.

On a blocked or aborted result, keep the previous options and selection instead of blanking them.
This one is independent of the rest and worth shipping first.

## Chaining, under this design

A→B: A's selection feeds logic that produces B's options, wired into `Set DynVL(B)` and
`Get DynVL(B)`. The user changes A. One solve: A expires B's Get param through the wire, B
re-resolves its selection against the new options, everything downstream computes with a valid B,
and the payload tells the browser what B ended on. A→B→C is still one solve. No intermediate
result, so the throttle, late results, manual mode and inactive tabs stop mattering.

Mutual dependence (B's selection feeds A's options too) can't be wired: it's a cycle, and
Grasshopper refuses it. That's correct, because the answer would depend on solve order. Such
definitions keep the unwired path, where the budget, once fixed, stops the ping-pong.

## Compute

Nothing changes in the fork. Compute's `AlreadySet` skip is right under this design: B's options
only change because something upstream changed, and that expires B's Get param through its wire,
so an unchanged selection re-resolves against the new options anyway. Exempting value lists from
`AlreadySet` (loop plan, Phase 3) is not needed for wired lists, and would cost every solve the
warmth of everything downstream of a value list.

## Rejected

- **The Get param finds its `Set DynVL` by target id and reads its options, no wire.** Nothing
  orders the two, so it would often read the previous solve's options: today's bug, moved.
- **Solve twice server-side when a selection turns invalid.** Doubles the cost of every such solve,
  hides loops inside compute, and does nothing for local mode.
- **Only the browser reconciler (the loop plan's Phase 1).** It handles every topology but keeps one
  solve per chain link and the wrong intermediate result. It stays as the fallback, not the main
  path.

## What this changes in the loop plan

- Its "not adding a `selected` field" rests on the Set component not knowing the resolved
  selection, because the Get param resolves against the previous options. With options wired into
  the Get param, it resolves against the current ones, and the payload can carry the answer.
- Its Phase 3 (exempt value lists from compute's `AlreadySet`) is unnecessary for wired lists and
  costs warm solves; see "Compute".

## Open questions

- Authoring cost: the options must be wired twice. A builder lint can flag a `Set DynVL` whose
  options don't also reach its target Get param. Or the Get param grows an "Options" input of its
  own so the Set component reads from it — check whether that is a param-list change.
- Does the goo's reference to its target param survive `Duplicate()` and the bake's handling? If
  not, read the target from the document at harvest instead.
- A wired Get param stops being sourceless. Compute registers contextual params either way, but
  `SchemaSynchronizer` reads a wired param's default from its first source's data, which for an
  options wire is a raw `"key" = value` string. Check that path before relying on the wire.
- Fallback policy: first option, or keep the last valid selection when it reappears? First is what
  the browser does today, so it changes nothing users see.
