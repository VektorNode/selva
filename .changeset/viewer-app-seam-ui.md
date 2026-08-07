---
'@selvajs/ui': minor
---

`onViewerReady` on `<Viewer>` and `<ComputeApp>` hands the live three.js viewer to the host, so an
app can draw into the same scene the solve renders into — a point cloud, draft lines, annotations —
and register pointer tools. Return a cleanup function to tear down what you added. Previously the
viewer handle died inside `onMount` and nothing could reach it.

`ComputeApp`'s `onReady` also gains `getSession()`, so a host can drive solves from its own state
(`setValue`/`solve`) and react to results, rather than only pushing values in through `loadValues`.

The viewer-app types (`ThreeViewer`, `PointerTool`, `ToolRegistry`, `LabelLayer`, …) and the scene
ownership helpers are re-exported from the public entrypoint so hosts can annotate without adding a
direct `@selvajs/visualization` dependency.
