# `@selvajs/sketch`

Points, lines, polylines and NURBS curves as Get Point / Get Line / Get
Geometry inputs. Three entrypoints that depend downward only: `/model` (plain data and math, no
deps), `/io` (DXF reader; Rhino archive codec and 3DM reader that take a loaded rhino3dm module),
`/tool` (the viewer draw tool, on `ThreeViewer`'s public seams). Items are in model units and
Rhino's axes; the scene is in metres.

It is meant to be built on: `createSketchTool` is `createCurveLayer` plus `createPointPicker`,
both exported, and a host adds a shape with a `DrawModeSpec` instead of forking the tool. In the
app the handle is `SketchController` (`ComputeApp` `onReady` → `getSketch()`).

Design: [curve-inputs](../../plans/features/curve-inputs.md).
