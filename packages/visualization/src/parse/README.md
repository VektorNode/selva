# `parse/` — how a payload becomes meshes

Turns a backend response into renderable Three.js objects. Depends only on `shared/`; never imports
from `render/` or `scene/`.

## Two payload kinds

| Kind              | Entry point                         | Wire format                                           |
| ----------------- | ----------------------------------- | ----------------------------------------------------- |
| **Mesh batches**  | `getThreeMeshesFromComputeResponse` | binary `SLVA` blob (base64 or raw), `SLVZ` = deflated |
| **Display items** | `parseDisplayItems`                 | Rhino-native JSON, decoded via `rhino3dm`             |

## Mesh batch pipeline

```
response envelope
  └─ webdisplay-parser.ts     pick display data off the response, scale, ground, bound
       └─ batch-parser.ts     entry points + off-thread worker path
            ├─ binary-parser.ts        SLVA decode  ─┬─ binary/header.ts    magic/version/flags/types
            │                                        ├─ binary/geometry.ts  buffer reads, delta+zigzag, inflate
            │                                        └─ binary/textures.ts  trailing UV + vertex-color chunks
            ├─ batch/metadata.ts       validate windows, cache key, dequantize
            ├─ batch/materials.ts      SerializableMaterial → MeshPhysicalMaterial
            ├─ batch/merge.ts          merged + individual mesh construction
            └─ batch/assembly-worker.ts  worker plumbing (blob URL, request/response)
```

`geometry-cache.ts` and `texture-cache.ts` are cross-solve caches: identical geometry content and
hash-keyed texture URLs are decoded and uploaded to the GPU once per session.

## Display item pipeline

```
display-items-parser.ts      dispatch per item kind
  ├─ items/curves.ts         rhino3dm decode → adaptive tessellation → fat Line2
  ├─ items/points.ts         raw positions → one THREE.Points
  └─ items/appearance.ts     shared color/opacity → material params
```

Curves need a caller-supplied `rhino3dm` instance (the WASM is heavy and the host owns it). Without
one, curves are skipped with a warning and points still render.

## Extension points

- **Custom materials** — pass `material: MaterialAppearanceOptions` to the batch parser
  (`envMapIntensity`, `cullBackfaces`). Baked at parse time, not toggleable in place; runtime
  restyling of a built scene is the viewer's `setLook`.
- **Custom scale** — `SCALE_FACTORS` maps Rhino unit systems to the meter-normalized scene.
- **New display item kind** — add a variant to the `DisplayItem` union in `display-items/types.ts`,
  then a builder in `items/` and a case in the parser's dispatch.

## Invariants worth knowing

- **One coordinate frame end to end.** The Three scene _is_ Rhino's Z-up frame, so vertices pass
  through unrotated. Don't reintroduce a rotation here.
- **Malformed metadata throws, absent data doesn't.** An unparseable envelope returns `[]` (genuinely
  no data); a corrupt/truncated blob or out-of-range group window throws a `VALIDATION_ERROR` rather
  than silently rendering an empty or corrupted scene.
- **The caches own their buffers, and `shared/gpu-ownership.ts` is where that is stated.** Cached
  geometries and textures carry `CACHED_GEOMETRY_USERDATA_FLAG` / `CACHED_TEXTURE_USERDATA_FLAG`;
  the caches dispose them on eviction and nobody else ever does. Don't read those flags directly —
  call `canDisposeGeometry` / `canDisposeTexture`, or just use `disposeObjectTree`, which already
  does. See [the ownership rule](../shared/gpu-ownership.ts) for why this is centralized.
- **Both cross-solve caches release themselves on viewer teardown.** They outlive a scene by
  design, but not the GL context. Each calls `registerCacheRelease(...)` at module init, and
  `initThree` drains the registry in `dispose()` — refcounted, so only the last live viewer
  frees. No host wiring. `releaseParseCaches` stays exported as an escape hatch, not a required
  step.
