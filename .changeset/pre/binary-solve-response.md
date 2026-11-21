---
'@selvajs/compute': minor
'@selvajs/solve': minor
'@selvajs/visualization': minor
'@selvajs/selva': minor
---

A solve can now come back as a binary frame that carries each display mesh as raw bytes, not base64 inside JSON. The server no longer gzips megabytes of base64, and the browser no longer holds the whole body as text and decodes it on the main thread. Only a client that sends `Accept: application/vnd.selva.solve+binary` gets it; everything else keeps getting JSON. `createComputeFetchSolveFn` asks for it whenever `meshes` is set. `SolveEngine.solve` takes `accept`, and `@selvajs/solve/server` exports `responseVariant`. Mesh normals are now normalized `Int16Array`s, half the memory on the CPU and the GPU. The solve debug log now reports bytes on the wire, parse and mesh time, and triangle, vertex and geometry-memory totals. A signed-in caller now also gets the VektorNode fork's `X-Compute-Profile` (the slowest Grasshopper components), and the debug log prints it; a share-link caller does not, since component names describe the definition. `ServerTiming` gains `wait`, the fork proxy's wait for a free child, and the log shows it inside `queue+link`. `@selvajs/solve/server` exports `computeProfileHeader` and `COMPUTE_PROFILE_HEADER`.
