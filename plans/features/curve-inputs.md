# Curve inputs on Selva: draw, import, solve

**Unfiled.** Built, and run in the Selva app against local Rhino.Compute (Rhino 9.1) on
2026-11-17. Spans a new package (`@selvajs/sketch`), `@selvajs/ui`, one export in
`@selvajs/visualization`, three input types in `@selvajs/compute`, one prop passed by the Selva
app, and two fields the plugin writes into the schema (2.22.0). No change to the Selva server or
the Compute fork.

Follows [host-aware-elements](./host-aware-elements.md), which put geometry inputs in the schema
and gave Rhino a pick. Its plan for Selva was "upload `.3dm`, later". This replaces that row for
curves: Selva draws them in the viewer and imports DXF and 3DM.

## What it is

A Get Line or Get Geometry input shows **Line / Polyline / Curve** and **Import** in the Selva form.
Drawing happens in the viewer, on top of the solved model. What is drawn solves like any other
input value.

## How a curve reaches Grasshopper

Nothing between the form and Rhino changed. `TreeBuilder.fromValues` already passes a list of
objects through as one JSON string per item, and Rhino.Compute already reads both shapes:

| Input        | `paramType` | Item on the wire                                               |
| ------------ | ----------- | -------------------------------------------------------------- |
| Get Line     | `line`      | `{ "From": {X,Y,Z}, "To": {X,Y,Z} }`                           |
| Get Geometry | `geometry`  | Rhino archive JSON: `{ version, archive3dm, opennurbs, data }` |

The archive is what `CommonObject.ToJSON` writes and `FromJSON` reads. Only rhino3dm can write it
outside Rhino, so the browser loads rhino3dm on first use: a 76 KB script and a 1 MB (gzipped)
wasm, fetched when a Get Geometry input first has a curve to encode or decode. A definition with
only Get Line inputs never loads it.

**The host hands the loader in** (`<ComputeApp loadRhino>`); `@selvajs/ui` does not import
rhino3dm. A bundler emits the wasm for any module in its graph, used or not: with the import
inside `@selvajs/ui`, the plugin's page, which never draws, carried 2.7 MB more into the `.gha`,
and so would every other host of the package. The Selva app passes
`packages/selva/src/lib/load-rhino.ts`. A host that passes nothing gets Get Line inputs and DXF
import only, and its Get Geometry inputs stay out of the form.

The session value is the encoded list, and it is the only copy that solves. The form's editable
curves are decoded from it and encoded back after every edit. So a definition's own default
(an internalised curve, reported by `/io`) shows up in the viewer and can be edited, and Reset
returns to it.

## Units and axes

The viewer's scene is in metres; the display parser scales every solve by `SCALE_FACTORS[modelunits]`.
Curves are kept in model units and Rhino's axes, and the draw tool is given the same factor. The
unit name comes from the last solve response, since nothing else carries it: **nothing can be drawn
before the first solve**. An auto-solving definition has solved by the time the form is usable. A
manual-solve definition has to be solved once on its defaults first.

A host that parses with `allowScaling: false` has a scene in model units, and a sketch drawn by
`ComputeApp` would be off by the unit factor. No host in this repo does.

## What a Get Geometry takes

Selva has the saved schema and no canvas, so the plugin writes what it needs onto each input
(schema 2.22.0):

- `geometryTypes`: what the Get Geometry's type filter allows. Selva offers the curve tools when
  it includes `curve` or is empty (a filter that allows everything). An input filtered to meshes or
  surfaces stays a Rhino-only element, badge and all.
- `atMost`: the most objects the param takes. Drawing one more drops the oldest and the mode ends
  when the count is reached, so an input that takes one curve is redrawn in one go. An import keeps
  the first `atMost`.

Both are copied from the param every time the plugin validates the schema against the document
(`SyncGeometryLimits`), not only at discovery: `paramType` is written once and never re-derived,
and a filter is something authors change. They are still stale between validations, after a
filter change from the param's own menu and before the next save or canvas change.

A schema saved before 2.22.0 has neither. Selva then offers curves on every `geometry` input and
takes any number: hiding the input until the file is re-saved would take the feature away from
every existing definition. The usual rollout order applies: Selva app, then the Compute server's
plugin, then authors' plugins.

## What the live run showed

Run on `examples/definitions/garden-sketch.gh`: a Get Line taking any number of lines and a Get
Geometry filtered to one curve, with lengths printed back as a check.

- A wall typed as `2500` reached Rhino as 2500 mm: four walls, 15.000 m. A path typed as
  `3000<0` then `4000<90` measured 7.000 m in Rhino, so the archive and the unit scale hold.
- A free control-point curve measured 5.570 m in Rhino and 5570 mm in the form: Rhino draws the
  same curve the browser evaluates.
- A DXF and a 3DM, both in metres, landed as 9.000 m and 6.000 m in the millimetre model.
- The input that takes one curve was redrawn in one go; each new curve replaced the last.

It also found three defects, all fixed:

- **`@selvajs/compute` did not know `Line`, `Point` or `Plane`.** Each was reported as an unknown
  `paramType` and lost its default, so a Get Line with several lines came through as `[null]`: the
  form showed nothing, and the first drawn line replaced the definition's own walls instead of
  joining them. They parse like `Geometry` now.
- **Every solve rebuilt the draw tools.** The scale was derived straight from the solve result,
  a new object each time, so the first committed curve ended the drawing mode. It is derived from
  the unit name, which only changes with the model.
- **The field label named the first draw button.** A `<label for>` on a button replaces the
  button's own name, so "Line" read as "Walls". The label points at the readout instead.

One thing it showed that is not this feature's: a freshly started Compute child threw
`NullReferenceException` from Rhino's script-language registry (`ScriptContext.InitLanguages`) on
`/io` for four examples that hold C# Scripts, on one of two seeding runs. The same files uploaded
clean on the other.

## Not built

- **Presets and saved states skip curve inputs.** `isValuelessInput` covers every geometry input on
  both hosts, because in Rhino they hold no form value. On Selva they now do. Loading a preset
  leaves the drawn curves as they are.
- **Get Point and Get Plane on Selva.** Both are plain JSON on the wire and would reuse the tool's
  picking.
- **Drawing planes other than model XY**, and snapping to edges or midpoints. Snaps are vertices
  only.
- **Closed periodic NURBS.** A curve closed by clicking its first point has a kink there.
- **DXF blocks, ellipses and fit-point splines.** Counted as skipped, not expanded.
- **An import cap of 2000 curves.** Each curve is one request item on every solve.

## Rejected alternatives

- **Teaching the Compute fork a plain curve JSON.** Smallest client, but every Compute server has
  to be updated before the feature works, and an older one would read the value as no geometry
  and solve on the default without a word.
- **Encoding on the Selva server.** Keeps wasm out of the browser and makes API payloads readable.
  3DM import needs rhino3dm in the browser anyway, and then there would be two encoders.
- **A Selva "Get Curve" component.** Rhino's own Get Geometry already carries a curve, and Hops and
  Grasshopper Player fill it too.
- **Curves in a `text` input, parsed by a script in the definition** (ADR 0001's advice for complex
  data). Every definition would carry its own parser.
- **Drawing inside `@selvajs/visualization`.** The viewer is a renderer with seams for host tools,
  and this is one. It needs only public API, plus `raycastVisible`, now exported so a host tool
  snaps through the same BVH pick as the measure tool.
- **One shared sketch that inputs select from.** Each input owning its curves matches Pick in
  Rhino and needs no assignment step.
