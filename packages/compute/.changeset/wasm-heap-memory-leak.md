---
'@selvajs/compute': patch
---

Fixed several memory leaks in the three.js viewer that caused unbounded growth across repeated solves and mount/unmount cycles.

- rhino3dm objects decoded during display-item parsing (curves, polylines, bounding boxes) are now explicitly deleted after use — rhino3dm is an emscripten/WASM binding, so JS GC never reclaims its heap allocations, and every solve was leaking them.
- `EdgesGeometry`'s position array is now handed to `LineSegmentsGeometry` directly instead of being round-tripped through `Array.from`, avoiding a redundant boxed copy of every vertex.
- The HDR environment texture now checks whether the viewer has been disposed before attaching, and disposes itself instead if the viewer was torn down while the HDR was still loading.
- `dispose()` now calls `renderer.forceContextLoss()` to free the WebGL context immediately, rather than waiting on GC — browsers cap live WebGL contexts (~16), and rapid mount/unmount (e.g. navigating between definitions) could exhaust that cap.
- Restoring an object's original material after deselection now disposes the highlight clone's material when the object has left the scene, since a wholesale scene clear leaves no later traversal able to reach it.
