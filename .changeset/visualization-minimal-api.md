---
'@selvajs/visualization': major
---

Trim the public API to what consumers actually need. The package exported ~110 symbols across five
entrypoints while consumers used 23 — the surface described the package's file layout rather than
its contract, and every re-exported internal was a compatibility promise nobody had asked for.

Nothing in this repo imported a removed symbol; the four in-repo consumers (`@selvajs/ui`,
`@selvajs/plugin-ui`, `@selvajs/selva`, plus tests) are unchanged.

## Breaking — removed entrypoints

**1. `@selvajs/visualization/shared` is gone.** It is now the internal cross-layer import surface.
What consumers need is re-exported from `/render`:

```diff
-import { setLogger, VisualizationError, LOOKS } from '@selvajs/visualization/shared';
+import { setLogger, VisualizationError, LOOKS } from '@selvajs/visualization/render';
```

`parseColor`, `applyOffset`, `computeCombinedBoundingBox`, `rhinoToThree`, `decodeBase64ToBinary`,
`Vec3` and `CACHED_GEOMETRY_USERDATA_FLAG` are no longer public.

**2. The root `.` entrypoint re-exports nothing.** It was `export *` over all four layers, which
defeated the sub-path split. Import from the layer you need — the layering is now enforced by the
import graph rather than merely documented.

```diff
-import { initThree } from '@selvajs/visualization';
+import { initThree } from '@selvajs/visualization/render';
```

## Breaking — `/render`

`initThree` already owns the toolkit: it builds the camera controller, grid, gizmo, measure tool,
render pipeline and near-plane fitter from `ThreeInitializerOptions` and returns the live instances
on `ThreeViewer`. Their factories are no longer exported — configure through the options, reach
through the viewer (`viewer.grid`, `viewer.measureTool`, `viewer.applyEdges`/`clearEdges`, …).

Removed: `createCameraController`, `createGrid`, `createViewGizmo`, `createMeasureTool`,
`snapToVertex`, `createRenderPipeline`, `createLabelLayer`, `createNearPlaneFitter`,
`EdgeDetectionPass`, `addEdges`, `addEdgesAsync`, `removeEdges`, `isEdgeOverlay`,
`EDGE_USERDATA_KIND`, `EDGES_SKIPPED_TRIANGLE_CAP`, `applyDefaults`,
`disposeMaterialWithTextures`, `clearScene`, `computeContentBounds`, the `Materials` namespace, the
`up-axis` helpers (`buildUpBasis`, `environmentRotationFor`, `isoOffset`, `sunOffset`, `upToAxis`),
and the types `GridOptions`, `EdgeOptions`, `MeasureOptions`, `RenderPipeline`,
`RenderPipelineOptions`, `EdgeDetectionOptions`, `LabelLayer`, `LabelHandle`, `NearPlaneFitter`,
`ResolvedOptions`, `UpBasis`.

Kept: `initThree`, `updateScene`, `ThreeViewer`, the full `ThreeInitializerOptions` config surface,
the handle types (`CameraController`, `CameraProjection`, `ViewPreset`, `Grid`, `ViewGizmo`,
`MeasureTool`), and — newly surfaced here — the errors, logger seam and look vocabulary.

## Breaking — `/parse`

The SLVA binary wire format is now private to `parseMeshBatch*`; it is an implementation detail that
changes without a major bump. Removed: `parseBinaryMeshBatch`, `BINARY_MESH_MAGIC`,
`COMPRESSED_MESH_MAGIC`, `BINARY_MESH_VERSION`, `MIN_SUPPORTED_VERSION`, all `FLAG_*` and
`UV_FORMAT_*` constants, `BinaryMeshMetadata`, `ParsedBinaryMeshBatch`.

Also removed: `parseMeshBatch` (use `parseMeshBatchObject` / `parseMeshBatchBlob`),
`cloneSceneObjects` / `releaseSceneObjects` (reach them as `meshPolicy.clone` / `.release`),
`clearTextureCache`, `TEXTURE_CACHE_MAX_ENTRIES`, and the deprecated `MeshBatch` alias — use
`DisplayBatch`.

`setTextureAnisotropy` stays: it is the host's half of the `onMaxAnisotropy` seam that keeps
`render/` from importing `parse/`.

## Breaking — `/scene`

`createSceneOutliner` composes this layer, so its parts are no longer exported individually — reach
them via `outliner.visibility` / `.selection` / `.layerGroups()`. Removed: `HELPER_IDS`,
`isSceneContent`, `getSceneObjects`, `prettyType`, `DEFAULT_LAYER`, `groupByLayer`,
`filterLayerGroups`, `getStableKey`, `createVisibilityState`, `createSelectionState`.

Kept: `createSceneOutliner`, `SceneOutliner`, `SceneOutlinerOptions`, the state handle types
(`VisibilityState`, `SelectionState`, `SelectionModifiers`), and the helpers a host needs while
rendering an outliner row — `getObjectLabel`, `getTypeLabel`, `getTrackingKey`.
