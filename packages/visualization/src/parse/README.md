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
  └─ webdisplay/webdisplay-parser.ts     pick display data off the response, scale, ground, bound
       └─ webdisplay/batch-parser.ts     entry points + off-thread worker path
            ├─ webdisplay/binary-parser.ts        SLVA decode  ─┬─ webdisplay/binary/header.ts    magic/version/flags/types
            │                                                   ├─ webdisplay/binary/geometry.ts  buffer reads, delta+zigzag, inflate
            │                                                   └─ webdisplay/binary/textures.ts  trailing UV + vertex-color chunks
            ├─ webdisplay/batch/metadata.ts       validate windows, dequantize
            ├─ webdisplay/batch/materials.ts      SerializableMaterial → MeshPhysicalMaterial
            ├─ webdisplay/batch/merge.ts          merged + individual mesh construction
            ├─ webdisplay/mesh-assembly.ts        pure geometry assembly, shared by the main thread and the worker
            └─ webdisplay/batch/assembly-worker.ts  worker plumbing (blob URL, request/response)
```

`apply-texture.ts` loads a material's color map and assigns it once decoded. Nothing here caches
across solves: every solve decodes its own geometry and textures, and the scene owns what it built.

## Display item pipeline

```
display-items/display-items-parser.ts      dispatch per item kind
  ├─ display-items/items/curves.ts         rhino3dm decode → adaptive tessellation → fat Line2
  ├─ display-items/items/points.ts         raw positions → one THREE.Points
  └─ display-items/items/appearance.ts     shared color/opacity → material params
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
- **The scene owns every geometry and texture it holds.** Nothing outlives the scene that built it,
  so `disposeObjectTree` frees them unconditionally. Only the module-singleton materials are spared
  — see [the ownership rule](../shared/gpu-ownership.ts).
