# Dynamic value list: resolve the selection in Grasshopper, so lists can drive lists

**Unfiled.** Prototype on `feat/dependent-forms`, uncommitted: built as described below.

Scope: where a dynamic value list's selection is checked against its options, and what that means
for one list driving another (A's selection computes B's options). Spans `Plugin/Selva.GH`,
`@selvajs/ui`, `@selvajs/solve` and the compute fork. Companion to
[dynamic-value-list-loop.md](../fixes/dynamic-value-list-loop.md), whose premises this changes in
two places: no `selected` field is needed, and wired lists need no `AlreadySet` exemption.

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

The options already exist inside the solve that changed them. Resolve there, and let the browser
show the same answer instead of correcting it one solve later.

### 1. The options output is wired into the Get param

The author wires the output of `Set DynVL` (or Options Table, or Repeat) into the `Get DynVL` it
fills, as well as into the Context Bake. One wire does three jobs:

- **Order.** Grasshopper computes the Get param after its options, in the same solve, and expires
  it whenever anything upstream of the options changes.
- **Options.** The Get param reads the payload off the wire: one option set (`ReadWiredOptions`),
  row keys (Repeat), or a table of combinations (Options Table, below).
- **Target.** The output finds its target by walking the wire forward through layout holders
  (`WiredInputs.Fed`), so the builder's target picker isn't needed and isn't written back.

No param-list change on the released `Set DynVL`: its output already exists. A `"key" = value`
Panel wired into the Get param still only seeds options and resolves nothing.

### 2. Resolution is one rule on both sides

With an options payload wired in, the Get param resolves each pick in `CollectVolatileData`: a pick
still offered (by value or name, ignoring case) stays, anything else takes the first option; a
checklist keeps the offered picks, or the first option when none is left. `DynamicValueListLogic`
holds the rule; `@selvajs/ui`'s `resolvePick` is its twin, and
`packages/schemas/fixtures/dynamic-value-list-resolution.json` pins both.

The payload carries `resolvedInSolve: true` instead of a `selected` field. The browser already has
the options the solve used and the picks it sent, so it computes the same answer without one, and
the goo needs no reference to its target param.

### 3. The browser shows the resolved pick and never sends a fix

`buildFormModel` returns `shown`: what each resolved input shows, which is what the solve used.
`values` keeps what the user picked, and that is what goes out. No auto-pick, no budget, no forced
solve. A pick that isn't offered now comes back when it is offered again. Payloads without
`resolvedInSolve` keep the control's reconciler.

### 4. Repeated inputs store picks by row key

A Repeat member's value is one JSON object of row key to pick (`withRowPick`, `ParseRowPicks`): a
plain string on the wire, one contextual item whatever the row count. The Get param looks each
row's pick up by key in the same solve that computed the rows, so a change of rows solves once and
picks stay with their rows. Picks for rows not shown now are kept.

Repeat's optional Options input (a Panel of names) gives every row the same list, carried in the
Repeat payload's `options`. A member that Set DynVL or Options Table fills ignores it. Without it a
repeated input needed a second options component wired into the same Get, which read as two things
filling one list.

## Chaining, under this design

Style → Fronts → Handles, with Fronts and Handles repeated (`examples/definitions/kitchen-run.gh`):
Style → Options Table (By) → Get Fronts → Get Handles, Repeat → both Gets. Changing the style, a
pick, or the layout that decides the rows is one solve, and every Get
param downstream computes with a valid pick. Set DynVL chains the same way
(`examples/definitions/shelving-unit.gh`: Width → Bays → Doors). No intermediate result, so the
throttle, late results, manual mode and inactive tabs stop mattering.

Mutual dependence (B's selection feeds A's options too) can't be wired: it's a cycle, and
Grasshopper refuses it. Such definitions keep the unwired path.

## Options Table: one table instead of a tree per link

Three components cover dependent forms, one job each: Set DynVL sends options computed in the
solve, Repeat decides the rows, and Options Table says which choices go together. An earlier
component, Options By, asked for a tree with a branch per value, a Keys list in branch order, and
one component plus one Context Bake per link of a chain. It was deleted before it reached Yak,
with its `by` and `table` payload fields.

Choices that go together are a list of valid combinations, which is one table:

```
Style, Front, Handle, Price
Shaker, Shaker door, Knob, 180
Slab, Slab door, Bar, 160
```

Panel → `Options Table` → Get Style → Get Front → Get Handle, and `Options Table` → one Context
Bake. Each Get reads the column named like it, else the next free one, and offers the values that
column has in the rows the picks before it left.

- **Wire order is dependency order.** A Get is wired from the Get before it, so Grasshopper
  expires and orders the chain itself. Each Get leaves the rows its pick kept on `TableStep`, and
  the next reads them off the param, not off the wire: a Text relay between two sections would
  turn a goo into plain text.
- **One Get may feed several.** Each then narrows on the picks above it and not on its siblings:
  Style → Front and Style → Colour offer independent lists. The payload's `parents` says which
  input each narrows on.
- **By takes inputs that narrow without being filled.** A Get Value List or a Get Boolean wired
  into By keeps its own options; the table only reads its value, matching its column ignoring
  case. The component narrows the rows by it in the solve (`Start`, never sent), one set per item
  when the By input is repeated.
- **One payload, `pickTable`.** The component walks the wires forward and sends
  `{ by, inputs, parents, rows }`: the columns in use only, each combination once. The browser
  narrows the same rows (`narrowPickTables`), so a pick updates every list that depends on it
  without a solve. `packages/schemas/fixtures/pick-table.json` pins both sides.
- **Other columns never leave Grasshopper.** Price, article number and the like are read from the
  same Panel with native components, keyed on the picks.
- **It only shapes the form.** The Gets output plain text and the table is a Panel. Delete Options
  Table and its Bake, swap each Get for a Value List, and the definition solves as before; what
  goes is the narrowing, so an invalid combination is then possible.
- **Repeat composes.** A chained Get that is also a Repeat member narrows once per row: row i
  starts from the rows the Get before it left for row i, or from its single set when that Get
  isn't repeated. `examples/definitions/kitchen-run.gh`: Style in By, then a front and a handle
  per cabinet.
- **The component follows its wiring.** Wiring a Get in or out, or renaming one, expires nothing
  upstream of it, and the component is upstream. On `SolutionStart` it compares the wiring with
  what it built for and expires itself when they differ, so the payload changes in that same solve.

Checked in Rhino 9 on `kitchen-run.gh`: Style in By, per-row narrowing, picks that come back when
offered again, and Handles rewired to narrow on Style alone. Unwiring and renaming a Get were
checked on the chain before By existed. Checked on Compute `8.x.state` (Rhino 8.36) with
`compute-roundtrip.check.test.ts`: five changes, five solves, and the form matched every result.
Not checked: `9.x.state`, and the form in a browser against the real plugin.

Not done: a table Get as a checklist, the native row lookup for columns no input reads, and a
table editor in the builder.

## Compute

Nothing changes in the fork. `AlreadySet` skips an unchanged pick string, which is right: options
only change because something upstream changed, and that expires the Get param through its wire,
so the unchanged pick re-resolves against the new options. Checked on `9.x.state`
(`compute-roundtrip.check.test.ts`): five changes, five solves, and the form matched every result.

## Blocked and aborted results

A rejected solve blanks every output except dynamic value lists (`blankOutputs`): those hold the
options and rows the form is drawn from, so the lists and repeated blocks stay as they were.

## Not done

- **Identity by name.** The browser still sends option values, so two options with the same value
  stay indistinguishable. Matching takes name or value, first match, so switching later keeps
  saved picks working.
- **Unwired lists** keep the old behaviour and its defects above; the loop plan still applies to
  them. `Set DynVL` with a builder-picked target and no wire remarks that it should be wired.
- **The Context Bake** is still needed for the payload to reach the browser; Compute only
  harvests through Context Bake and Context Print.

## Rejected

- **The Get param finds its `Set DynVL` by target id and reads its options, no wire.** Nothing
  orders the two, so it would often read the previous solve's options: today's bug, moved.
- **Wiring the options list into both `Set DynVL` and the Get param.** Two wires that must agree;
  the output wire carries the same options and also names the target.
- **A `selected` field read from the target at harvest.** Needs the goo to hold a live param
  reference through `Duplicate()` and the bake; the browser can compute the answer itself.
- **Solve twice server-side when a selection turns invalid.** Doubles the cost of every such solve,
  hides loops inside compute, and does nothing for local mode.
