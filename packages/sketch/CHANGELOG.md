# @selvajs/sketch

## 0.1.0-beta.0

### Minor Changes

- 6d8dc82: Get Line, Get Point and Get Geometry inputs work on Selva. The form offers Point, Line, Polyline and Curve, drawn in the viewer with vertex and grid snaps, typed lengths (`1250` or `1250<45`), Shift angle lock, undo and editable dimension labels, plus import from DXF and 3DM. Values reach Rhino.Compute as stock Get Point and Get Line JSON or Rhino archive JSON, so the Compute fork needs no change.

  - New package `@selvajs/sketch`: `/model` (curve and point types, math, Grasshopper paths), `/io` (DXF reader, rhino3dm codec, 3DM reader), `/tool` (the draw tool for a `@selvajs/visualization` viewer, with `createCurveLayer` and `createPointPicker` it is built from, and `DrawModeSpec` for a host's own shapes). An item can carry a `path`, sent as a data tree branch, and `attributes`, sent to a Get Geometry as Rhino user strings.
  - `@selvajs/schemas`: UI schema 2.22.0. `SchemaInput` gains `geometryTypes` (a Get Geometry's type filter) and `atMost`, written by the plugin from the param. Selva offers the curve and point tools only where the filter lets them through and stops at `atMost`; a schema saved earlier has neither and is offered both without a limit. `GeometryKind` moved from the wire schema to the UI schema; the export is unchanged. Roll out in the usual order: Selva app, then the Compute server's plugin, then authors' plugins.
  - `@selvajs/ui`: `ComputeApp` takes `loadRhino`. Pass a rhino3dm loader to enable Get Geometry inputs and 3DM import; without it only Get Line and Get Point inputs and DXF work. `onReady` gives `getSketch()`, a `SketchController` that reads and replaces an input's items, starts a draw mode and undoes; `getSketchContext` reaches it from a client slot. `layoutItemKind` returns the new `'sketch'` kind for an input that takes lines, points or curves, supported on both hosts; `'geometry'` now means the rest, and `drawableKinds` says what an input takes.
  - `@selvajs/compute`: `Line`, `Point` and `Plane` are known input types, parsed like `Geometry` (`GeometryInputType.paramType` widens to all four). They were reported as an unknown paramType and lost their default, so a Get Line that takes several lines showed none of the definition's own.
  - `@selvajs/visualization/render` exports `raycastVisible`, the BVH pick the measure tool uses.
