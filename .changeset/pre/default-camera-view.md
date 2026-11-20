---
'@selvajs/schemas': minor
'@selvajs/visualization': minor
'@selvajs/ui': minor
'@selvajs/mcp': minor
'@selvajs/selva': minor
---

A definition can save the view it opens in. Schema format 2.23.0 adds `viewerOptions.camera`: a direction the viewer looks along and zooms to fit, so the angle holds when the model changes size, plus an optional exact position and target.

- The builder's viewer settings gain "Default view": "Use view from Preview" saves the view Preview last showed, "Keep exact position" stores its position too, and "Clear" drops it.
- Selva's viewer, the plugin's preview and the MCP 3D view open the first solve in that view.
- `selva_capture_preview` gains a `default` view, now its default: the saved view, or iso without one. `captureSolve` takes the saved view as `camera`.
- `CameraController` gains `getCameraView` and `setCameraView`, and `CameraView` is exported from `@selvajs/visualization/render`. `ViewerConfig` takes `camera`.
