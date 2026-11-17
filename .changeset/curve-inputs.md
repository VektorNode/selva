---
'@selvajs/sketch': minor
'@selvajs/compute': minor
'@selvajs/schemas': minor
'@selvajs/ui': minor
'@selvajs/visualization': minor
'@selvajs/selva': minor
---

Get Line and Get Geometry inputs work on Selva. The form offers Line, Polyline and Curve, drawn in the viewer with vertex and grid snaps, typed lengths (`1250` or `1250<45`), Shift angle lock and editable dimension labels, plus import from DXF and 3DM. Curves reach Rhino.Compute as stock Get Line JSON or Rhino archive JSON, so the Compute fork needs no change.

- New package `@selvajs/sketch`: `/model` (curve types and math), `/io` (DXF reader, rhino3dm codec, 3DM reader), `/tool` (the draw tool for a `@selvajs/visualization` viewer).
- `@selvajs/ui`: `ComputeApp` takes `loadRhino`. Pass a rhino3dm loader to enable Get Geometry inputs and 3DM import; without it only Get Line inputs and DXF work. `layoutItemKind` returns the new `'curve'` kind for a `line` input and a `geometry` input that takes curves, supported on both hosts; `'geometry'` now means the rest.
- `@selvajs/schemas`: UI schema 2.22.0. `SchemaInput` gains `geometryTypes` (a Get Geometry's type filter) and `atMost`, written by the plugin from the param. Selva offers the curve tools only where the filter lets curves through and stops at `atMost`; a schema saved earlier has neither and is offered curves without a limit. `GeometryKind` moved from the wire schema to the UI schema; the export is unchanged. Roll out in the usual order: Selva app, then the Compute server's plugin, then authors' plugins.
- `@selvajs/compute`: `Line`, `Point` and `Plane` are known input types, parsed like `Geometry` (`GeometryInputType.paramType` widens to all four). They were reported as an unknown paramType and lost their default, so a Get Line that takes several lines showed none of the definition's own.
- `@selvajs/visualization/render` exports `raycastVisible`, the BVH pick the measure tool uses.
