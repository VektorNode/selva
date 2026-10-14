# Viewer hotspots: edit an input by clicking the model

**Unfiled.** Design only. Every assumption below was checked against the tree, and the
riskiest one live in Rhino (see "Verified").

## What it is

A definition author places a **Viewer Hotspot** component, gives it a point and wires a
Selva input into it. The viewer draws a small dot at that point. Clicking the dot opens a
popover with that input's normal widget. Changing the value solves exactly as the sidebar
does.

The sheet metal case: the bracket's `Base flange` length gets a dot at the end of the base
flange. Click it, drag the slider, the flange grows, the dot moves with it.

```
[Base flange slider] → [Get Number] ──┬──► (rest of the definition)
                                      │
[flange end point] ───────────────────┴─► [Viewer Hotspot] ─► [Context Bake]
                                              P, I, L
```

## Why this before face picking or geometry bindings

The author decides what is editable, and the definition re-emits the hotspot on every
solve. Nothing the user picked has to survive a topology change, so the naming problem that
makes face picks and definition chaining hard does not exist here. It also needs no SLVA
change. Face bindings, drag handles and free picks can come later as further hotspot kinds
on the same pipeline.

## The design

### Grasshopper side

`GH_ViewerHotspot` lives in `Features/ComputeIO/` next to Set Dynamic Value List: both route
something back to a web input. Its params:

| Param       | Access         | Meaning                                                                            |
| ----------- | -------------- | ---------------------------------------------------------------------------------- |
| Point (P)   | item           | where the dot sits, model units                                                    |
| Input (I)   | item           | wire from a Selva input; read for its **identity**, its value only feeds the label |
| Label (L)   | item, optional | popover title; defaults to the input's nickname                                    |
| Hotspot (H) | output         | `ViewerHotspotGoo`, wired into a Context Bake                                      |

Get the param list right the first time: changing it later means the OBSOLETE + upgrader
procedure. Future kinds (a linear drag handle needs a direction, an angle handle an axis)
become **separate components** feeding the same output type, not optional params on this
one.

**Target resolution: walk the wire, never store the target.** At solve time the component
walks `Input`'s sources:

- a contextual param (`IGH_ContextualParameter`) is the target; its `InstanceGuid` is the
  input's `paramId`
- bare params and relays are walked through
- a control with no sources and exactly one contextual recipient (a slider wired straight
  in, sitting next to its Get Number) resolves to that recipient
- a real component stops the walk
- no target found, or more than one: runtime error on the component, no goo

Keep this walk Rhino-free behind a small node interface (`IsContextual`, `IsComponent`,
`Sources`, `Recipients`) so the five cases are unit-tested in `Selva.Tests`, as
`OutputPayloadBuilder` is. `ParameterTypeHelper.WalkUpstreamFor<T>` has the same mechanics
but stops at controls, so it is the model, not the implementation.

**Payload**, from a Rhino-free `ViewerHotspotPayload` (plain doubles):

```jsonc
{
	"kind": "point",
	"target": "<paramId>",
	"position": [80, 25, 0],
	"units": "Millimeters",
	"label": "Base flange"
}
```

`units` is the `UnitSystem` name, taken the same way `GH_WebDisplay` takes its unit scale.
The web multiplies by the public `SCALE_FACTORS` from `@selvajs/visualization/parse`, so a
hotspot lands on the mesh without the viewer knowing anything about units.

`ViewerHotspotGoo` follows `DynamicValueListGoo`: `ISelvaSerializableGoo.ToComputeJson()`,
`CastTo<string>` returning the same JSON, and `Write`/`Read`. The Compute fork serializes
any goo implementing that interface, so the fork needs no change. Its full type name must
not contain the tokens `Display`/`DisplayBatch`, `WebDisplay` or `FileData`, because the
TS response processors route on those. `ComputeIO.Goos` is safe.

### Output plumbing in the plugin

The output type is `viewerHotspot`. One bake carries any number of hotspots, each with its
own target. Changes:

- `ParameterTypeHelper.ClassifyBakeOutputType`: detect an upstream `GH_ViewerHotspot` by
  component type, which works before the first solve. Without this the post-solve merge
  strips the output again on every solve.
- `SchemaSynchronizer.ScanParameters`: a `CollectViewerHotspotOutputs` beside the file,
  chart and DVL collectors.
- `ValueCollector`: a `viewerHotspot` case that collects **every** hotspot goo into an
  array. `OutputPayloadBuilder.Classify` stays first-wins, since a contract test pins it;
  the hotspot path gets its own collect-all method, and `GooView` gets a field for it.
- `SchemaOutputCanonicalizer.BakeOutputTypes` and its pinning test.
- `component-signatures.json` via `node scripts/check-component-signatures.mjs --update`.

Authoring rule for the docs: wire hotspots **straight into** their bake (several wires are
fine). Detection by component type does not tunnel through Merge or Entwine.

### Schema

Add `viewerHotspot` to `SchemaOutput.type` in `ui-schema.json` **and** to
`DiscoveredOutput.type` in `wire-schema.json`, together. `TabLayout` passes
`SchemaOutput[]` where `DiscoveredOutput[]` is expected, so the unions must match. The
version guard requires a minor `schemaVersion` bump, a no-op `SchemaMigrator` step (the
`dynamicValueList` addition is the precedent) and a changeset.

**No layout item.** Hotspots render in the viewer, not the sidebar. A new layout item
variant would make older plugins throw on load (`LayoutItemBaseConverter`). The output
still reaches `schema.outputs` through the post-solve merge, and Cloud needs nothing more:
it extracts exactly the outputs listed there. The builder's output-type switches
(`widget-config.ts`, `useBuilderActions.svelte.ts`, the hardcoded union in
`operations.ts`) need a `viewerHotspot` branch that offers no widget.

### Web side

Below the transport both apps share `SolveSession`, `AppLayout`, `Viewer` and
`InputControl`, so all of this is written once in `@selvajs/ui`. Hotspots travel in
`result.outputs` like every other output, so they commit in the same step as the meshes:
old dots stay while a solve runs, and they blank on blocked or aborted solves like every
other output. `@selvajs/solve` needs no change.

- **`lib/schema/viewer-hotspots.ts`** (pure, next to `dynamic-value-list.ts`):
  `buildViewerHotspots(schema, values)` → `Hotspot[]`.
  - Normalise the payload: Local sends an object or array; Cloud sends a JSON string,
    possibly double-encoded, and a single hotspot as a scalar rather than an array.
  - Scale positions by `SCALE_FACTORS[units]`.
  - Find the target's input layout item and apply visibility as the sidebar does: the
    item's rules AND its group AND its tab. Hidden → no dot. Disabled → read-only popover.
    `AppLayout` resets hidden and disabled inputs to their defaults, so a hotspot that
    ignored visibility would have its edits overwritten.
  - Drop hotspots whose target is missing from the schema, and log the reason once.
- **`AppLayout`** derives the list and passes `hotspots` plus the existing value-change
  handler to **both** `Viewer` instances (mobile and desktop).
- **`Viewer.svelte`** applies hotspots inside the existing `meshes` effect, so dots and
  meshes swap in the same frame and share its `invalidate()`.

### Viewer

**Dots are HTML elements on the existing CSS2D label layer**, not three.js sprites.

- The label layer re-projects every drawn frame, so dots follow orbit, damping and resize.
- CSS `:hover` handles the hover state without a repaint.
- A click on an HTML dot never reaches the canvas, so it beats object selection without
  registering a tool.
- Children of the `label-layer` group are already skipped by picking, fit-to-view and the
  outliner, and survive `clearScene`.

The current layer forces `pointer-events: none` and text-only labels. Add an additive method
to the exported `LabelLayer` type (e.g. `addElement(el, position, { interactive })`) rather
than reaching into `CSS2DObject` from `@selvajs/ui`. Export the handle type only, per the
minimal-API rule.

Known behaviour, accepted:

- An orbit or wheel gesture that starts on a dot doesn't orbit. Dots are small.
- `captureImage` reads only the WebGL canvas, so screenshots carry no dots. That's the
  right result.
- The label overlay sits above the blur and solving overlays. Hide the hotspot layer while
  `isBlurred`. Keep it live while solving: the sidebar stays editable then too.

**Occlusion:** a dot behind the model is drawn dimmed. There is no depth readback or BVH,
so raycast from the camera to each hotspot when the camera settles, not per frame, with a
triangle budget above which dimming is skipped. Configurator models are small; IFC-scale
scenes are the reason for the budget.

**Popover:** bits-ui `Popover` with `customAnchor` set to the dot element and
`updatePositionStrategy: 'always'` (CSS2D moves the dot by `transform`, which floating-ui
does not otherwise observe). It's portalled so the overlay's `overflow: hidden` doesn't clip
it, and z-indexed above the fullscreen viewer, the way the viewer's own menus do it. Its
body is `InputControl` with the target's layout item, so every widget type works with no
new widget code.

**`dynamicValueList` targets are excluded for now.** Each mounted `InputControl` runs its
own DVL auto-pick effect with its own budget, so a second copy in a popover could double-fire
force-solves. [dynamic-value-list-loop](../fixes/dynamic-value-list-loop.md) Phase 1 moves
that effect into the session; lift the exclusion when it ships.

## Verified

From code, all four seams:

- **paramIds.** Only `IGH_ContextualParameter` objects become `schema.inputs`, keyed by
  their `InstanceGuid`. Sliders and value lists never do.
- **Cloud addressing.** Cloud addresses inputs by nickname, but the web keys values by
  `paramId` in both modes, and a GUID resolved inside Grasshopper matches it. The DVL
  `targetInputId` path proves the round trip.
- **Plugin mode.** It already merges every output into `values`. Outputs are stripped
  before values are sent back (`pickInputValues`), so a hotspot payload never echoes into
  a solve request.
- **N goos on one bake.** In Cloud they arrive as an array. Plugin mode currently sends only
  the first, hence the collect-all path above.

Live in Rhino 8, against `fixtures/grasshopper/sheet_metal_bracket.ghx` (not saved):

- **All ten inputs resolved.** Each schema input resolved to a `GetNumberParameter` or
  `GetValueListParameter` whose sources were the slider or value list. The document is in
  millimetres.
- **The resolver above, run against the `Base flange` input:**

  | Wiring into the probe      | Result                                      |
  | -------------------------- | ------------------------------------------- |
  | Get Number directly        | its `paramId`                               |
  | Get Number through a relay | its `paramId`                               |
  | the slider directly        | its `paramId` (single contextual recipient) |
  | a C# Script output         | error: no Selva input upstream              |
  | two Get Numbers            | error: ambiguous                            |

- **The bracket's profile polyline** is `(80,0,0) (0,0,0) (0,0,60)`: base flange end,
  corner, upright end. The first and last vertices, moved to mid-width, are the hotspot
  points the extended fixture uses.

Still to verify during the build, because it needs a Compute server:

- In Cloud mode, a hotspot lands on the mesh. That means the Compute document's unit
  system matches the response's `modelunits`.
- Compute returns N hotspot goos as N items. `.claude/skills/rhino-mcp/compute-e2e/`
  covers both.

## Build order

Each slice can be tested and merged on its own.

1. **Plugin and schema.**
   - Payload, goo, component, resolver, bake classification, collector, schema enums,
     version bump, `pnpm generate`, signatures.
   - Tests:
     - resolver cases;
     - a payload golden fixture under `packages/schemas/fixtures/` that both stacks load,
       as the DVL payload does;
     - collect-all next to first-wins;
     - the canonicalizer pin.
   - Extend the bracket fixture with hotspots on both flange ends (through rhino-mcp) and
     read the `outputs` envelope back.
2. **Web data.** `buildViewerHotspots` with unit tests covering:
   - scalar, array, string and double-encoded payloads;
   - unit scaling;
   - missing, hidden and disabled targets, and DVL targets;
   - threading through `AppLayout`.
3. **Viewer dots.** The interactive label-layer method with tests; dots applied in the
   mesh effect; hover; hidden while blurred; occlusion dimming on settle.
4. **Popover.**
   - `InputControl` in a bits-ui popover: fullscreen z-index, Esc to close, tap on touch.
   - Acceptance: a Playwright test against the plugin-ui WebSocket stub. Click the dot,
     change the value, and assert a `valueUpdate` carrying the target `paramId`.
5. **Cloud check.** Run the extended fixture through compute-e2e and confirm the dot sits
   on the flange end.

## Rejected alternatives

- **Choosing the target in the UI builder (the Set DVL pattern).** One `targetInputId` per
  bake can't carry many hotspots with different targets. The DVL plan documents that
  value's two sources of truth with opposite precedence. A stored GUID goes stale when
  Prepare UI Inputs swaps a param's type (new GUID), and `schema-remap.ts` never rewrites
  it. Walking the wire on every solve heals all of that by construction.
- **Hotspots as an SLVA display item.** It would inherit unit scaling for free, but it
  ties interaction to the display container, puts hotspots into `meshes` and the outliner,
  and changes the wire format for a payload of a few bytes. Carrying `units` in the payload
  solves the one thing it would have bought.
- **A new `SolveResult` field.** That means changes to the solve state machine. The
  `outputs` map already commits atomically with the meshes.
- **three.js sprite dots picked through the tool registry.** The registry doesn't intercept
  double-click (it would zoom to the mesh behind the dot), and every hover change would
  need a manual `invalidate()`. HTML elements get both for free. Sprites may still suit
  drag handles later, where depth-correct drawing matters more.
- **Converting positions to metres in C#.** It couples the plugin to the viewer's frame.
  The `units` string is what the mesh path already uses.
- **One component with optional params for every future kind.** Every added kind would
  change a released param list. One component per kind keeps each list stable.
- **The name "anchor".** `@selvajs/visualization` already uses it for the outliner's
  shift-range selection anchor.
