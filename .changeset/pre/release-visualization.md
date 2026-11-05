---
'@selvajs/visualization': minor
---

A night look, real-size materials, faster large meshes, and a measure tool that scales.

- `night` look: emissive materials become shadow-casting point lights with bloom; a lighter tier runs on phones (`render.lowPower`).
- Built-in wood, concrete, plaster, brick and corten at real size with no texture files. Softer sun shadows, a softbox studio for metals, and idle refinement that averages frames for true penumbras (`render.idleRefineFrames`, `render.lightOrbitFrameMs`). Lights now survive a solve. three is 0.187.
- Measure tool: BVH picking (new `three-mesh-bvh` dependency), a live rubber band, vertex-snap feedback, persistent measurements until Escape, and `MeasureTool.cancel()`. Hidden objects aren't pickable.
- Scene manager hover and selection tint objects in the viewport (`setHover`, `selectEntries` on `ThreeViewer`). Double-clicking empty background frames everything.
- Byte-identical geometry is reused across solves (`clearGeometryCache()` from `/parse`), and merging by material gathers every group of a material.
- Large meshes decompress in a worker: about 20% faster, and under 2 ms of main-thread blocking per solve for 2.7M triangles. Edge overlays build 2–7× faster on dense meshes and cover 8M triangles. Clearing 100k meshes takes 0.2 s instead of 2.9 s, and base64 decoding in Node is about 7× faster. The plugin's optional `CLSD` chunk skips the closed-solid check.
- Fixed: the closed-solid check no longer welds a vertex to two neighbours, and merging 100k+ meshes no longer overflows the stack. `dist` is no longer minified.
