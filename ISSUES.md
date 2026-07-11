# Known Issues — status tracker

> **Status re-verification (2026-07-11):** every issue in this file was re-checked
> against the current working tree. Each issue now carries a `Status:` line —
> **FIXED** (defect verifiably gone; evidence cited), **OPEN** (still present),
> or **PARTIAL** (part of the finding remains, stated which). The original
> audit text below each status is kept verbatim as the historical finding; its
> line numbers may have drifted. The old note "nothing has been fixed" no
> longer holds — many findings were fixed in commits between the audits and
> this re-verification.
>
> **Tally (116 issues):** 26 FIXED · 5 PARTIAL (42, 43, 57, 89, 110) ·
> 1 CLOSED BY DESIGN (115) · 84 OPEN.
> Fixed: vis 1–4; grasshopper 45–56, 58–60, 67, 68; core 86, 94, 102;
> caching 114, 116. **Every high-severity issue is now closed.** The open set
> is the medium/low tail: visualization 5–44 (minus the two partials),
> grasshopper 61–66 & 69–85, core 87–113 (minus 94, 102 and the two partials).

# Visualization Audit — Known Issues

Audit of `src/features/visualization/` (2026-07-06). Findings only — nothing had been fixed at audit time.
Categories: **bug** (incorrect behavior), **memory** (leaks/unbounded growth), **perf** (performance), **display** (visual quality / docs-vs-behavior).
Issues marked ✅ were re-verified against the code by hand; the rest were confirmed by review against the three.js r184 sources where relevant.

## High severity

### 1. GTAO renders at logical (non-DPR) resolution ✅

**Status: FIXED** — `threejs/render-pipeline.ts:80-85` — redundant `gtaoPass.setSize` removed; composer propagates DPR-multiplied size to every pass.

`threejs/render-pipeline.ts:67-70` — bug/display
`composer.setSize(w, h)` already resizes every pass to the pixel-ratio-multiplied size, but the following `gtaoPass.setSize(w, h)` overrides GTAO's render targets back down to logical CSS size. On any DPR > 1 display the AO buffers run at half resolution or less — permanently blurry/undersampled ambient occlusion, since `setSize` is called right after pipeline construction.

### 2. Per-frame resize loop when `width × DPR` has fractional part ≥ 0.5 ✅

**Status: FIXED** — `threejs/three-initializer.ts:812-818` — comparison now uses `Math.floor`, matching what `renderer.setSize` writes.

`threejs/three-initializer.ts:679-684` — perf
`checkResize` compares `renderer.domElement.width !== Math.round(width * pixelRatio)`, but `renderer.setSize` sets `canvas.width = Math.floor(width * pixelRatio)`. When `round !== floor` (e.g. DPR 1.25/1.5 on Windows with an odd client width), the condition never settles, so the resize branch runs **every frame forever**: drawing-buffer reset, `updateProjectionMatrix`, ortho frustum resync, pipeline `setSize`, and label-layer `setSize` — per frame.

### 3. View gizmo axis clicks miss — raycast camera matrix never updated ✅

**Status: FIXED** — `threejs/view-gizmo.ts:63` — `gizmoCamera.updateMatrixWorld()` called after positioning.

`threejs/view-gizmo.ts:57-59, 87-91` — bug
`gizmoCamera` is positioned at `(0, 0, 2)` but `updateMatrixWorld()` is never called and the camera is never rendered, so its `matrixWorld` stays identity. `Raycaster.setFromCamera` does not update camera matrices (three r184), so the ray originates on the cube's mid-plane (z = 0) instead of z = 2. The bright, camera-facing axis sprites sit _behind_ the ray origin and are rejected (negative t) — clicking a visible axis bubble hits nothing and falls through to scene selection; only the dim back-side sprites are hittable.

### 4. Display payload JSON-parsed twice per item ✅

**Status: FIXED** — `webdisplay/webdisplay-parser.ts:158-168` — envelope parsed once via `extractBatch`, threaded to both consumers; parse-once regression test added 2026-07-11.

`webdisplay/webdisplay-parser.ts:155-157` — perf
`processDataBranch` calls both `parseMeshBatch(item.data, …)` and `extractBatchItems(item.data)`; each JSON-parses the full envelope, which contains the entire multi-megabyte base64 SLVA blob as a string. Every solve parses the payload twice, synchronously, on the main thread — double parse CPU and transiently double string memory.

## Medium severity

### 5. GTAO camera swap leaves stale `PERSPECTIVE_CAMERA` shader define

**Status: OPEN** — `render-pipeline.ts:88` — `setCamera` only reassigns `gtaoPass.camera`; ortho shader define still stale.

`threejs/render-pipeline.ts:72-75` — display
`setCamera` assigns `gtaoPass.camera = cam`, but `GTAOPass` bakes the camera-type define into its shaders at construction. Switching to the orthographic camera (2D toggle) leaves the perspective define active — depth/view-position reconstruction is wrong, producing garbage or missing AO in 2D mode (and the reverse if built while ortho is active).

### 6. `logarithmicDepthBuffer` breaks GTAO depth reconstruction

**Status: OPEN** — `three-initializer.ts:1038` — `logarithmicDepthBuffer: true` still on with the GTAO pipeline.

`threejs/render-pipeline.ts:51` with `threejs/three-initializer.ts:902` — display
The renderer uses `logarithmicDepthBuffer: true`, but `GTAOPass` reconstructs view-space positions assuming standard perspective depth. Log-encoded depth isn't supported by three's depth-based post passes — AO intensity/falloff is computed from wrong depths (haloing, wrong-scale occlusion, worst at distance).

### 7. `config.render.pixelRatio` silently overridden after frame 1

**Status: OPEN** — `three-initializer.ts:279,812` — `buildPipeline`/`checkResize` still hardcode `Math.min(devicePixelRatio, 2)`.

`threejs/three-initializer.ts:222, 678` (vs `482, 916`) — bug
The configured pixel ratio is honored only in `setupRenderer`; `checkResize` and `buildPipeline` hardcode `Math.min(window.devicePixelRatio, 2)`. A host configuring e.g. `pixelRatio: 1` for performance is overridden on the first resize check — the option is effectively dead.

### 8. Teardown doesn't dispose material textures

**Status: OPEN** — `three-initializer.ts:460-466` — dispose paths still skip material textures (unlike `clearScene`).

`threejs/three-initializer.ts:331-342` and `disposeObjectTree` at `276-287` — memory
The final `dispose()` traversal (and `disposeObjectTree`, used by `removeUserGeometry`/`clearUserGeometry`) disposes geometries and materials but not the textures on those materials (`map`, `roughnessMap`, …) — unlike `clearScene` (`three-helpers.ts:221-225`), which does. Textured content present at teardown leaks GPU textures across viewer mount/unmount cycles.

### 9. Fit-to-view and double-click ignore the active (ortho) camera

**Status: OPEN** — `three-initializer.ts:1098,1239` — fit/double-click still use the captured perspective camera and its fov.

`threejs/three-initializer.ts:962-991, 1130-1133` — bug
`fitToView` and `handleDoubleClick` always move the captured perspective camera and use its `fov`, ignoring `getActiveCamera()`. In 2D mode only `controls.target` moves — pressing F/space or double-clicking recenters but never fits/zooms, and silently drags the invisible perspective camera out of sync.

### 10. Ortho zoom lost / stale on projection round-trips

**Status: OPEN** — `camera-controller.ts:140` — projection switch still copies position only; `ortho.zoom` never reset.

`threejs/camera-controller.ts:130-147` — bug
OrbitControls dollies an ortho camera via `object.zoom`, not position. `setProjection('perspective')` only copies position back, so zoom done in 2D is discarded on switch to 3D; and `ortho.zoom` is never reset to 1 when re-entering ortho while `syncOrthoFrustum` re-derives the frustum with the stale zoom still multiplying it. Every 2D→3D→2D round-trip after zooming produces a visible zoom jump.

### 11. `syncOrthoFrustum` sized from the stale perspective camera

**Status: OPEN** — `camera-controller.ts:118` — frustum still sized from the perspective camera's stale distance.

`threejs/camera-controller.ts:117-128` — bug
The frustum is sized from `perspective.position.distanceTo(controls.target)`, but while ortho is active only the ortho camera moves. View presets or a window resize in 2D mode compute the frustum from the perspective camera's stale distance to the _new_ target — wrong zoom on presets, zoom jumps on resize.

### 12. Glass material: depth-writing transparency + double attenuation

**Status: OPEN** — `three-materials.ts:83` — GLASS still depth-writing transparent with stacked opacity+transmission.

`threejs/three-materials.ts:78-95` — display
`GLASS_MATERIAL` is `transparent: true, opacity: 0.3` but leaves `depthWrite: true` (every other material sets it explicitly). A depth-writing transparent `DoubleSide` surface culls whatever sorts behind it — objects behind glass intermittently vanish depending on draw order. Also `opacity: 0.3` stacked on `transmission: 0.95` double-attenuates, making glass much darker than intended.

### 13. Measure snapping wrong on indexed line geometry

**Status: OPEN** — `measure.ts:115` — indexed lines still read `[hit.index, hit.index+1]` straight from the position attribute.

`threejs/measure.ts:113-116` (with `153-157`) — bug
`snapCandidateIndices` returns `[hit.index, hit.index + 1]` and `snapToVertex` reads those from the position attribute. For **indexed** lines, three's `Line.raycast` reports a cursor into the **index buffer** (r184), so snapping reads arbitrary wrong vertices — silently incorrect measurements on any indexed polyline.

### 14. Measure pick threshold scaled by distance-to-origin, not view

**Status: OPEN** — `measure.ts:286` — `viewScale = camera.position.length()` still origin/perspective-assuming.

`threejs/measure.ts:286-289` — bug
`viewScale = camera.position.length()` assumes the model sits at the world origin and a perspective camera. With an off-origin target (fit-to-content moves `controls.target`) or in ortho mode (zoom changes `camera.zoom`, not position), the line/point pick threshold becomes far too large (grabs distant curves) or too small (thin lines unclickable).

### 15. Unthrottled full-scene raycast on every mousemove

**Status: OPEN** — `measure.ts:291-302` — full-scene recursive raycast per mousemove, no throttle/mask.

`threejs/measure.ts:291-302` — perf
`handleMove` runs `raycaster.intersectObjects(scene.children, true)` per mousemove — recursive over the whole scene, collecting and distance-sorting all hits before filtering by `userData.id`. No throttle/rAF coalescing, no layer mask, no BVH/`firstHitOnly`. Hover preview hitches on large models.

### 16. `clearTextureCache` races in-flight loads

**Status: OPEN** — `texture-cache.ts:94` — load callback still repopulates the cache unconditionally after a clear.

`webdisplay/texture-cache.ts:51-80` — memory
A load resolving after `clearTextureCache()` re-populates the cache (`textureCache.set`) with a live GPU texture while its `inFlight` entry was already wiped. A texture finishing after viewer teardown is never disposed and is silently served to future materials despite the intended full reset.

### 17. Texture cache is unbounded; data-URI keys grow without limit

**Status: OPEN** — `texture-cache.ts:18` — cache still unbounded; data-URI keys still allowed.

`webdisplay/texture-cache.ts:18` — memory
Module-level `Map<string, THREE.Texture>` with no eviction. The doc assumes content-hashed URLs, but `SerializableMaterial.map` (`webdisplay/types.ts:19`) allows arbitrary data URIs — a workflow regenerating a data-URI texture per solve grows the cache unboundedly, retaining GPU textures _and_ the multi-KB/MB URI strings as keys.

### 18. Decompression trusts wire-supplied `uncompressedLen`

**Status: OPEN** — `binary-parser.ts:486` — `inflateSync` output still not verified against `uncompressedLen`.

`webdisplay/binary-parser.ts:476-487` — bug
`maybeDecompress` pre-sizes the inflate output from the header (only upper-bounded) and fflate's `inflateSync` returns the full buffer without verifying the stream filled it. A corrupt header that overstates the length yields a zero-padded tail that passes all later bounds checks — zeros silently decode as geometry instead of raising a validation error.

### 19. Group metadata trusted arithmetically — silent render corruption

**Status: OPEN** — `batch-parser.ts:460,479,531,548` — index wrap, unchecked `materialId`, clamping `subarray` all remain.

`webdisplay/batch-parser.ts:407-414, 431, 480-484, 500` — bug
Embedded-JSON group metadata is unvalidated: `rebasedIndices[i] = indicesSlice[i]! - baseIndex` underflows into a `Uint32Array` (wraps to ~4 billion); the `indexShift` path in `createMergedMesh` has the same wrap risk; `materials[group.materialId]` out-of-range passes `undefined` into `new THREE.Mesh(...)`; and `subarray` silently clamps when `vertexStart/vertexCount` exceed the buffer, leaving zero-filled merged regions. Malformed or version-skewed metadata produces silently corrupt renders rather than a parse error. Indices are also never validated against `vertexCount` in `binary-parser.ts`.

### 20. Docs promise Web Worker decompression; pipeline is fully synchronous

**Status: OPEN** — `webdisplay-parser.ts:31,42` — JSDoc still promises Web Worker decompression; path is synchronous.

`webdisplay/webdisplay-parser.ts:31, 42` — display/docs
The public JSDoc claims (twice) that "mesh decompression happens asynchronously in a Web Worker to prevent UI blocking", but the entire path is synchronous on the main thread (`batch-parser.ts:61-63` says so itself). Base64 decode, `inflateSync`, and dequantization all block the UI on large batches.

### 21. Documented exhaustiveness guarantee doesn't exist

**Status: OPEN** — `display-items-parser.ts:75` — default case still a widening cast, not a `never` assignment.

`display-items/display-items-parser.ts:72-77`, `display-items/types.ts:8-9, 74` — bug
The default case is a plain widening cast (`item as { kind?: string }`), not a `never` assignment, yet both files claim adding a new `DisplayItem` kind is a compile error until handled. A new kind (e.g. `DisplayLabel`) compiles cleanly and is silently dropped at runtime with only a log warning.

### 22. One bad curve aborts the whole display-item batch

**Status: OPEN** — `display-items-parser.ts:111-115` — `try/finally` with no catch; one bad curve still aborts the batch.

`display-items/display-items-parser.ts:110-115` — bug
`buildCurveLine` wraps `tessellate` in `try { … } finally { … }` with **no catch**, so an exception from WASM `pointAt`/`tryGetPolyline`/`getBoundingBox` propagates out of the `parseDisplayItems` loop — contradicting the stated contract at line 90 ("one bad curve never aborts the whole batch"). Every subsequent curve and point in the batch is lost.

### 23. `buildPoint` trusts network JSON — TypeError or NaN propagation

**Status: OPEN** — `display-items-parser.ts:153` — `buildPoint` still reads `position.X/Y/Z` unvalidated.

`display-items/display-items-parser.ts:152-161` — bug
`item.position.X/.Y/.Z` are read with no validation. A missing `position` throws and aborts the entire `parseDisplayItems` call (no try/catch in the loop); a partial position puts `NaN` into the `Float32BufferAttribute`, producing a NaN bounding sphere that can infect combined scene bounds and break camera fit-to-view.

## Low severity

### 24. Camera tweens are fire-and-forget and can outlive disposal

**Status: OPEN** — `three-initializer.ts:775`, `camera-controller.ts:278` — tweens still uncancellable, not stopped on dispose.

`threejs/three-initializer.ts:641-652`, `threejs/camera-controller.ts:278-288` — bug
Both rAF tweens can't be cancelled, aren't stopped by `dispose()`, and overlapping invocations run concurrent competing loops (each lerping from its own snapshot). Rapid double-clicks/preset clicks cause camera jitter; ticks touch disposed `controls` for up to ~250 ms after teardown.

### 25. HDR load failure path leaks the texture

**Status: OPEN** — `three-initializer.ts:897` — `!envMap?.image` branch still returns without disposing.

`threejs/three-initializer.ts:761-765` — memory
In the `!envMap?.image` branch the texture is not disposed (unlike the `isDisposed` branch at line 758). Minor leak on malformed HDR loads.

### 26. `updateScene` clobbers host-configured zoom limits

**Status: OPEN** — `three-helpers.ts:84,90` — `updateScene` still clobbers configured zoom limits per solve.

`threejs/three-helpers.ts:84-85, 90-91` — bug
`controls.minDistance = camera.near * 2` / `maxDistance = camera.far * 0.9` on every solve overwrite the values applied in `setupControls`. User-supplied zoom limits stop applying after the first geometry update.

### 27. Dead catch around `new THREE.Color(name)`

**Status: OPEN** — `three-helpers.ts:136-141` — dead catch around `new THREE.Color(name)` remains.

`threejs/three-helpers.ts:136-141` — bug
`new THREE.Color(name)` never throws on unknown CSS names (three logs its own warning and leaves white), so the `catch` and the custom "Invalid color string" warning are dead code. Diagnostics gap only.

### 28. `clearScene` disposes shared singleton materials

**Status: OPEN** — `three-helpers.ts:218-226` — `clearScene` still disposes shared singleton materials.

`threejs/three-helpers.ts:39, 221-227` with `threejs/three-materials.ts` — memory/perf
Clearing disposes every cleared mesh's material — including the module-scope shared singletons (`METAL_MATERIAL` et al.) if content meshes use them. `dispose()` on a still-referenced material forces a shader program rebuild on next use (per-solve recompilation hitches), and would dispose textures shared with surviving objects if any of these materials ever gain maps.

### 29. Inconsistent/no-op polygon offset across materials

**Status: OPEN** — `three-materials.ts:15,34,54` — no-op polygonOffset trio and `CONCRETE` alphaTest remain.

`threejs/three-materials.ts:15, 34, 54` — display
`EMISSIVE`, `METAL`, and `CONCRETE` set `polygonOffset: true` with default factor/units of 0 (a no-op), while PLASTIC/GLASS/RUBBER/WOOD use 1/1 — edge overlays z-fight/stitch on the three no-op materials only. `CONCRETE`'s `alphaTest: 0.5` with no alpha map also needlessly enables the alpha-test shader path.

### 30. Edge overlays rebuilt per mesh, no geometry cache

**Status: OPEN** — `edges.ts:57` — edge overlay still rebuilt per mesh, no geometry-keyed cache.

`threejs/edges.ts:50-59, 81` — perf
`addEdges` builds a fresh `EdgesGeometry` + `LineSegmentsGeometry` + `LineMaterial` per mesh, with no cache keyed on the source `BufferGeometry`. For N meshes sharing one geometry, toggling edges recomputes the same extraction N times and uploads N identical GPU buffers — the toggle stalls on large assemblies.

### 31. Edge polygon offset ≈ one depth ULP

**Status: OPEN** — `edges.ts:85-86` — polygonOffset -1 on screen-facing quads unchanged.

`threejs/edges.ts:83-86` — display
`polygonOffsetFactor/Units = -1` applies to the screen-facing fat-line quads, whose own depth slope is near zero, so the slope-scaled term is effectively nil. Edges lying exactly on the surface can still stipple/z-fight at glancing angles or far zoom on 24-bit depth buffers.

### 32. Label overlay `100%` sizing is dead code

**Status: OPEN** — `label-layer.ts:49-50` — `100%` sizing still overwritten by `setSize` pixel values.

`threejs/label-layer.ts:49-50` vs `64` — display
`CSS2DRenderer.setSize` overwrites the overlay's style with pixel values, so `dom.style.width/height = '100%'` never tracks the container as the comment implies. If the resize loop misses a `setSize`, the overlay box and projection math go stale and labels drift off their anchors.

### 33. Wrong/lossy unit scale factors; unknown units silently scale 1

**Status: OPEN** — `webdisplay-parser.ts:19-20,107` — approximate Inches/Feet factors; unknown units still scale 1 silently.

`webdisplay/webdisplay-parser.ts:15-21` (public via `index.ts` `SCALE_FACTORS`) — bug
`Inches: 1/39.37` and `Feet: 1/3.28084` are approximations of the exact 0.0254 / 0.3048 and are mutually inconsistent (~2e-7 relative error compounds in round-trips). Unknown-but-valid Rhino units (Kilometers, Microns, Miles, …) fall back to factor 1 with no warning — a kilometers model renders 1000× off with no diagnostic.

### 34. Fragile substring type dispatch

**Status: OPEN** — `webdisplay-parser.ts:146` — substring `includes('Display')` dispatch unchanged.

`webdisplay/webdisplay-parser.ts:146` — bug
`item.type.includes(DISPLAY_COMPONENT_TYPE)` substring-matches `'Display'`, so any unrelated type containing "Display" is fed to the SLVA parser (which logs an error and returns `[]` per item).

### 35. Parse errors swallowed → silent empty scene

**Status: OPEN** — `batch-parser.ts:53-56,101-104,144-147` — entry points still catch/log/return `[]` while docs claim rethrow.

`webdisplay/batch-parser.ts:52-55, 99-102` — display
All three entry points catch every error, log, and return `[]`, so a corrupt/truncated/unsupported blob manifests as an empty scene with no signal — while `getThreeMeshesFromComputeResponse`'s doc (`webdisplay-parser.ts:36`) promises it "rethrows unexpected errors", which can never happen for parse failures.

### 36. Payload readers assume little-endian host

**Status: OPEN** — `binary-parser.ts:515-558` — geometry readers still host-byte-order.

`webdisplay/binary-parser.ts:515-558` — bug
Header fields use explicit-LE `DataView` reads, but the zero-copy geometry readers construct typed-array views in host byte order. Latent spec violation on big-endian hosts (practically negligible on mainstream targets).

### 37. `MeshMetadata` doc wrong for uint16 indices

**Status: OPEN** — `types.ts:29` — `indexStart * 4` doc still wrong for uint16 indices.

`webdisplay/types.ts:28-29` — docs
"index byte offset = `indexStart * 4`" is wrong for `FLAG_UINT16_INDICES` blobs (2 bytes/index, wire v2). Consumers actually use element offsets; anyone following this doc computes wrong byte positions.

### 38. Stale coordinate-transform docs / dead `applyTransforms` option

**Status: OPEN** — `coordinate-transform.ts:33` — `rhinoToThree` still identity while docs describe a rotation.

`display-items/display-items-parser.ts:43-44`, `display-items/types.ts:40, 65` vs `coordinate-transform.ts:33-35` — display/docs
`applyTransforms` is documented as toggling the Rhino Z-up → Three Y-up rotation, but `rhinoToThree` is the identity and the option is a dead parameter. Consumers following the docs will pre-rotate their own geometry and land 90° off.

### 39. Vector allocation churn in curve tessellation

**Status: OPEN** — `display-items-parser.ts:352-372` — per-test Vector3 allocation churn unchanged.

`display-items/display-items-parser.ts:352-372` — perf
`turnAngle`/`distanceToSegment` allocate 4-5 temporary `Vector3` clones per subdivision test inside a recursion capped at ~12 spans × 2^12 evaluations — up to ~200k short-lived vectors per pathological curve. Scratch vectors or scalar math would eliminate the GC pressure.

### 40. Incomplete public re-exports of binary-format constants

**Status: OPEN** — `index.ts:50-58` — `FLAG_UINT16_INDICES`, `UV_FORMAT_*`, `COMPRESSED_MESH_MAGIC`, `MIN_SUPPORTED_VERSION` still not re-exported.

`index.ts:50-58` — API
`FLAG_FLOAT32`, `FLAG_DELTA_ENCODED`, `FLAG_HAS_UVS`, `FLAG_HAS_VERTEX_COLORS` are re-exported, but `FLAG_UINT16_INDICES`, `UV_FORMAT_UINT16/UV_FORMAT_FLOAT32`, `COMPRESSED_MESH_MAGIC`, and `MIN_SUPPORTED_VERSION` are not — yet `ParsedBinaryMeshBatch.flags` and the `Uint16Array | Uint32Array` indices union are public, so consumers must hard-code `0x2` to distinguish index width.

### 41. Mixed module-specifier styles in the public barrel

**Status: OPEN** — `index.ts:13-38` vs `44-105` — mixed `.js`/extensionless specifiers remain.

`index.ts:13-38` vs `44-102` — API
The threejs block uses explicit `.js` extensions; the webdisplay/types/display-items block is extensionless. Fine under `moduleResolution: "bundler"`, breaks half the file under NodeNext emit or direct tsc consumption.

### 42. Stale/stub READMEs and dangling doc links

**Status: PARTIAL** — top-level README stub was replaced; `threejs/README.md:26,48` still has the wrong package name, `getMeshesFromDoc`, and the dangling `{@link CURVE_TESSELLATION_SEGMENTS}`.

`threejs/README.md:27, 52`, `README.md`, `display-items/display-items-parser.ts:213-214` — docs
The threejs README imports from a wrong package name (`rhino-compute-core/threejs`) and calls a non-existent `getMeshesFromDoc` (real entry point: `getThreeMeshesFromComputeResponse`). The top-level README is a "TODO: ADD DESCRIPTION" stub. A `{@link CURVE_TESSELLATION_SEGMENTS}` dangles after the constant was renamed `CURVE_INITIAL_SEGMENTS`.

### 43. Grid nits

**Status: PARTIAL** — the renderOrder comment was reworded; `grid.ts:164-167` `dispose()` still omits `removeFromParent()`.

`threejs/grid.ts` — display/memory
Otherwise clean (shader math, recentering, disposal verified). Two nits: the `renderOrder = -1` comment ("draw before content") is inaccurate — it only orders the grid first within the transparent pass (which is the behavior that matters); and `dispose()` doesn't `removeFromParent()`, so callers must detach the mesh themselves or a dead mesh stays in the scene graph.

### 44. View-gizmo `isAnimating` is permanently `false`

**Status: OPEN** — `view-gizmo.ts:135` — wrapper still never calls `ViewHelper.handleClick`; `isAnimating` constant false.

`threejs/view-gizmo.ts:127-136` — note
`helper.animating` is only set by ViewHelper's own `handleClick`, which the wrapper never calls, so `update()` is a permanent no-op and `isAnimating` always returns `false`. Consistent with the comments, but callers gating input on it get a constant.

## Test gaps (webdisplay)

- No test for an SLVZ header whose `uncompressedLen` disagrees with the actual inflated size (issue 18's silent zero-padding).
- No test for indices out of range of `vertexCount`, out-of-range `materialId`, or bad `vertexStart` (issue 19's silent corruption).
- `texture-cache.ts` has no test file at all — the clear/in-flight race (issue 16) is untested.
- ~~`webdisplay-parser` tests only exercise empty/no-Display responses~~ — partially closed 2026-07-11: an end-to-end Display item with a real blob now exists and pins the single-parse behavior (issue 4). Unit scaling and ground offset still untested.
- No test for unknown model units falling back to scale 1 (issue 33).

---

# Grasshopper Audit — Known Issues

Audit of `src/features/grasshopper/` (2026-07-06). Findings only — nothing had been fixed at audit time; see per-issue `Status:` lines for the 2026-07-11 re-verification. Numbering continues from the visualization audit. Issues marked ✅ were re-verified against the code by hand.

## High severity

### 45. README documents an API that doesn't exist

**Status: FIXED** — README rewritten: `@selvajs/compute` import, `GrasshopperClient.create()`, real `solve(definition, dataTree)` signature, runnable example linked.

`grasshopper/README.md:9-22, 87-117, 125-126, 217-225` — api/docs
The Quick Start imports from `'@rhino-compute/core'` (package is `@selvajs/compute`) and calls `new GrasshopperClient({...})`, but the constructor is private — the only entry point is `await GrasshopperClient.create(config)`. Every `client.solve(...)` example passes a plain values object and reads `result.data`, while the real signature is `solve(definition, dataTree: DataTree[], options?)` returning `GrasshopperComputeResponse` (no `data` field). `groupInputs` is documented but exists nowhere in `src/`. Plus a broken link (`io/input/input-parsers/README.md`) and a "TODO: Create examples" immediately contradicted by "See the `examples/` directory". Copy-pasting the README fails at compile time on every example.

### 46. Aborting a queued solve is silently ignored ✅

**Status: FIXED (2026-07-11)** — `scheduler/solve-scheduler.ts` — queued-phase abort listener settles the item as ABORTED, removes it from the queue, fires `onSettle`; regression tests for queue and latest-wins pending.

`scheduler/solve-scheduler.ts:358, 384-396, 414-415` — bug
The external `AbortSignal` is only checked at `solve()` entry and only listened to inside `execute()`. If the signal fires while the item sits in `fifoQueue`/`pendingForLatestWins`, the event has already dispatched by the time the listener is added — the item stays queued (retaining `definition`/`dataTree`), later runs a full compute anyway, and the promise resolves with a result instead of rejecting with `ABORTED`, violating the documented contract at line 304. No test covers aborting a not-yet-in-flight item.

### 47. `CommonObject.decode` fallback is fed the wrong payload shape ✅

**Status: FIXED** — `io/output/rhino-decoder.ts` — fallback feeds the WHOLE envelope via `isDecodableEnvelope`; tests use the real envelope shape.

`io/output/rhino-decoder.ts:44-47, 69-70` — bug
`extractPayload` unwraps to `parsedData.data ?? parsedData.value`, but a real Compute geometry item is the rhino3dm envelope `{version, archive3dm, opennurbs, data: "<base64>"}` and `CommonObject.decode` expects the **whole envelope** — the repo's own correct usage is `display-items-parser.ts:194`. Passing the bare base64 string means the fallback throws (returning the `__decodeError` sentinel) or yields garbage for every unregistered geometry type (Mesh, Brep, Curve, …). The unit tests pin this behavior with a fake `decode`, encoding the bug rather than catching it.

### 48. Decoded rhino3dm WASM objects are never freed

**Status: FIXED (2026-07-11)** — `io/output/rhino-decoder.ts` `disposeRhinoObjects()` + `GetValuesResult.dispose()`; alias-safe, idempotent; tests pin exact-once deletion.

`io/output/rhino-decoder.ts:20-30, 70` with `io/output/response-processors.ts:95-97, 181` — memory
`new rhino.Point(...)`, `new rhino.Line(...)`, and `rhino.CommonObject.decode(...)` produce emscripten WASM-heap objects that must be `.delete()`d — the repo says so itself (`display-items-parser.ts:182-185`). `getValues`/`getValue` eagerly decode every geometry item into a plain result map with no disposal API, no tracking, and no cleanup on any path. A UI calling `getValues(..., { rhino })` per slider tick grows the WASM heap monotonically until the tab dies.

### 49. One malformed input aborts the whole definition-IO fetch ✅

**Status: FIXED** — `io/input/normalize-default.ts` — `Array.isArray` guard degrades to MALFORMED_DEFAULT; `input-processors.ts` wraps normalization in try/catch so one bad input can't abort the fetch.

`io/input/normalize-default.ts:95-96` with `io/input/input-processors.ts:66-75` — bug/validation
The tree-access branch does `(items as any[]).map(...)` with no `Array.isArray` guard (the flatten path at lines 129-131 has one), and `normalizeDefaultWithWarning` is called **before the `try`** in `processInputWithError`. A branch value that isn't an array throws a raw `TypeError` that escapes unwrapped — one malformed input aborts the entire `fetchParsedDefinitionIO` call instead of producing a per-input `parseErrors` entry.

## Medium severity

### 50. Cache hit doesn't supersede an in-flight solve — stale result delivered after newer one

**Status: FIXED (2026-07-11)** — a latest-wins cache hit now supersedes the pending/in-flight solve (`supersedeCurrent`); regression test pins that the stale completion can't overwrite the hit.

`scheduler/solve-scheduler.ts:328-345` — bug
The synchronous cache-hit path returns before `enqueue()`, so in `latest-wins` mode a hit doesn't abort the older in-flight solve. Slider scrub A is in flight; scrub B hits the cache and updates the UI; A later completes, overwrites `_lastResult`, fires `onSettle`, and notifies subscribers — the UI snaps back to the older result.

### 51. `cancelAll` durations mix `Date.now()` and `performance.now()` ✅

**Status: FIXED (2026-07-11)** — `cancelAll` measures `Date.now() - startedAt` (same clock as `startedAt`); sanity test added.

`scheduler/solve-scheduler.ts:412, 633` — bug
`startedAt` is set from `Date.now()` but `cancelAll` computes `durationMs: performance.now() - startedAt` — a huge negative number (≈ −1.7e12). Any consumer logging `onSettle` durations for cancelled solves gets garbage.

### 52. Late-settling failure clobbers newer scheduler state

**Status: FIXED (2026-07-11)** — last-result state goes through seq-guarded `writeLastState`; a late settle can no longer clobber newer state. The existing pinned behavior (superseded cause reaches `lastError` when nothing newer exists) still holds.

`scheduler/solve-scheduler.ts:457-460` — bug
The catch path sets `_lastError`/`_lastDurationMs` unconditionally even when the item was already settled (superseded/aborted). In `parallel` mode: `cancelAll()` settles slow solve A, fresh solve C succeeds (`_lastError = null`), then A's abort rejection lands, sets `_lastError = ABORTED(A)`, and notifies — subscribers see an error state after the newest solve succeeded.

### 53. `stableStringify` collides `[undefined]` with `[]` ✅

**Status: FIXED (2026-07-11)** — `stringify(undefined)` returns a real string; `[undefined]` ≠ `[]`, sparse arrays ≠ `[]`; top-level return type honest. Regression tests added.

`scheduler/stable-hash.ts:14, 27` — bug
`stringify(undefined)` returns `JSON.stringify(undefined)` — the value `undefined`, not a string — and `v.map(stringify).join(',')` turns it into an empty string, so `stableStringify([undefined]) === stableStringify([])` while the actual payloads sent to the server differ (`[null]` vs `[]`): a cache-key collision that serves the wrong cached response. Top-level `stableStringify(undefined)` also returns `undefined` despite the declared `string` return type.

### 54. Circular guard never un-marks — shared references hash as `[Circular]` ✅

**Status: FIXED (2026-07-11)** — cycle guard tracks only the recursion path (un-marks on exit); shared refs hash by content; circular ARRAYS (previously a stack overflow) also guarded.

`scheduler/stable-hash.ts:30-31` — bug
`seen.add` is never removed after a subtree finishes, so a shared (non-circular) reference stringifies as `"[Circular]"` on its second occurrence. `[a, a]` and `[{x:1},{x:1}]` hash differently for identical payloads (defeats the cache), and `[a, a]` collides with any payload whose second element also re-references a seen object (wrong cached response).

### 55. `Date`/`Map`/`Set` all hash as `{}`

**Status: FIXED (2026-07-11)** — `toJSON` honored (Dates → ISO strings); Map/Set get content-based, order-independent representations.

`scheduler/stable-hash.ts:29-34` — bug
Non-plain objects fall into the generic `Object.keys` branch with no `toJSON` support — any `Date`, `Map`, or `Set` stringifies as `{}` (no own enumerable keys). All Dates collide with each other and with `{}` as cache keys, while the transport's `JSON.stringify` would serialize a Date to its distinct ISO string: different requests, same key, wrong cached solve.

### 56. `Uint8Array` tree values keyed by first/last 32 bytes only ✅

**Status: FIXED (2026-07-11)** — tree `Uint8Array`s keyed by a full-content `fnv1aBytes` pass (one linear scan, no sampling).

`scheduler/stable-hash.ts:20-24` — bug
Binary inputs > 64 bytes inside the data tree are keyed by length + head/tail sample; two solves differing only in the middle bytes share a cache key and one gets the other's cached response. The definition hasher was explicitly fixed for exactly this class of bug (`stable-hash.test.ts:68-77` pins it) — the tree path wasn't.

### 57. Full input hashed on every solve, definition hashed twice

**Status: PARTIAL (2026-07-11)** — `DefinitionRef` solves key by identity with no hashing or materialization at all. String/`Uint8Array` definitions are still FNV-hashed at `solve()` entry and `hashDefinition` runs again in `runExecutor`.

`scheduler/solve-scheduler.ts:320, 491` — perf
`hashSolveInput` runs on every `solve()` even with caching disabled (key only used for hook context) — a full FNV pass over the potentially multi-MB base64 definition plus a full `stableStringify` of the tree, synchronously, per slider tick. `runExecutor` then calls `hashDefinition(definition)` again — the definition is linearly hashed twice per solve. Identity-memoizing the definition hash would remove most of it.

### 58. Responses retain the full base64 definition (`algo`) — multiplied by the cache

**Status: FIXED** — `solve.ts` `runSolve` strips both `pointer` and `algo` via shallow copy; regression test pins it (the 2026-07-11 re-review note was stale).

`grasshopper/solve.ts:207-215` with `scheduler/solve-scheduler.ts:186` — memory
`runSolve` strips `pointer` from the response but keeps `algo`, which the server echoes back on every solve. For a multi-MB definition every response retains a full base64 copy, and the scheduler's LRU holds up to `maxEntries` of them — a slider UI with caching enabled can pin tens/hundreds of MB of redundant base64 for the scheduler's lifetime.

### 59. Browser-exposure warning only fires in debug mode

**Status: FIXED (2026-07-11)** — `warnIfClientSide` un-gated from `debug` in all three solve entry points; `suppressBrowserWarning` is now the sole opt-out; once-per-function dedupe added.

`grasshopper/solve.ts:121-126, 147-152, 174-179` — bug
`warnIfClientSide` is only invoked inside `if (config.debug) { ... }`, though it carries its own suppression gate (`suppressBrowserWarning`). In the default configuration, users running solves with an API key in the browser get no warning, and the `suppressBrowserWarning` option is effectively inert.

### 60. `LineCurve` prefix-matches the `Line` decoder and decodes to `null`

**Status: FIXED (2026-07-11)** — a registered decoder returning `null` now falls through to the CommonObject fallback; LineCurve prefix-collision test pinned.

`io/output/rhino-decoder.ts:26-30, 36-42, 58-61` — bug
`findDecoder` matches via `rhinoType.startsWith(key)`, so `Rhino.Geometry.LineCurve` resolves to the `Rhino.Geometry.Line` decoder; its guard returns `null` from inside the `try`, which is returned directly and never reaches the `CommonObject.decode` fallback the envelope needs. Every LineCurve output silently decodes to `null`.

### 61. Deep decode spreads arrays into plain objects

**Status: OPEN** — `rhino-decoder.ts:157,177` — deep mode still spreads arrays into plain objects.

`io/output/rhino-decoder.ts:95, 115-117` — bug
With `deep: true`, a nested array recurses into `decodeRhinoObject`, whose first line `const out = { ...obj }` spreads it into `{ 0: ..., 1: ... }`. `{ points: [pt1, pt2] }` comes back with `points` as a keyed object — `Array.isArray`/`.map` break downstream. The deep-mode test only covers nested plain objects.

### 62. Response processors crash on missing/alternate-cased `InnerTree`

**Status: OPEN** — `response-processors.ts:148,179` — exact-cased `InnerTree` reads with no null guard remain.

`io/output/response-processors.ts:136-145, 170-171, 201-202, 238, 249` — bug
`getValues`/`getValue`/`extractFileData` read `param.InnerTree`/`param.ParamName` with exact casing and no null guard; `forEachTreeItem` calls `Object.values(undefined)` → `TypeError`. `solve.ts:48-63` explicitly defends against exactly this (case-insensitive reads, missing-`InnerTree` handling), and the e2e fixtures include params with no `InnerTree`. A warnings-only partial success (which `client.solve` returns) crashes response processing with an opaque TypeError.

### 63. Partial-success values are thrown away

**Status: OPEN** — `grasshopper-client.ts:181-197` — partial-success `result.values` still discarded on throw.

`client/grasshopper-client.ts:171-187` — error-handling
On a partial-success response the client throws `COMPUTATION_ERROR` with `errors`/`warnings` in context but discards `result.values` — even though the transport (`compute-fetch.ts:351-369`) specifically parses partial values out of the HTTP 500 body. Callers can't render the outputs that did compute or inspect which failed.

### 64. Tree-access default parsing diverges from the scalar path ✅

**Status: OPEN** — `normalize-default.ts:112,116` — blank-double→0, lax boolean, and narrow type coverage all remain in the tree path.

`io/input/normalize-default.ts:100-121` vs `io/input/input-type-parsers.ts:76-91, 207-222` — bug
Three inconsistencies between tree-access and item-access defaults for the same wire data:

- `Number('')` → `0`: the tree path has no empty/whitespace guard, so a blank `System.Double` default becomes 0 where the scalar path deliberately yields `undefined` (its comment calls out exactly this trap).
- Booleans: tree path is `data.toLowerCase() === 'true'` — `'maybe'`, `'1'`, `''` silently become `false`; the scalar `booleanTransformer` throws and surfaces a `parseErrors` entry.
- Type coverage: only `System.Double`/`Int32`/`Boolean`/`Rhino.Geometry*` are handled — `System.Single`/`Int64`/`Decimal` and locale-comma numbers stay **strings** inside a `DefaultValue<number>` tree, and tree `Int32` items aren't rounded while scalar Integer defaults are.

### 65. Array defaults nulled with a misleading `MALFORMED_DEFAULT`

**Status: OPEN** — `normalize-default.ts:75-82` — array defaults still nulled as MALFORMED_DEFAULT.

`io/input/normalize-default.ts:71-81` — bug
An array default reaches the malformed branch (`typeof [] === 'object'`, no `innerTree` key) and is nulled with an "unrecognized shape" warning — yet `processInputs` is public and `coerceDefault` explicitly supports array defaults. `{ paramType: 'Number', default: [1,2,3] }` loses its default entirely.

### 66. Server-provided `stepSize` read, typed, and then ignored

**Status: OPEN** — `input-type-parsers.ts:227-244` — `computeNumeric` still never consults `schema.stepSize`.

`io/normalize-schema.ts:49` with `io/input/input-type-parsers.ts:227-244` — bug
`stepSize` is read off the wire and declared on `InputParamSchema`, but `computeNumeric` never consults it — the step is always re-derived from default/min/max heuristics. An author-specified step of 0.5 silently becomes e.g. 0.1.

## Low severity

### 67. Scheduler abort/cancel edge cases

**Status: FIXED (2026-07-11)** — already-aborted signal rejects ABORTED before the cache is consulted; `cancelAll` fires `onSettle` for queued/pending items too.

`scheduler/solve-scheduler.ts:328-361, 617-644` — error-handling
The cache is consulted before the already-aborted-signal check, so `solve(def, tree, { signal: alreadyAborted })` resolves on a cache hit instead of rejecting `ABORTED` as documented. And `cancelAll()` fires an error `onSettle` for in-flight items but not for queued/pending ones (`rejectAsAborted` skips the hook) — UIs counting starts vs settles leak "in progress" indicators.

### 68. Cache-key hygiene: bigint collision and single 32-bit final hash

**Status: FIXED (2026-07-11)** — cache key keeps `defHash|treeHash` parts (each with length) instead of one collapsed 32-bit hash; bigint stringifies with an `n` suffix, distinct from strings.

`scheduler/stable-hash.ts:19, 81-83` — bug
`1n` and `"1"` stringify identically (cross-type collision, mostly theoretical since the transport would throw on bigint). The final key is one 32-bit FNV-1a hash, so distinct (definition, tree) pairs can birthday-collide — negligible at 50 LRU entries but quadratic in `maxEntries`; keeping the two-part `defHash|treeHash` string would eliminate it.

### 69. Plain-string definitions that look like base64 are sent raw

**Status: OPEN** — `solve.ts:276` + `encoding.ts:34-39` — base64-shaped plain strings still sent raw.

`grasshopper/solve.ts:246-254` — bug
`isBase64` checks only length % 4 and alphabet, so a plain string like `"abcd1234"` is passed through verbatim as `algo` instead of being encoded — the documented "plain string (will be base64-encoded)" contract silently fails and the server decodes garbage bytes. The test only uses a string containing spaces.

### 70. Contradictory `cacheKey` docs for URL-pointer solves

**Status: OPEN** — `solve.ts:84-85` vs `141` — contradictory `cacheKey` docs unchanged.

`grasshopper/solve.ts:79-89 vs 132-141` — api/docs
`SolveWithCacheKey.cacheKey` says "`null` when the server didn't return one (e.g. a URL-pointer solve)" while `solveGrasshopperDefinitionWithCacheKey` says a URL-pointer solve returns the URL. The server echoes the schema back, so the URL comes back — line 84 is the wrong doc; callers detecting "no key" via `null` get the URL string instead.

### 71. `DataTree` type hardcodes PascalCase the server may not use

**Status: OPEN** — `types.ts:54-57` — `DataTree` still hardcodes PascalCase-only fields.

`grasshopper/types.ts:54-57` — api
`DataTree` declares `InnerTree`/`ParamName`, but camelCase server forks return `innerTree`/`paramName` — which is why `warnOnEmptyInnerTrees` reads case-insensitively and `empty-inner-trees.test.ts` pins lowercase. `values[i].InnerTree` per the type is `undefined` at runtime with no type error.

### 72. `GrasshopperComputeResponse` over- and under-promises; `OutputType` is decorative

**Status: OPEN** — `types.ts:81,292-305` — over/under-promising response type and `| string` OutputType unchanged.

`grasshopper/types.ts:66-81, 289-309` — api
`cachesolve`/`modelunits`/`algo`/`dataversion` are declared required but nothing enforces them (the library's own mocks violate it), while the type still inherits optional `pointer` even though `runSolve` guarantees it's stripped. `OutputType` ends with `| string`, collapsing the whole union — no narrowing or autocomplete (conventional fix: `| (string & {})`).

### 73. Inconsistent scalar transformer edge cases

**Status: OPEN** — `input-type-parsers.ts:87-91` — transformer edge cases (no trim, throw-vs-null, Infinity/hex) remain.

`io/input/input-type-parsers.ts:76-94` — bug
`booleanTransformer` doesn't trim (`' true'` throws while numeric trims) and throws instead of returning `null` per the `ValueTransformer` contract — one bad string in `['true','maybe']` aborts the array and the fallback yields `[false]`, while non-string junk is merely filtered. `numericTransformer` accepts `'Infinity'`/`'-Infinity'`/hex `'0x10'` (Infinity survives `applyRounding`), while locale `'1,5'` silently becomes `undefined` with no `parseErrors` entry.

### 74. Parse-error path drops the default-warning and mislabels `paramType`

**Status: OPEN** — `input-processors.ts:104-112` — parser-throw path still drops the default warning and reports canonical paramType.

`io/input/input-processors.ts:60-94` — validation
When a parser throws _and_ normalization produced a `MALFORMED_DEFAULT` warning, only the thrown error is reported — `defaultWarningError` is dropped. And `error.paramType` is the canonicalized type while the `InputParseError.paramType` docs promise the raw declared one — clients matching on the casing they sent won't find it.

### 75. ValueList parsing cluster

**Status: OPEN** — `input-type-parsers.ts:358,371,380` — ValueList cluster unchanged.

`io/input/input-type-parsers.ts:355-381` — bug
Membership check is case-insensitive but the default passes through verbatim (case-mismatched default passes yet misses `values[default]` downstream); a tree/array-shaped default stringifies to `'[object Object]'` in the check then is cast to `string | undefined`; and the fallback can produce `[undefined]` while keeping a default provably absent from the empty `values` map.

### 76. Numeric fallback omits `stepSize` and ignores `minimum`

**Status: OPEN** — `input-type-parsers.ts:300-311` — numeric fallback still omits stepSize and ignores `minimum`.

`io/input/input-type-parsers.ts:300-311` — api
A failed numeric input gets `stepSize: undefined` (parse always sets it) and a safe default of `0`/`[0]` even when `schema.minimum` is e.g. 1 — a UI renders a slider default below its own floor.

### 77. Schema normalization hides missing wire fields behind casts

**Status: OPEN** — `normalize-schema.ts:38-55` — `as string`/`as number` casts on missing wire fields and `groupName ?? ''` remain.

`io/normalize-schema.ts:39-54` — api
`as string`/`as number` casts make missing wire fields typecheck as required (`InputParamSchema` declares them required; downstream code betrays it with `paramType?.toLowerCase()` and `?? 1` fallbacks). `groupName: null` is coerced to `''`, losing the absent-vs-empty distinction the `string | null` type implies.

### 78. Definition-IO stale docs and dropped diagnostics

**Status: OPEN** — `definition-io.ts:13-14,90` — "exactly as received" doc still contradicts normalization; `nonEmptyStrings` still drops non-string diagnostics.

`io/definition-io.ts:13-14, 90-94` with `grasshopper/types.ts:255-262` — api/validation
`fetchDefinitionIO` claims to return data "unprocessed … exactly as received", but it runs `normalizeInputSchema`/`normalizeOutputSchema`; `IoResponseSchema`'s "no key conversion" doc is contradicted by the same file's PascalCase handling. And `nonEmptyStrings` silently drops non-string diagnostic entries — a server reporting errors as `{ message }` objects yields an empty inputs list with no explanation, the exact failure the surrounding comment says the code prevents.

### 79. Malformed tree paths collapse to `{0}` and merge branches

**Status: OPEN** — `data-tree.ts:438-439`, `tree-path.ts:11` — malformed paths still collapse to `{0}`; negatives rejected.

`data-tree/data-tree.ts:434-444` with `data-tree/tree-path.ts:11` — bug
`parsePathString` maps any malformed path to `[0]` with only a warning, and `TREE_PATH_RE` rejects negative indices even though Grasshopper `GH_Path` allows them. Two unparseable keys (`{-1}`, `{-2}`) both collapse to `{0}` and their items silently merge into one branch — corrupted topology instead of an error.

### 80. `deserializeValue` coerces numeric-looking strings

**Status: OPEN** — `data-tree.ts:517-518` — numeric-looking strings still coerced on read-back.

`data-tree/data-tree.ts:507-523` — bug
Any numeric-looking string becomes a number on read-back: `'007'` → `7`, `'1e5'` → `100000`, `'Infinity'` → `Infinity`. The empty/whitespace guard fixed only the worst instance of the class.

### 81. Legitimate `null` items dropped, shifting indices

**Status: OPEN** — `data-tree.ts:419-421` — real `null` items still filtered, shifting indices.

`data-tree/data-tree.ts:418-421` — bug
`readFromDataTrees` filters `v !== null` after deserializing, so real `null` items in a branch are dropped (indices shift), and an all-null branch reads as "param not found" via the `length === 0 → null` path.

### 82. `replaceTreeValue` mutates the caller's array despite docs

**Status: OPEN** — `data-tree.ts:298-311` — `replaceTreeValue` still mutates the caller's array despite docs.

`data-tree/data-tree.ts:287-311` — bug
Doc promises "a new/modified TreeBuilder array" but the function assigns `builders[idx] = builder` and pushes into `dataTrees` in place — callers keeping pristine defaults from `fromInputParams` get them silently overwritten by slider updates.

### 83. Thrown errors pin the full data tree

**Status: OPEN** — `grasshopper-client.ts:191,215` — thrown errors still pin the full data tree via `inputs`.

`client/grasshopper-client.ts:181, 208` — memory
Both error paths attach `inputs: dataTree` to the thrown `RhinoComputeError`. Trees can embed multi-MB geometry/base64; errors retained by logging/telemetry/error boundaries pin those buffers, and logging dumps the full payload.

### 84. Response processing re-parses everything on every read

**Status: OPEN** — `response-processors.ts:167,235` — no memoization; `getValue({byId})` still double-scans.

`io/output/response-processors.ts:55-75, 159-194, 236-249`, `client/grasshopper-response-processor.ts:49-76` — perf
Nothing is memoized: every `getValues()`/`getValue()` re-walks the response and re-runs `tryDecodeJSON` (up to two full `JSON.parse` passes per item) over potentially multi-MB envelope strings; `getValue({byId})` scans all trees twice with no early exit.

### 85. Decoder failure signaling is inconsistent

**Status: OPEN** — `rhino-decoder.ts:76,85,88` — three inconsistent failure signals remain (warn-fallthrough / raw passthrough / sentinel).

`io/output/rhino-decoder.ts:60-76` — error-handling
Registered-decoder exceptions are swallowed to a warn then fall through; a missing payload returns the raw input unchanged; only a throwing `CommonObject.decode` yields the `__decodeError` sentinel. Callers can't distinguish "decoded", "passed through raw", and "failed" without duck-typing every result.

## Test gaps (grasshopper)

> **Update 2026-07-11:** the scheduler and stable-hash gaps are closed —
> queued-item abort (46), cache-hit supersede (50), `cancelAll` `onSettle`
> for queued items + `durationMs` sanity (51/67), late-settle state (52, uses
> `parallel` mode), and full stable-hash coverage (53-56, 68) are all
> test-pinned now. Also closed: `algo` stripping (58), envelope-shaped
> fallback + `LineCurve` prefix-collision (47/60), and WASM disposal (48).
> The remaining bullets below still hold for the still-OPEN issues.

- Solve: no coverage for base64-shaped plain strings (issue 69) or URL-pointer `cacheKey` behavior (issue 70).
- Decoder/output: no deep-array, missing/alternate-cased `InnerTree`, or warnings-only-partial-success coverage (issues 61-63).
- IO/input: no tests for empty-string tree doubles, invalid tree booleans, array defaults via public `processInputs`, server `stepSize`, `Infinity`/hex strings, or raw-vs-canonical `InputParseError.paramType` (issues 64-66, 73-74).
- Data-tree: no negative-index, malformed-key branch-merge, or null-item coverage (issues 79-81).

---

# Core Audit — Known Issues

Audit of `src/core/` (2026-07-06). Findings only — nothing had been fixed at audit time; see per-issue `Status:` lines for the 2026-07-11 re-verification. Numbering continues from the grasshopper audit. Issues marked ✅ were re-verified against the code by hand.

## High severity

### 86. `composeSignal` cleanup is a no-op on the modern path ✅

**Status: FIXED** — `composeSignal` no longer uses `AbortSignal.any`; composes manually with removable listeners and real cleanup on every path; modern-path cleanup test cites this issue.

`core/compute-fetch/compute-fetch.ts:262-279` — memory
When `AbortSignal.timeout` and `AbortSignal.any` exist (all modern runtimes), `cleanup` stays the initial `() => {}` — only the legacy fallback paths clear their timer/listeners. Every attempt (including each retry) creates a fresh timeout signal plus a dependent registration on the caller's signal that lives for the full `timeoutMs` after the response arrives. An app reusing one long-lived `AbortController.signal` across many solves accumulates registrations (Node warns `MaxListenersExceededWarning` at >10 concurrent; Node versions with the known `AbortSignal.any` leak never free them). `compose-signal.test.ts` forces the fallback path only, so the default path has zero cleanup coverage.

## Medium severity

### 87. Deterministic non-JSON 200s are retried as "truncated stream" ✅

**Status: OPEN** — `compute-fetch.ts:626-630` — `isTruncatedSuccess` still retries any 2xx whose body fails to parse.

`core/compute-fetch/compute-fetch.ts:603-615` — bug
Any 2xx whose body fails `response.json()` is classified retryable (`isTruncatedSuccess`). A captive portal, reverse-proxy login page, or misconfigured endpoint returning HTML 200 burns the full retry/backoff schedule before failing with the misleading pair `code: NETWORK_ERROR, statusCode: 200`.

### 88. Runtime-internal aborts become "timed out after undefinedms" and are retried ✅

**Status: OPEN** — `compute-fetch.ts:568-590` — runtime abort with no caller signal/timeout still yields "timed out after undefinedms" and retries.

`core/compute-fetch/compute-fetch.ts:529-571` — bug
When fetch rejects with `AbortError`/`TimeoutError` but no caller signal aborted and no `timeoutMs` was configured, the code still takes the timeout branch: message `Request timed out after undefinedms`, code `TIMEOUT_ERROR`, and spurious retries for an abort that wasn't ours (e.g. undici socket teardown).

### 89. `timeoutMs` is per-attempt, not total — undocumented

**Status: PARTIAL** — `compute-fetch.ts:496`, `types.ts:89` — doc now says "Per-request" but the signal is still rebuilt per attempt and the retry-multiplied wall-clock remains undocumented.

`core/compute-fetch/compute-fetch.ts:477, 481-486` — bug
`composeSignal` is rebuilt inside `attemptFetch`, so with `retry: { attempts: 2 }` and `timeoutMs: 30_000` the wall-clock bound is ~90s plus backoff sleeps. Neither the `fetchRhinoCompute` JSDoc nor `ComputeConfig` says so; callers using `timeoutMs` as a deadline block 3× longer than expected.

### 90. Every fetch `TypeError` is retried — duplicated POSTs and buried CORS failures

**Status: OPEN** — `compute-fetch.ts:594-618` — every `TypeError` still retried; `CORS_ERROR` defined but never emitted.

`core/compute-fetch/compute-fetch.ts:575-598` — bug
(a) A connection reset after the body was sent may mean the server executed the POST — retrying duplicates a non-idempotent compute request. (b) Browser CORS failures are `TypeError`s, so a permanently misconfigured server retries through the full backoff schedule and surfaces as `NETWORK_ERROR` — while `ErrorCodes.CORS_ERROR` exists and is never emitted anywhere.

### 91. `readField` walks the prototype chain on the fast path ✅

**Status: OPEN** — `read-field.ts:30,44` — exact path still uses `name in record` (prototype chain).

`core/utils/read-field.ts:30, 44` — bug
The exact-match path uses `name in record` (prototype chain) while the case-insensitive fallback uses `Object.keys` (own enumerable). `readField({}, 'toString')` returns `Object.prototype.toString`, `hasField({}, 'constructor')` returns `true`, yet `readField({}, 'ToString')` returns `undefined` — a payload probed for any `Object.prototype`-named field yields a function instead of `undefined`, violating `hasField`'s "presence carries meaning" contract.

### 92. `isBase64` shape-sniffing corrupts definitions in both directions

**Status: OPEN** — `encoding.ts:34-39` — `isBase64` still shape-sniffs (length%4 + alphabet); both false-positive and double-encode directions remain.

`core/utils/encoding.ts:34-39, 61-62` (used at `grasshopper/solve.ts:249-254`) — bug
Root cause of issue 69, plus the reverse direction: any alphanumeric string with length % 4 == 0 (`"test"`, `"Data2024"`) passes `isBase64` and is sent unencoded (server decodes garbage), while valid-but-newline-wrapped or unpadded base64 — which `decodeBase64ToBinary` deliberately accepts per forgiving-base64 — _fails_ the check and gets **double-encoded**, so the server decodes once and receives base64 text instead of the definition.

### 93. `camelcaseKeys({deep: true})` destroys non-plain objects and silently merges colliding keys

**Status: OPEN** — `camel-case.ts:44-52` — deep mode still reduces any non-array object (Date → {}, Uint8Array → indexed); colliding keys last-wins.

`core/utils/camel-case.ts:36-52` — bug
Any nested non-array object is fed through `Object.keys(...).reduce`: `Date` → `{}`, `Uint8Array` → `{0:…,1:…}`. Two keys collapsing to the same camel key (`inner_tree` + `innerTree`) overwrite last-wins with no warning. (`__proto__` pollution is closed, but by accident — the key mangles to `'_Proto'`.)

### 94. Zip-slip: file paths built from server-controlled fields with no sanitization

**Status: FIXED** — `handle-files.ts:111-120` — `sanitizeArchivePath` drops `..`/`.`/empty/drive-letter segments and normalizes backslashes before building zip paths.

`core/files/handle-files.ts:109-111` — bug
`filePath` concatenates `subFolder` + `fileName` + `fileType` unchecked. A response with `subFolder: "../../.."`, a `fileName` containing `/` or `..`, or an absolute `subFolder: "/etc"` produces zip entries with traversal paths — extraction tools that honor them write outside the target directory.

### 95. File extraction drops files on strict-boolean and casing mismatches ✅

**Status: OPEN** — `handle-files.ts:136,149` — strict `=== true/false` still drops string-typed flags; fields still read with direct camelCase access, not `readField`.

`core/files/handle-files.ts:113, 126, 132-134` — bug
`isBase64Encoded === true` / `=== false` means a missing or string-typed flag (`"true"`) drops the file with the misleading "carries no usable data" warning even though `data` is present. And the module reads all fields via direct camelCase access (`item.fileName`, `item.data`, …) while the rest of the codebase uses `readField` precisely because mcneel-branch servers serialize PascalCase — such a payload yields `fileName === "undefinedundefined"` and every file skipped. (The broken PascalCase `{@link}`s in `files/types.ts:14-20` are residue of that wire schema.)

### 96. `downloadFileData` JSDoc describes a different function

**Status: OPEN** — `handle-files.ts:49-51` — JSDoc still names `downloadDataFromComputeResponse` with the wrong param order/example.

`core/files/handle-files.ts:41-52` — api/docs
The doc names it `downloadDataFromComputeResponse`, lists params in the wrong order, and its example passes `(fileData, null, 'my-export')` — which produces `null.zip` and treats `'my-export'` as `additionalFiles` (→ `fetch(undefined)` per-file errors) if adapted literally.

### 97. URL validation passes query/fragment URLs that break endpoint concatenation

**Status: OPEN** — `validate-server-url.ts:64` — query/fragment URLs still pass and break endpoint concatenation.

`core/server/validate-server-url.ts:41-64` — bug
`http://localhost:6500?x=1` or `http://host#frag` pass all checks; `ComputeServerStats` then builds `${serverUrl}/version`, producing `…?x=1/version` (junk query) or a fragment that swallows the path. All stats calls silently return wrong/`null` results despite the validator being documented as the single source of truth for usable URLs.

### 98. Trailing-whitespace URLs validate but every subsequent fetch throws

**Status: OPEN** — `validate-server-url.ts:26,43,64` — untrimmed `raw` still validated and returned; credentials-in-URL still accepted.

`core/server/validate-server-url.ts:26, 64` — bug
Emptiness is checked on `raw?.trim()` but the untrimmed `raw` is validated (WHATWG `new URL` trims before parsing) and returned. `'http://localhost:6500 '` is accepted at construction, then every `fetch('http://localhost:6500 /version')` throws `Invalid URL` and degrades to `null`/`false` with only a debug log — looks like a dead server, not a config typo. Credentials-in-URL (`http://user:pass@host`) fail the same way: accepted at construction, `new Request` throws at runtime.

### 99. Core README/barrel examples don't match the API

**Status: OPEN** — `core/README.md:45,64-65`, `core/index.ts:15,31` — all four doc/example mismatches unchanged.

`core/README.md:45, 64-65`, `core/index.ts:15, 31` — api/docs
The error-handling example reads `error.status` (field is `statusCode` → logs `Status undefined`); the monitoring example logs `info.activeChildren.length` (it's a `number`) and interpolates `info.version` (an object → `[object Object]`). The barrel's module example calls `fetchRhinoCompute('rhino/health', null, config)` — `null` doesn't satisfy `Record<string, any>`, the transport always POSTs, and the stats docs themselves say the proxy has no health route.

## Low severity

### 100. 404 and 429 both map to `NETWORK_ERROR`

**Status: OPEN** — `compute-fetch.ts:140,145` — 404 and 429 still both map to NETWORK_ERROR.

`core/compute-fetch/compute-fetch.ts:140, 145` — error-handling
No `NOT_FOUND`/`RATE_LIMIT` codes exist, so callers branching on `code` can't distinguish an endpoint typo or rate limit from a transport failure — a "retry on NETWORK_ERROR" policy loops forever on a typo'd path.

### 101. `Retry-After` clamped below the server's stated window

**Status: OPEN** — `compute-fetch.ts:515-517` — `Retry-After` still clamped to `maxDelayMs`.

`core/compute-fetch/compute-fetch.ts:493-499` — bug
Server-requested waits are clamped to `retryPolicy.maxDelayMs` (test pins 5s → 100ms), so the client deliberately retries before the server's window — all but guaranteeing another 429 and burning an attempt.

### 102. Fallback signal composition drops the abort reason

**Status: FIXED** — `compute-fetch.ts:297-303` — abort composition forwards the source signal's `reason` on both modern and legacy paths.

`core/compute-fetch/compute-fetch.ts:283` — bug
`() => ctrl.abort()` discards the source signal's `reason` on legacy runtimes — a caller's custom abort reason becomes a generic `AbortError`, and a fallback-timer timeout can't be identified as `TimeoutError`. Classification survives only because it checks `signal.aborted` rather than the reason.

### 103. Partial-success responses never fire `onServerTiming`

**Status: OPEN** — `compute-fetch.ts:387` — the 500-with-values path still returns before the `onServerTiming` block.

`core/compute-fetch/compute-fetch.ts:351-369 vs 414-423` — error-handling
The 500-with-`values` path returns early before the timing hook — telemetry silently loses exactly the solves that had Grasshopper errors, often the slowest ones.

### 104. Error context stores a rewritten body, unbounded

**Status: OPEN** — `compute-fetch.ts:408-416` — 500 `errorBody` still rewritten to a synthesized message+stack before being stored as `context.responseBody`.

`core/compute-fetch/compute-fetch.ts:125, 133, 389-397` — error-handling
For 500s, `errorBody` is rewritten into a synthesized message+stack before being stored as `context.responseBody`, so the context no longer holds the raw server body it claims to; only the message is truncated to 200 chars, while the full body/stack is retained for the error's lifetime.

### 105. Unreachable post-retry-loop throw

**Status: OPEN** — `compute-fetch.ts:758-763` — the post-retry-loop fallback throw is still dead code.

`core/compute-fetch/compute-fetch.ts:738-744` — error-handling
Every retry branch is gated on `attempt < totalAttempts - 1`, so the final iteration always exits earlier; the `lastError ?? new RhinoComputeError('Unknown error after retries', …)` fallback is dead code suggesting an `UNKNOWN_ERROR` path that can never occur.

### 106. `readField`'s lowered-key cache goes stale on mutation

**Status: OPEN** — `read-field.ts:55-67` — lowered-key cache still built on first read; later-added keys invisible to cased lookups.

`core/utils/read-field.ts:55-67` — bug
The WeakMap caches the lowered-key map on first read; keys added to the object afterwards are visible to the exact-match path but invisible to differently-cased lookups. Documented as assuming immutable wire data, but any in-place payload enrichment silently reads `undefined`.

### 107. Node base64 decode returns a view over the shared Buffer pool

**Status: OPEN** — `encoding.ts:73-74` — Node decode still returns a view over the pooled Buffer slab.

`core/utils/encoding.ts:73-74` — memory
`new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)` aliases Node's pooled slab: a small decode retains the whole 8 KiB slab, and any consumer touching `.buffer` (re-wrapping, structuredClone, postMessage transfer) sees or ships unrelated pooled bytes.

### 108. Browser base64-encode fallback peaks at ~3× input memory

**Status: OPEN** — `encoding.ts:145-151` — browser encode fallback still builds the full latin-1 string then `btoa`.

`core/utils/encoding.ts:141-151` — perf
Builds a full latin-1 string via `s +=` over 32 KiB chunks then `btoa` copies again. Fine normally; matters for multi-hundred-MB geometry exports in browsers/workers. (The chunked `fromCharCode.apply` is correct — no spread overflow.)

### 109. `toCamelCase` mishandles leading separators and acronyms

**Status: OPEN** — `camel-case.ts:12-14` — leading separators and acronyms still mishandled (`URLPath` → `uRLPath`).

`core/utils/camel-case.ts:11-14` — bug
`'_foo'` → `'_foo'`, `'__proto__'` → `'_Proto'` (mangled mid-word capital), and only the first character is lowercased so `'URLPath'` → `'uRLPath'`, `'IDNumber'` → `'iDNumber'`. Publicly exported — consumers matching expected camelCase names miss.

### 110. `warnIfClientSide` fires per call and in jsdom

**Status: PARTIAL (2026-07-11)** — once-per-function dedupe added (`warnings.ts`); the `typeof window !== 'undefined'` check still fires under jsdom.

`core/utils/warnings.ts` — api
No dedupe, and `typeof window !== 'undefined'` is true under jsdom, so unsuppressed test runs get noisy repeated warnings.

### 111. File-handling smaller gaps

**Status: OPEN** — `handle-files.ts:191-203` — intermediate Blob, zip-root-only remote files, and no dedupe on the extract path all remain.

`core/files/handle-files.ts:168-174, 242` — perf/api
`response.blob()` → `blob.arrayBuffer()` allocates an intermediate Blob per remote file (`response.arrayBuffer()` is one step); fetched remote files always land at zip root with no subfolder option; and duplicate paths are only de-duplicated in the zip path — `extractFilesFromComputeResponse` returns multiple `ProcessedFile`s with identical `path`, so consumers keying by path lose files silently.

### 112. URL validator edge cases

**Status: OPEN** — `validate-server-url.ts:32,56` — scheme regex still case-sensitive; public-host block still exact-match only.

`core/server/validate-server-url.ts:32, 56` — bug
The scheme regex lacks the `i` flag (`HTTP://…` rejected with a wrong message despite protocols being case-insensitive), and the `compute.rhino3d.com` block is exact-match only — the trailing-dot FQDN form (`compute.rhino3d.com.`) and the endpoint's raw IP both bypass a guard documented as airtight.

### 113. Server-stats smaller gaps

**Status: OPEN** — `compute-server-stats.ts` — all sub-findings remain: no `intervalMs` validation, mixed-case header merge, garbage-tolerant `parseInt`, dispose-race error log, misattached JSDoc.

`core/server/compute-server-stats.ts:33-38, 75-80, 154-155, 179-181, 575-611` — bug/error-handling
`monitor()` never validates `intervalMs` — `0`/negative produces a hot ~1 ms polling loop. `dispose()` racing an in-flight poll makes nested `ensureNotDisposed()` throw `INVALID_STATE`, logging spurious error-level "Failed to fetch stats" on normal shutdown. The header merge mixes literal `'Content-Type'` keys with lowercase-normalized caller headers, combining into `"application/json, text/plain"` instead of overriding. `parseInt(text.trim(), 10)` accepts garbage-prefixed bodies (`"302 Found…"` → 302 children → `purgeAllChildren` fires 302 purge POSTs). And the constructor's JSDoc is misattached to `DEFAULT_TIMEOUT_MS`.

## Test gaps (core)

- ~~`compose-signal.test.ts` only exercises the forced legacy fallback~~ — closed: the modern-path cleanup test exists and cites issue 86. Still missing: mid-flight/during-backoff abort, HTTP-date `Retry-After`, non-JSON-200-retry pin (issue 87), per-attempt-vs-total timeout (issue 89).
- `encoding.test.ts` covers only string round-trips: no `decodeBase64ToBinary` error paths, no >32768-byte chunk-boundary test (the exact regression the code defends against), no `utf8ByteLength` surrogate tests; `isBase64`'s false-positive (`"test"`) and wrapped-base64 false-negative cases are unpinned (issue 92).
- `read-field.test.ts` has no prototype-key (`toString`/`constructor`) or mutate-after-first-read case (issues 91, 106).
- `handle-files.test.ts`: ~~traversal characters~~ — closed (sanitizeArchivePath tests exist, issue 94). Still missing: decode-failure skip branch, duplicate-path rename, browser guard. `camel-case.ts` and `warnings.ts` have no tests at all.
- `validate-server-url.test.ts` covers none of: query/fragment URLs, whitespace, credentials, uppercase scheme, trailing-dot/IP bypass, IPv6 literals (issues 97-98, 112). `compute-server-stats.test.ts` has zero `monitor()` or dispose-race coverage (issue 113).

---

# Caching Re-review — Known Issues

Second pass over the solve-caching surface (2026-07-11), companion to `CACHING.md` (whose "Re-review addendum" holds the design-level findings — durable-cache keying, Redis notes, app-side issues in the `selva` repo). This section tracks only the **package-level bugs** that pass found. Numbering continues from the core audit. All issues below were verified against the code by hand.

**Overlap with the 2026-07-06 Grasshopper audit** — the re-review independently re-confirmed several already-tracked issues; they are not renumbered here:

- Sampled `Uint8Array` hashing inside the dataTree → cache-key collision = **issue 56**. New consequence recorded in `CACHING.md` R1: it also defeats the planned durable-cache "store canonical inputs, compare on hit" defense, since the canonical string is itself lossy.
- Aborting a queued solve silently ignored (dead request still burns a full compute) = **issue 46**. At 1000 users behind the app's `queue`-mode scheduler this is a load problem, not just a contract violation.
- Definition hashed twice per solve on the event loop = **issue 57**.
- `algo` retained in responses/cache = **issue 58**. Upgraded by the re-review: `runSolve` strips `pointer` but not `algo`, and a grep of both repos found **no consumer of `response.algo`** — so the full base64 definition is also shipped to every browser on every solve for nothing. Strip it at the source (or in the app pipeline) — see `CACHING.md` addendum, "M3 is understated".
- `[undefined]` ≡ `[]` stringify collision = **issue 53**; 32-bit final hash birthday risk = **issue 68** (now also `CACHING.md` H2, where it blocks durable keying).

## High severity

### 114. Errored-solve caching is intended — but the log and flag semantics contradict it ✅

**Status: FIXED (2026-07-11)** — `CacheOptions.cacheErroredSolves` added (default `true`, matching the decision); both cache-errored and skip-errored behaviors test-pinned. The misleading app-side debug log lives in the `selva` repo and remains to fix there.

`scheduler/solve-scheduler.ts:436` — api/docs (downgraded from bug — decision 2026-07-11)
`writeCache` caches every resolved response, including those with GH `errors`. **Decision (2026-07-11): that is correct behavior.** In Grasshopper an errored solve is still a valid, deterministic result — definitions raise GH errors by design (guarded components, validation branches; `types.ts:205-207` documents exactly this), so replaying one from cache is right. What remains wrong: (a) the consuming app's debug log ("an errored solve is NEVER cached") describes only Rhino's server-side `cachesolve` and is misleading about this cache; (b) asymmetry — Rhino-side errored-solve caching is opt-in (`cacheerroredsolves`) while the Selva cache always includes them, with no `CacheOptions` to express either choice. Fix: correct the app-side log wording; optionally add `CacheOptions.cacheErroredSolves` (default **true**, matching the decision) for consumers that want Rhino-flag parity. The durable cache (CACHING.md H1) should likewise store errored solves.

### 115. No in-flight coalescing — identical concurrent solves all execute ✅

**Status: CLOSED BY DESIGN (2026-07-11)** — single-flight coalescing belongs app-side next to the L2 lookup (`Map<inputKey, Promise>`), per CACHING.md revalidation amendment 4. No package change.

`scheduler/solve-scheduler.ts:328, 367-402` — perf
The cache is consulted only at `solve()` entry; there is no `key → in-flight promise` map. N identical requests arriving while the first is still solving all enqueue and all execute — in `queue` mode they serialize and re-solve one after another, each _missing_ the cache that the first will only populate on completion. Rhino's `cachesolve` softens the repeats server-side (when enabled), but each still pays a full round trip, and any durable L2 built on this scheduler inherits the cold-key stampede. Fix: coalesce by key — subsequent `solve()` calls for a key with an in-flight execution share its promise (careful with per-call abort semantics: a shared solve should only abort when all subscribers have aborted).

## Low severity

### 116. Cache hits return a shared mutable reference ✅

**Status: FIXED (2026-07-11)** — immutability contract documented on `SolveScheduler.solve()` (cached responses are shared objects; mutating one poisons later hits).

`scheduler/solve-scheduler.ts:661` — bug (latent)
`readCache` returns the stored `response` object itself, and `_lastResult` shares it. Any consumer that mutates a response (processors, viewers) poisons every subsequent hit for that key. The main app path serializes the response immediately (safe), but the scheduler is public API with no documented immutability contract. Fix: document that responses from the scheduler must be treated as immutable (a defensive `structuredClone` on read is too expensive for multi-MB responses to be the default).

## Test gaps (caching re-review)

> **Update 2026-07-11:** gap 114 is closed — both errored-solve-cached
> (default) and skip-when-`cacheErroredSolves: false` are pinned. Gap 115 is
> moot package-side (single-flight lives app-side per CACHING.md amendment 4;
> the test belongs next to the app's L2 lookup). Gap 116 remains: the
> immutability contract is documented, not enforced, so a mutation test would
> only pin the sharing behavior.

- ~~No test pinning that a response with non-empty `errors` IS cached~~ — pinned 2026-07-11 (issue 114).
- Two-identical-in-flight coalescing test → app-side, with the L2 single-flight map (issue 115).
- No test mutating a cache-hit response and asserting the next hit is unaffected (issue 116 — documented contract, not enforced).
