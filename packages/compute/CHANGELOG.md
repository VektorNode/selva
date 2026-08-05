# @selvajs/compute

## 4.0.0-beta.4

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.

## 4.0.0-beta.3

### Major Changes

- 5292563: **Public vocabulary stops promising Rhino.** Coordinated pre-1.0 major — no deprecation shims, no
  aliases left behind. Every reference across the workspace was updated in the same commit.

  ```diff
  -import { fetchRhinoCompute, RhinoComputeError } from '@selvajs/compute/core';
  +import { fetchCompute, ComputeError } from '@selvajs/compute/core';
  ```

  ```diff
  -import type { GrasshopperParamType, GrasshopperInputStructure } from '@selvajs/schemas';
  +import type { ParamType, InputStructure } from '@selvajs/schemas';
  ```

  Both renamed schema types were already backend-agnostic in value (`ParamType` is
  `number|integer|boolean|text|valueList|dynamicValueList|file|color|generic`; `InputStructure` is
  just arity — `item|list|tree`). Only the names were Rhino-flavored. The rename does not touch wire
  data: `paramType` still serializes as its lowercase string value, never the type name. Regenerated
  via `pnpm generate` — the C# plugin types regenerate too (`Plugin/Selva.Schema/Models/UISchema.Generated.cs`),
  so this needs a plugin rebuild.

  **`@selvajs/compute`'s root barrel is gone** — subpaths only, matching `@selvajs/solve` (no root
  export) and `@selvajs/visualization` (root deliberately empty):

  ```diff
  -import { GrasshopperClient } from '@selvajs/compute';
  +import { GrasshopperClient } from '@selvajs/compute/grasshopper';
  ```

  **Env var renamed:** `MAX_GH_FILE_SIZE_BYTES` → `MAX_DEFINITION_FILE_SIZE_BYTES`. No dual-read —
  operators update `.env` on upgrade. Everything else in `.env.example` was already neutral
  (`COMPUTE_*`).

  Also reworded the Rhino-flavored doc strings in `ui-schema.json` that described backend-agnostic
  fields (e.g. a parameter identifier documented as "Grasshopper instance GUID" when the field
  itself is just a bare string, backend-specific by convention rather than by type).

## 4.0.0-beta.2

### Major Changes

- 9f60b66: **`@selvajs/compute/core` is now backend-agnostic** — it names no Rhino concept, so a second
  backend inherits its retry, backoff, abort-composition, `Retry-After` and status→code machinery
  for free.

  Two exports changed subpath:

  ```diff
  -import { ComputeServerStats } from '@selvajs/compute/core';
  +import { ComputeServerStats } from '@selvajs/compute/grasshopper';
  ```

  `ComputeServerStats` is pure rhino.compute control plane (`/activechildren`,
  `/plugins/gh/installed`, `/idlespan`), so `/core` was the wrong home. The inverse move:
  `DefinitionRef`, `SolveDefinition` and `isDefinitionRef` are bytes-or-a-lazy-byte-ref with nothing
  Grasshopper in them, and they sit in the solve port's own signature — they now export from
  `/core` as well as `/grasshopper`, so a second backend's author isn't forced to import them from
  the Grasshopper subpath. `RhinoModelUnit` moved from `/core` to `/grasshopper`.

  The root `@selvajs/compute` entrypoint re-exports both subpaths, so importers from the root are
  unaffected.

  Three new seams carry what used to be hardcoded in core:

  - **`ComputeConfig.apiKeyHeader`** — the auth header's name, defaulting to `RhinoComputeKey`. The
    key still merges over `config.headers`, so a caller can't clobber whichever header carries it.
  - **`ComputeConfig.serverErrorCodes`** — a backend's machine wire codes mapped to our
    `ErrorCodes`, outranking the status-based mapping (type `ServerErrorCodeMap`). Core no longer
    hardcodes `definition_not_cached`; the Grasshopper client supplies it on every request, so
    `ErrorCodes.DEFINITION_NOT_CACHED` still surfaces exactly as before.
  - **`validateServerUrl(url, { blockedHosts })`** — the shared public endpoint to reject, still
    defaulting to `compute.rhino3d.com`. Now exported from `/core` alongside `DEFAULT_BLOCKED_HOST`
    and the options type `ValidateServerUrlOptions`.

  Nothing above changes behaviour for an existing caller: every new field is optional and defaults to
  what core did before. Only the two subpath moves require an edit.

- 9f60b66: **Every deprecated symbol in `@selvajs/compute` is gone.** Nothing is left as a stub — this is a
  coordinated pre-1.0 major, so there is nothing to ease.

  **`camelcaseKeys` and `toCamelCase` are removed from `@selvajs/compute/core`.** They were
  deprecated in favour of `readField`, which now takes their export slot alongside `hasField`:

  ```diff
  -import { camelcaseKeys } from '@selvajs/compute/core';
  -const { schemas } = camelcaseKeys(entry) as { schemas?: UISchema[] };
  +import { readField } from '@selvajs/compute/core';
  +const schemas = readField<UISchema[]>(entry, 'schemas');
  ```

  Blanket key-rewriting was the wrong tool for wire payloads: it corrupted user-authored keys
  (value-list labels, `Display3d` → `display3d`) while the actual problem — server branches
  disagreeing on casing for a handful of known fields — is what `readField` solves per-field.

  **If you were unwrapping compute's schema endpoint with it, you had the bug described below.**
  Use the new `readSchemaResults` instead of hand-rolling the unwrap:

  ```diff
  -const results = camelcaseKeys(Array.isArray(raw) ? raw : [raw]) as { schemas?: UISchema[] }[];
  +import { readSchemaResults } from '@selvajs/compute/grasshopper';
  +const results = readSchemaResults<UISchema>(raw);
  ```

  **`ComputeConfig.suppressClientSideWarning` is removed.** Use `suppressBrowserWarning`, which it
  has been an alias for.

  **New: `readSchemaResults` on `@selvajs/compute/grasshopper`** — the one correct way to unwrap
  `/grasshopper/schema`'s `[{ FileName, Schemas }]` body.

  It exists because everyone who hand-rolled that unwrap got it wrong the same way. The wrapper's
  casing varies by server branch (mcneel `FileName`/`Schemas`, our fork `fileName`/`schemas`), so a
  fixed-key read yields `undefined` against half of them — and the endpoint answers 200 either way,
  so the failure surfaces as "this definition has no schemas". Reaching for `camelcaseKeys` looked
  like the fix but passed the response **array** to a shallow key-rewriter, which returns arrays
  untouched: same `undefined`, now with a comment claiming it was handled.

  That was live in this repo: every upload through `/api/v1/compute/schema` 422'd with "No schemas
  found in definition". Fixed here, and `@selvajs/server/definitions` re-exports the helper typed to
  `UISchema` so the app layer keeps its concrete type.

  `readSchemaResults<TSchema>(raw)` returns `SchemaEndpointResult<TSchema>[]` — `{ schemas?, error? }`
  per file. `TSchema` is pass-through; the helper reads only the two wrapper keys and never looks
  inside a schema, so `@selvajs/compute` still doesn't depend on `@selvajs/schemas`. Pass your own
  schema type, or omit it for `unknown`.

  Also removed the unused legacy test builders (`createMockGrasshopperInput` and friends,
  `createMockThreeGeometry`) from the package's test helpers.

## 4.0.0-beta.1

### Major Changes

- e4f83b2: Bound the scheduler's solve cache by bytes only. `CacheOptions.maxEntries` is
  removed and `maxBytes` is now required, so `cache: true` is no longer valid —
  enabling a cache always states a budget. A budget of `0` disables caching, the
  same as `cache: false`.

  Two bounds meant every caller had to reason about which one would bind first,
  and omitting `maxEntries` silently fell back to a default of 50 that could cap
  the cache far below its byte budget. Responses range from KB to hundreds of MB,
  so memory is the constraint that actually matters.

  Migration: `cache: true` → `cache: { maxBytes: <budget> }`; drop `maxEntries`.

## 4.0.0-beta.0

### Major Changes

- 53da168: Prune the public API and unwrap the package's internal layout. Every removed symbol has a
  same-package replacement — the changes below are import rewrites, not behaviour changes.

  **`./grasshopper` no longer re-exports four `./core` symbols.** `ComputeConfig`, `RetryPolicy`,
  `RhinoComputeError`, and `RhinoModelUnit` reached the subpath only because the old
  `src/grasshopper.ts` barrel ended with a re-export from `./core`. Import them from the package root
  or from `@selvajs/compute/core` instead:

  ```diff
  - import { RhinoComputeError, type ComputeConfig } from '@selvajs/compute/grasshopper';
  + import { RhinoComputeError, type ComputeConfig } from '@selvajs/compute';
  ```

  **`getValues` and `getValue` are no longer exported as free functions.** Use the
  `GrasshopperResponseProcessor` methods, which are exact wrappers — identical arguments minus the
  leading `response`:

  ```diff
  - import { getValues, getValue } from '@selvajs/compute/grasshopper';
  - const { values } = getValues(response);
  - const schema = getValue(response, { byName: 'Schema' });
  + import { GrasshopperResponseProcessor } from '@selvajs/compute';
  + const processor = new GrasshopperResponseProcessor(response);
  + const { values } = processor.getValues();
  + const schema = processor.getValue({ byName: 'Schema' });
  ```

  **`processInputs` (plural) is removed.** It was a one-line `.map()` over `processInput`, which stays
  public. Note the shape change — it took and returned an array:

  ```diff
  - import { processInputs } from '@selvajs/compute/grasshopper';
  - const inputs = processInputs(rawInputs);
  + import { processInput } from '@selvajs/compute';
  + const inputs = rawInputs.map(processInput);
  ```

  `processInputsWithErrors`, which reported validation failures instead of logging them, is now
  internal. It was never exported from a published entrypoint before this release.

  **The README no longer documents a Three.js visualization layer.** That layer moved to
  `@selvajs/visualization` in an earlier release, but the install line
  (`npm install @selvajs/compute three`), the `three >= 0.179.0` requirement, and a troubleshooting
  entry for a module that no longer exists all survived in the docs. `three` was never a dependency of
  this package and installing it for `@selvajs/compute` alone was always unnecessary.

  **Internal layout (no API impact).** `src/features/grasshopper/` collapsed to `src/grasshopper/`,
  the duplicate outer barrel is gone, and four oversized modules were split along existing seams —
  `compute-fetch.ts` (858 lines) into request/response/retry/signal/server-timing, `types.ts` into
  `types/{inputs,schema,outputs}`, `input-type-parsers.ts` into transformers + numeric-rounding, and
  the scheduler's public declarations into `scheduler/types.ts`. Deep imports into `src/` were never
  supported; the three published entrypoints (`.`, `./grasshopper`, `./core`) are unchanged.

  The `/grasshopper` subpath goes from 55 exported symbols to 50, verified by diffing the emitted
  `dist/grasshopper.d.ts` before and after.

- 7751bd0: Extract parsing and rendering into a new `@selvajs/visualization` package.

  `@selvajs/compute` was doing two unrelated jobs: talking to Rhino.Compute, and turning the response
  into Three.js objects. The second job is now its own package with documented layer boundaries
  (`session → scene → render → parse → shared`, depending downward only), so a consumer can build
  their own viewer over it.

  This lands all five layers — `shared/`, `parse/`, `render/`, `scene/` and `session/`.
  **`@selvajs/compute` no longer depends on `three` in any form** (peer dep and dev deps both gone);
  it is now pure solve/data, and `@selvajs/ui` keeps only the Svelte shells plus the design system.

  **Fixed — hiding an object in the viewer now survives a solve.**

  Hiding a mesh in the scene manager and then changing an input brought it straight back: a solve
  discards all scene content and rebuilds it, and hidden state was keyed on the per-instance
  `THREE.Object3D.uuid`, which does not survive that. It is now keyed on the object's Grasshopper
  identity (`sourceComponentId` + `originalIndex`, or a display item's `id`, falling back to
  name+layer for content from older plugin versions), so it survives any number of solves. Hiding is
  also remembered when a definition edit stops producing that geometry — if it comes back, it comes
  back hidden.

  **New in `@selvajs/visualization` — `@selvajs/visualization/scene`:**

  The viewer's object list is no longer trapped in a Svelte component. `createSceneOutliner` answers
  the questions any presentation of a scene has to answer — which children are content rather than
  cameras/lights/grid, how they group by layer, what is hidden, what is selected — with no DOM:

  ```ts
  import { createSceneOutliner } from '@selvajs/visualization/scene';

  const outliner = createSceneOutliner(scene);
  outliner.searchQuery = 'wall';
  outliner.layerGroups(); // Map<layerName, Object3D[]>, search-filtered
  outliner.toggleObject(mesh); // follows a multi-selection
  outliner.select(uuid, { shiftKey, toggleKey });
  ```

  It **reads** the scene and toggles `.visible`; `updateScene` remains the sole owner of scene
  contents. Its mutable state is injectable, so a Svelte host passes `SvelteSet`s and gets reactivity
  without any subscribe/emit machinery:

  ```ts
  createSceneOutliner(scene, { sets: { hidden, selected, collapsed } });
  ```

  Hosts driving their own viewer must call `outliner.applyTo()` after each solve to re-apply hidden
  state to the rebuilt content — `<Viewer>` does this for you.

  `getSceneObjects`, `groupByLayer`, `filterLayerGroups`, `isSceneContent` and the visibility/selection
  state machines are exported individually for consumers that want the parts, not the composition.

  **New in `@selvajs/ui` — `useSolveSession`:**

  The Solve Session moved to `@selvajs/visualization/session` and is now framework-free: its state
  reads through plain getters plus a `subscribe()` seam, so it can drive a headless solve with no
  Svelte in the picture. In a component, use the new binding instead of the raw factory — it
  subscribes once and republishes as rune state, which is what keeps `session.values`/`meshes` live
  in markup:

  ```ts
  import { useSolveSession } from '@selvajs/ui';

  const driver = createRequestResponseDriver(onSolve, () => session, {
  	// `isSolving` lives on the driver, which the session can't observe — republish it.
  	onChange: () => session.notify()
  });
  const session = useSolveSession({ schema, scopeKey, driver });
  ```

  Calling `createSolveSession` directly in a component still compiles and returns correct values, but
  nothing re-renders. `@selvajs/ui` re-exports it (plus `SolveDriver`, `SolveReporter`, `SolveFn`,
  `SolveResult` and the `external/storage` helpers) from its new home, so existing imports from
  `@selvajs/ui` and `@selvajs/ui/external` keep working unchanged.

  **Breaking — `@selvajs/compute`:**

  - **`@selvajs/compute/visualization` is removed entirely.** Everything it exported now lives in
    `@selvajs/visualization`:

    | Was                                                                                                                                                                                                   | Now                                                                         |
    | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
    | `initThree`, `updateScene`, camera, grid, gizmo, edges, labels, measure, render pipeline, materials, up-axis helpers                                                                                  | `@selvajs/visualization/render`                                             |
    | `getThreeMeshesFromComputeResponse`, `parseMeshBatch{,Object,Blob}`, `parseBinaryMeshBatch`, `parseDisplayItems`, texture cache, wire-format constants (`BINARY_MESH_MAGIC`, `FLAG_*`, `UV_FORMAT_*`) | `@selvajs/visualization/parse`                                              |
    | `LOOKS`, `Look`, `parseColor`, `applyOffset`, `computeCombinedBoundingBox`                                                                                                                            | `@selvajs/visualization/shared` (also re-exported from `/render`)           |
    | `createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`, `SolveFn`, `SolveResult`, `createComputeThrottle`, `createSolveMemo`, the `external/storage` helpers             | `@selvajs/visualization/session` (all still re-exported from `@selvajs/ui`) |

  - `GrasshopperResponseProcessor.extractMeshesFromResponse()` is **removed**. It coupled the solve
    client to a renderer, which the new layering forbids. Its `response` and `debug` fields are now
    public, so call the parser directly:

    ```ts
    import { getThreeMeshesFromComputeResponse } from '@selvajs/visualization/parse';

    const meshes = await getThreeMeshesFromComputeResponse(processor.response, { rhino });
    ```

  - `initThree` no longer reaches into the texture cache itself — `render/` must not import `parse/`.
    To keep color maps sharp at grazing angles, wire the new `onMaxAnisotropy` option:

    ```ts
    import { setTextureAnisotropy } from '@selvajs/visualization/parse';

    initThree(canvas, { onMaxAnisotropy: setTextureAnisotropy });
    ```

    Omitted, textures keep three's default anisotropy of 1 — sharpness regresses, nothing breaks.

  - `decodeBase64ToBinary` is now exported from the package root (the binary mesh parser needs it, and
    its forgiving-base64 normalization plus Node pool-slab copy are too subtle to duplicate).

  **Also in this change:** the five largest files were split along the seams they already had, with no
  behavior change. `three-initializer` 1743→407 (`scene-setup/*`, 14 files — the `ThreeViewer` handle,
  the postprocessing pipeline and the runtime appearance setters each became their own module),
  `edges` 874→233 (`edges/{options,extraction,cache,overlay}.ts`), `batch-parser` 1007→466
  (`batch/{metadata,materials,merge,assembly-worker}.ts`), `binary-parser` 713→329
  (`binary/{header,geometry,textures}.ts`), `display-items-parser` 440→77
  (`items/{curves,points,appearance}.ts`), the session's driver split out into
  `session/drivers/{driver,request-response}.ts`, and `SceneManager.svelte` 319→234 (its logic now in
  `scene/`). 425 tests pass.

## 3.1.1

### Patch Changes

- 0d503c6: Update `rhino3dm` from 8.17.0 to 8.32.0.

  No API surface used by Selva changed. The upgrade was verified by loading both
  WASM modules side by side and diffing their runtime surfaces: `CommonObject.decode`,
  `Point`, `Line`, `Curve.isPolyline`/`tryGetPolyline`, `getBoundingBox`, and the
  emscripten `delete()`/`isDeleted()` lifecycle are all unchanged. 8.32.0 is a strict
  superset — it adds `BrepLoop`/`BrepTrim` topology classes, SubD iterators,
  `Material.setTexture`, and `Mesh.toThreejsBuffers`, none of which the current
  pipeline uses. The 16 dropped top-level exports are emscripten internals
  (`HEAPU8`, `_malloc`, `ready`) that nothing references.

  Both documented runtime quirks the display-item parser works around still hold in
  8.32.0, so the workarounds stay: `tryGetPolyline` returns the `Polyline` directly
  rather than the `[ok, Polyline]` tuple its type declares, and `getBoundingBox`
  takes no arguments at runtime despite its `.d.ts` signature.

  The package still ships no `exports` field, so plugin-ui's
  `rhino3dm/rhino3dm.wasm?url` Vite asset import keeps resolving; the emitted bundle
  was confirmed byte-identical to the 8.32.0 WASM. One source-breaking type change
  exists but is unused here — `File3dm.add*` methods (`addMesh`, `addCurve`, …) now
  require a second `attributes` argument.

## 3.1.0

### Minor Changes

- aa2abf6: Beta release covering the pre-open-source hardening pass and follow-on work across the app stack:

  - **Audit/erasure**: user-deletion erasure now scrubs `audit_events`, `invites`, and redacts embedded emails from surviving `invite.created` payloads; `solve_metrics` is anonymized rather than cascaded.
  - **Logging**: structured logging via Pino with request-ID correlation, replacing ad hoc console logging across the server.
  - **Caching**: durable L2 solve-result cache with a memory backend, client-side result memoization (LRU), warm-client caching per server, backpressure controls, and definition byte caching; response wire-size tracking feeds caching efficiency metrics.
  - **Definitions**: extracted definitions server slice (`@selvajs/server/definitions`) with schema-version-aware extraction/caching and hardened schema-version parsing/error handling.
  - **Tests**: new e2e core-loop tests against a fake compute server, and per-file test isolation to fix flaky mocks.

- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

- 5b37862: Fix the viewer's view presets, which showed the wrong side of the model, and route every
  orientation default through a single scene-up basis.

  `buildViewDirections` derived its ground-plane axes with the opposite handedness to Rhino's, so in
  the default Z-up scene **Front framed the back of the model and Left framed the right**. The
  nav-cube inherited the same error. Presets now follow Rhino's convention: Front looks along +Y
  (camera at -Y) and Right looks along -X (camera at +X).

  **Top and Bottom were also wrong, for a separate reason.** At a pole the view direction is parallel
  to `camera.up`, so `up` cannot define the view's roll — the ~0.5° off-pole nudge that avoids the
  OrbitControls singularity decides it instead, and it was leaning toward `+forward`. Both pole views
  came out rolled, with geometry and text mirrored on screen.

  Both poles now lean toward `-forward`, reproducing Rhino's convention exactly: Top is `+X` right /
  `+Y` up and unmirrored; Bottom is `+X` right / `+Y` down. Bottom being mirrored is correct — it is
  the far side of the model, and Rhino mirrors it too — but it must mirror about the horizontal axis.
  Mirroring about the vertical instead (`+X` left / `+Y` up) is the same image rolled 180°, which
  still reads as wrong on screen while satisfying a naive "is it mirrored?" check.

  The existing test only asserted that "front" was orthogonal to the up axis, which a 180° swap
  satisfies — the presets are now pinned to the actual side the camera sits on, and the pole views are
  additionally pinned by their on-screen axes and handedness rather than direction alone.

  A new `up-axis` module (`buildUpBasis`, `isoOffset`, `sunOffset`, `upToAxis`, exported from
  `@selvajs/compute/visualization`) is the single source of truth for the scene basis. Several
  defaults previously hardcoded a Z-up vector while _bypassing_ the configured `sceneUp`, so a scene
  configured Y-up got a below-horizon camera and a near-horizontal sun even though the presets, floor,
  and grid correctly followed `sceneUp`. Now derived from it:

  - the default iso camera position (`applyDefaults`)
  - the default sun position
  - `updateScene`'s first-frame framing — previously a hardcoded `(0.8, 1.0, 1.2)` offset that also
    disagreed with the configured iso default, so the first solve jumped to a different angle than the
    one the viewer opened at
  - the near-plane fitter's grid ground-normal fallback

  Z-up scenes — every current deployment — keep their existing camera distance and sun placement;
  these are behaviour-preserving there and only change non-default `sceneUp` scenes.

  ## Breaking: `allowAutoPosition` now defaults to `false`

  `getThreeMeshesFromComputeResponse` used to drop geometry onto the ground plane by default, but the
  WebSocket preview path never did — so the same definition rendered at a different height depending
  on transport. Both now keep Rhino's coordinates: the viewer agrees with the Grasshopper definition,
  and bounds/measured/picked positions correspond to the real model.

  **Migration:** pass `allowAutoPosition: true` to restore the old behaviour.

  `MeshExtractionOptions` also gains `groundAxis` (default `'z'`) so that grounding, when enabled,
  drops content along the scene's up axis instead of always subtracting `min.z`.

  ## HDR environment orientation

  `scene.environmentRotation` and `scene.backgroundRotation` are now set from `sceneUp`. Three's
  equirectangular mapping assumes a Y-up horizon, so in the Z-up scene the environment was lying on
  its side — the horizon ran vertically and image-based lighting arrived from +Y rather than from
  overhead. Invisible on a neutral studio HDR, obvious on any HDR with a sky/ground split. Exposed as
  `environmentRotationFor`.

  Also corrects stale docs that contradicted the code: the grid `plane` default (documented `'y'`,
  actually `'z'`), the camera controller's `up` ("Defaults to Y-up" — the caller always passes Z), a
  `batch-parser` comment describing a Z-up→Y-up rotation that no longer happens, and the previously
  undocumented `sceneUp` default.

### Patch Changes

- 5077fe9: Adding advanced caching
- b0d8bd8: Move `@selvajs/compute` into the Selva monorepo (`packages/compute`). No API or behavior changes — the package continues to publish to npm under the same name and version line. Development, issues, and the SLVA mesh wire-format now live alongside the plugin and app that consume it.
- 2f787d9: Fix edge overlays bleeding through geometry in front of them, by biasing the lines instead of
  receding the surfaces.

  Edges were kept off their own coplanar surface by pushing every mesh's **surface** backwards with a
  slope-scaled `polygonOffset` (factor 1, units 2), leaving the lines at true depth. The slope term
  scales with the polygon's dZ/dpixel, which is small head-on but very large on a surface viewed near
  edge-on — one pixel then spans a lot of depth. On a grazing face, surfaces receded by far more than
  the millimetre-scale gaps between stacked parts, so geometry _behind_ a wall won the depth test
  against that wall's own receded surface and its edges drew straight through it.

  The bias now lives on the edge material instead, units-only with no slope term, so it is a fixed
  number of depth quantization steps regardless of viewing angle: enough to lift an edge off the
  surface it was extracted from, never enough to reach across to a neighbouring part.

  This also fixes two collateral bugs in the old approach. Surfaces are no longer mutated at all, so
  look presets keep the `polygonOffset` their materials ship with (`EMISSIVE`/`METAL`/`CONCRETE` set
  factor 1 / units 1, which `addEdges` had been overwriting); and `removeEdges` no longer resets those
  to 0/0, which had permanently stripped the preset's offset on an edges on/off toggle.

  Depends on the dynamic near-plane fit to stay correct: a constant depth bias is only safe while
  depth ULPs stay small, and the fitter is what holds them at micron scale when zoomed out. Which
  surfaced a bug there — the fitter clamps `camera.near` by the camera's distance to any ground plane
  carrying a visible aid, but its list of planes was captured once at init from whether the aid
  _object existed_, not whether it is drawn. The viewer builds its grid up-front so the tools menu can
  toggle it, yet starts it hidden, so a grid nobody could see clamped `near` to half the camera's
  height above the ground — driving `near` toward zero at grazing views and the depth ULP up with it.
  `groundNormals` is now a per-frame callback returning only visible aids.

  Separately, the distance fade now measures **edge density** rather than the overlay's bounding
  sphere. Edges draw at a constant pixel width, so once neighbouring lines sit under a pixel or two
  apart they merge into a dark smear — worst on layered sheet goods, whose millimetre-pitch laminations
  are sub-pixel at any zoom that fits a metre-scale part on screen. The old rule scored the bounding
  sphere and faded below 80 px, which never fired for exactly those parts, because a large mesh whose
  _internal_ detail has collapsed still covers much of the viewport. Overlays now fade on the
  15th-percentile segment length scaled to pixels per frame — a quantile, not a mean, because a 1:10000
  mix of lamination pitch to silhouette length averages to a value that fades neither correctly.

  Note for callers constructing `createNearPlaneFitter` directly: `groundNormals` changed from
  `THREE.Vector3[]` to `() => THREE.Vector3[]`. This module is not part of the package's public
  surface — `initThree` is the supported entry point and is unaffected.

## 3.1.0-beta.16

### Patch Changes

- Fix edge overlays bleeding through solid geometry when zoomed or orbited out — a hidden grid was
  silently destroying the viewer's depth precision.

  The near-plane fitter raises `camera.near` toward the camera↔content gap to recover depth precision,
  since a depth ULP grows as `1/near`. It also clamps `near` by the camera's perpendicular distance to
  any ground plane carrying an always-visible aid (grid, floor), so that aid can't be clipped at
  grazing views.

  That list of ground planes was captured **once at init, from whether the aid object existed** — not
  from whether it is actually drawn. The viewer builds its grid up-front so the tools menu can toggle
  it, but starts it hidden, so the clamp applied permanently to a grid nobody could see. Because the
  clamp is half the camera's _height above the plane_, orbiting toward a horizontal view drove `near`
  toward zero and the depth ULP up with it. Thin coplanar-ish detail — sheet-goods laminations, layered
  panels — then fell inside a single ULP, and hidden edges won the depth test and drew straight through
  the surfaces in front of them.

  `groundNormals` is now a callback resolved per frame that returns only the planes whose aid is
  currently visible, so a hidden grid or floor constrains nothing and toggling one re-applies its
  clamp on the next frame with no re-init. In the regression test's geometry this lifts `near` from 1
  to 20 — a 20× depth-precision gain; in a typical zoomed-out scene it un-pins `near` from the camera
  height entirely.

  Note for callers constructing `createNearPlaneFitter` directly: `groundNormals` changed from
  `THREE.Vector3[]` to `() => THREE.Vector3[]`. This module is not part of the package's public
  surface — `initThree` is the supported entry point and is unaffected.

## 3.1.0-beta.15

### Patch Changes

- Adding advanced caching

## 3.1.0-beta.14

### Minor Changes

- 5b37862: Fix the viewer's view presets, which showed the wrong side of the model, and route every
  orientation default through a single scene-up basis.

  `buildViewDirections` derived its ground-plane axes with the opposite handedness to Rhino's, so in
  the default Z-up scene **Front framed the back of the model and Left framed the right**. The
  nav-cube inherited the same error. Presets now follow Rhino's convention: Front looks along +Y
  (camera at -Y) and Right looks along -X (camera at +X).

  **Top and Bottom were also wrong, for a separate reason.** At a pole the view direction is parallel
  to `camera.up`, so `up` cannot define the view's roll — the ~0.5° off-pole nudge that avoids the
  OrbitControls singularity decides it instead, and it was leaning toward `+forward`. Both pole views
  came out rolled, with geometry and text mirrored on screen.

  Both poles now lean toward `-forward`, reproducing Rhino's convention exactly: Top is `+X` right /
  `+Y` up and unmirrored; Bottom is `+X` right / `+Y` down. Bottom being mirrored is correct — it is
  the far side of the model, and Rhino mirrors it too — but it must mirror about the horizontal axis.
  Mirroring about the vertical instead (`+X` left / `+Y` up) is the same image rolled 180°, which
  still reads as wrong on screen while satisfying a naive "is it mirrored?" check.

  The existing test only asserted that "front" was orthogonal to the up axis, which a 180° swap
  satisfies — the presets are now pinned to the actual side the camera sits on, and the pole views are
  additionally pinned by their on-screen axes and handedness rather than direction alone.

  A new `up-axis` module (`buildUpBasis`, `isoOffset`, `sunOffset`, `upToAxis`, exported from
  `@selvajs/compute/visualization`) is the single source of truth for the scene basis. Several
  defaults previously hardcoded a Z-up vector while _bypassing_ the configured `sceneUp`, so a scene
  configured Y-up got a below-horizon camera and a near-horizontal sun even though the presets, floor,
  and grid correctly followed `sceneUp`. Now derived from it:

  - the default iso camera position (`applyDefaults`)
  - the default sun position
  - `updateScene`'s first-frame framing — previously a hardcoded `(0.8, 1.0, 1.2)` offset that also
    disagreed with the configured iso default, so the first solve jumped to a different angle than the
    one the viewer opened at
  - the near-plane fitter's grid ground-normal fallback

  Z-up scenes — every current deployment — keep their existing camera distance and sun placement;
  these are behaviour-preserving there and only change non-default `sceneUp` scenes.

  ## Breaking: `allowAutoPosition` now defaults to `false`

  `getThreeMeshesFromComputeResponse` used to drop geometry onto the ground plane by default, but the
  WebSocket preview path never did — so the same definition rendered at a different height depending
  on transport. Both now keep Rhino's coordinates: the viewer agrees with the Grasshopper definition,
  and bounds/measured/picked positions correspond to the real model.

  **Migration:** pass `allowAutoPosition: true` to restore the old behaviour.

  `MeshExtractionOptions` also gains `groundAxis` (default `'z'`) so that grounding, when enabled,
  drops content along the scene's up axis instead of always subtracting `min.z`.

  ## HDR environment orientation

  `scene.environmentRotation` and `scene.backgroundRotation` are now set from `sceneUp`. Three's
  equirectangular mapping assumes a Y-up horizon, so in the Z-up scene the environment was lying on
  its side — the horizon ran vertically and image-based lighting arrived from +Y rather than from
  overhead. Invisible on a neutral studio HDR, obvious on any HDR with a sky/ground split. Exposed as
  `environmentRotationFor`.

  Also corrects stale docs that contradicted the code: the grid `plane` default (documented `'y'`,
  actually `'z'`), the camera controller's `up` ("Defaults to Y-up" — the caller always passes Z), a
  `batch-parser` comment describing a Z-up→Y-up rotation that no longer happens, and the previously
  undocumented `sceneUp` default.

## 3.1.0-beta.13

### Minor Changes

- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

## 3.1.0-beta.12

### Minor Changes

- aa2abf6: Beta release covering the pre-open-source hardening pass and follow-on work across the app stack:

  - **Audit/erasure**: user-deletion erasure now scrubs `audit_events`, `invites`, and redacts embedded emails from surviving `invite.created` payloads; `solve_metrics` is anonymized rather than cascaded.
  - **Logging**: structured logging via Pino with request-ID correlation, replacing ad hoc console logging across the server.
  - **Caching**: durable L2 solve-result cache with a memory backend, client-side result memoization (LRU), warm-client caching per server, backpressure controls, and definition byte caching; response wire-size tracking feeds caching efficiency metrics.
  - **Definitions**: extracted definitions server slice (`@selvajs/server/definitions`) with schema-version-aware extraction/caching and hardened schema-version parsing/error handling.
  - **Tests**: new e2e core-loop tests against a fake compute server, and per-file test isolation to fix flaky mocks.

## 3.1.0-beta.11

### Patch Changes

- b0d8bd8: Move `@selvajs/compute` into the Selva monorepo (`packages/compute`). No API or behavior changes — the package continues to publish to npm under the same name and version line. Development, issues, and the SLVA mesh wire-format now live alongside the plugin and app that consume it.

## 3.1.0-beta.9

### Minor Changes

- 4314be6: Export `LOOKS`, the render-look values as a runtime array, so consumers can build a style picker without hardcoding the names.

  - `LOOKS = ['technical', 'studio', 'showcase'] as const` is the single source of truth; the `Look` type is now derived from it (`(typeof LOOKS)[number]`), so the type and the enumerable list can never drift.
  - Exported as a value from both `@selvajs/compute/visualization` and the internal visualization barrel; `Look` is now also re-exported from `@selvajs/compute/visualization`. Adding or renaming a look updates every consumer's iteration automatically.

## 3.1.0-beta.7

### Patch Changes

- 6c41f0c: Unify the three near-duplicate scene content-bounds helpers into one `computeContentBounds` in `three-helpers.ts`.

  - Removed the private `computeContentBox` (camera-controller) and the private `computeContentBounds` (three-initializer), plus two duplicated copies of `isViewerAid` / `VIEWER_AID_IDS`. Fit-to-view, shadow-frustum fitting, pick-threshold scaling, and preset-view framing (`setView`) now all measure the same box through the single shared function — no behavioral change, no drift risk.
  - The canonical helper refreshes world matrices once up front (`scene.updateMatrixWorld(true)`) so `expandByObject` reads current transforms regardless of which caller invokes it.

## 3.1.0-beta.6

### Minor Changes

- 65690d7: Improved display theme defaults

## 3.1.0-beta.5

### Minor Changes

- f98aa9c: Adding back pressure to the lib

## 3.1.0-beta.4

### Patch Changes

- 2d9943e: CI-only fixes, no package behavior change: pinned the release workflow's npm upgrade to the 11.x line (npm 12 dropped Node 20 support, breaking OIDC trusted publishing on our runner), and added a `concurrency` guard to the docs deployment workflow to prevent overlapping runs from producing duplicate `github-pages` artifacts.

## 3.1.0-beta.3

### Minor Changes

- 4b5a957: `ComputeConfig.headers` — optional extra headers sent on every solve / IO request.

  - Merged UNDER the transport's own headers (`X-Request-ID`, `Content-Type`, `Authorization`, `RhinoComputeKey`) in `buildHeaders`, so a caller can never override auth or the request id.
  - Flows through `GrasshopperClient` (config spread untouched by `normalizeComputeConfig`, returned by `getConfig`) into both the `grasshopper` solve endpoint and the `io` endpoint, and through the `SolveScheduler` (which reuses the client config).
  - Intended for routing/telemetry hints a reverse proxy or load balancer reads — e.g. a definition-affinity key (`X-Selva-Definition`) so a pool routes repeat solves of one definition to the same VM. A single-node server ignores unknown headers, so it is inert until a router exists.

## 3.1.0-beta.2

### Patch Changes

- 673f538: Fixed several memory leaks in the three.js viewer that caused unbounded growth across repeated solves and mount/unmount cycles.
  - rhino3dm objects decoded during display-item parsing (curves, polylines, bounding boxes) are now explicitly deleted after use — rhino3dm is an emscripten/WASM binding, so JS GC never reclaims its heap allocations, and every solve was leaking them.
  - `EdgesGeometry`'s position array is now handed to `LineSegmentsGeometry` directly instead of being round-tripped through `Array.from`, avoiding a redundant boxed copy of every vertex.
  - The HDR environment texture now checks whether the viewer has been disposed before attaching, and disposes itself instead if the viewer was torn down while the HDR was still loading.
  - `dispose()` now calls `renderer.forceContextLoss()` to free the WebGL context immediately, rather than waiting on GC — browsers cap live WebGL contexts (~16), and rapid mount/unmount (e.g. navigating between definitions) could exhaust that cap.
  - Restoring an object's original material after deselection now disposes the highlight clone's material when the object has left the scene, since a wholesale scene clear leaves no later traversal able to reach it.

## 3.1.0-beta.1

### Minor Changes

- d107e18: Optional UV / vertex-color channels and material textures for the SLVA mesh format.
  - `parseBinaryMeshBatch` decodes the new trailing chunks (`FLAG_HAS_UVS` 0x8, `FLAG_HAS_VERTEX_COLORS` 0x10): quantized-or-float32 UVs are returned as absolute `Float32Array` pairs, colors as raw RGB bytes. Blobs without the chunks decode byte-for-byte as before (zero cost when absent).
  - Mesh builders set `uv` and normalized `color` BufferAttributes on both the merged and per-mesh paths, sliced per mesh by `vertexStart`/`vertexCount`.
  - `SerializableMaterial` gains an optional `map` texture URL; textures load through a session-wide URL-keyed cache (`clearTextureCache` exported for teardown) and `vertexColors` is enabled automatically when a batch carries colors.

## 3.0.1-beta.0

### Patch Changes

- d6f7af9: Hardened `core` against several edge-case bugs found in review:
  - `validateServerUrl` now blocks the public McNeel endpoint by parsed hostname instead of exact string match, closing bypasses via trailing slash, scheme, casing, port, or path.
  - Caller-initiated aborts from `fetchRhinoCompute` now reject with `code: 'ABORTED'` instead of `'UNKNOWN_ERROR'`.
  - IPv6 `localhost` (`[::1]`) is now correctly recognized, avoiding a spurious "no API key configured" warning; that warning also now fires once per server instead of once per request.
  - `decodeBase64ToBinary` validates input consistently across Node and browser runtimes and throws `ENCODING_ERROR` on malformed input instead of silently producing garbage (Node) or an unwrapped DOMException (browser).
  - File extraction (`extractFilesFromComputeResponse`, `downloadFileData`) now degrades per-file on a bad item (unusable data or undecodable base64) instead of aborting the whole batch, matching the existing remote-fetch behavior.
  - Remote file fetches (`additionalFiles`) now time out after 30s instead of being able to hang indefinitely.
  - ZIP archive building now disambiguates duplicate archive paths instead of silently overwriting one file with another.
  - Browser file downloads (`saveFile`) now append the anchor to the DOM and defer revoking the object URL, fixing downloads that could be silently dropped in some browsers.
  - `ComputeServerStats`'s internal `fetchWithTimeout` now merges caller-supplied headers instead of letting them replace the default headers outright (which could drop the API key).
  - `setLogger` now validates that a custom logger implements all four required methods, failing fast with a clear error instead of a confusing crash at a later, unrelated call site.
  - `RhinoComputeError`'s `code` is now typed as `ErrorCode` instead of `string`.
  - Minor: request size accounting now counts UTF-8 bytes instead of UTF-16 code units; `readField`/`hasField` cache per-object key lookups; a truncated 2xx response body is now retried like other transient network errors; `camelcaseKeys` is marked `@deprecated` in favor of `readField`/`hasField`.

## 3.0.0

### Major Changes

- a3bad0e: Give the webdisplay orchestrator sole ownership of unit→scale, and remove the `scaleFactor` option from `parseMeshBatchObject` and `parseMeshBatchBlob`.

  `scaleFactor` was applied in two places: the batch parsers scaled meshes when `scaleFactor !== 1`, _and_ the webdisplay orchestrator independently re-scaled the returned meshes from `modelunits`. The real extraction path goes through the orchestrator, which never passed `scaleFactor` into the parsers — so the in-parser knob was dead on that path, but a caller using `parseMeshBatchObject`/`Blob` directly _and_ the orchestrator would double-scale.

  Unit scaling is a model-level concern that only the orchestrator can source (it owns `modelunits`), so it is now the single scaling home. The `scaleFactor?` option is removed from both parsers; they always emit identity-scaled meshes. The orchestrator's behavior (`getThreeMeshesFromComputeResponse`) is unchanged.

  **Migration:** callers using `parseMeshBatchObject`/`parseMeshBatchBlob` directly with a `scaleFactor` should scale the returned meshes themselves (`mesh.scale.set(s, s, s)`), or go through `getThreeMeshesFromComputeResponse`, which derives the scale from `modelunits`.

- a3bad0e: Slim the public API surface: remove dead exports and internalize plumbing that was never part of the intended public API.

  This narrows the published surface to the high-level client/scheduler/IO APIs and the documented extension seams. The internal implementation is unchanged — the removed symbols still exist as module-internal code where the library uses them; they're just no longer re-exported.

  **Removed entirely (dead — no callers anywhere):**
  - `base64ToRhinoObject` (core util) — unused internal decode helper.
  - `getValueByParamName` / `getValueByParamId` methods on `GrasshopperResponseProcessor` — deprecated; use `getValue({ byName })` / `getValue({ byId })`.
  - `Values` and `ProcessedDataItem` types — unused.
  - The `normalizeDefault` schema-only wrapper — internal callers use `normalizeDefaultWithWarning`.
  - `camelcaseKeys` / `toCamelCase` (core string utils) — the IO layer reads fields case-insensitively via `readField` now; the old deep-camelCasing approach was removed and these had no remaining callers.
  - `zipArgs` (core util) and `decodeBase64ToString` (core encoding util) — internal, unused, never re-exported.
  - `DecompressedMeshData` type (visualization) — unused, stale (its `indices` type didn't match the parser); use `ParsedBinaryMeshBatch`.

  **Removed from the public API (still used internally; import the high-level API instead):**
  - Hashing internals: `hashSolveInput`, `hashDefinition`, `stableStringify`, `fnv1a`, `fnv1aBytes` — the `SolveScheduler` handles caching for you.
  - Scheduler wiring types: `SolveExecutor`, `CacheKeyExecutor`.
  - Decoder engine: `decodeRhinoGeometry`, `decodeRhinoObject`, `DecodeRhinoOptions` — the public extension seam remains `registerDecoder`.
  - IO/input plumbing: `processInputWithError` (use `processInput` / `processInputsWithErrors`), `extractFileData` (use `extractFilesFromComputeResponse` / `downloadFileData`).

  **Unchanged / still public:** `GrasshopperClient`, `GrasshopperResponseProcessor`, `SolveScheduler` (+ `SolveResult`/`SolveContext`/`SolveSchedulerOptions`/`SchedulerMode`/`CacheOptions`), `processInput`/`processInputs`/`processInputsWithErrors`, `solveGrasshopperDefinition`, `fetchDefinitionIO`/`fetchParsedDefinitionIO`, `getValue`/`getValues`, `registerDecoder`, `TreeBuilder`, the file-handling helpers, `ComputeServerStats`, and the full visualization toolkit.

### Minor Changes

- a3bad0e: Add viewer support for caller-owned geometry that persists across solves, and mark compute geometry with a source tag.

  Previously every object in the scene except viewer infrastructure (`floor`/`grid`/`label-layer`) was cleared on each `updateScene` solve, so anything a caller added directly via `scene.add` was disposed on the next update. There was also no way to tell compute-generated geometry apart from other objects in the scene.

  Two additive changes:
  - Compute geometry now carries `userData.source = 'compute'` — meshes (merged and individual), curves, and points. Useful for picking, filtering, and debugging.
  - Three new viewer methods on the `initThree` return:
    - `addUserGeometry(object)` — tags the object `userData.source = 'user'` and adds it to the scene. User geometry persists across `updateScene` solves instead of being cleared with compute content, and is framed as normal content by fit-to-view.
    - `removeUserGeometry(object)` — removes a single user object and disposes its geometry/materials.
    - `clearUserGeometry()` — removes and disposes all user-added geometry.

  Non-breaking: existing call sites are unaffected, and nothing is tagged `'user'` until `addUserGeometry` is called.

### Patch Changes

- a3bad0e: Re-export `camelcaseKeys` and `toCamelCase` from `@selvajs/compute/core`. These string utilities were removed in the public-API slim-down, but downstream consumers (e.g. `@selvajs/selva`) still import them, breaking their build.

## 3.0.0-beta.1

### Patch Changes

- 90d95c7: Re-export `camelcaseKeys` and `toCamelCase` from `@selvajs/compute/core`. These string utilities were removed in the public-API slim-down, but downstream consumers (e.g. `@selvajs/selva`) still import them, breaking their build.

## 3.0.0-beta.0

### Major Changes

- 98f1c8d: Give the webdisplay orchestrator sole ownership of unit→scale, and remove the `scaleFactor` option from `parseMeshBatchObject` and `parseMeshBatchBlob`.

  `scaleFactor` was applied in two places: the batch parsers scaled meshes when `scaleFactor !== 1`, _and_ the webdisplay orchestrator independently re-scaled the returned meshes from `modelunits`. The real extraction path goes through the orchestrator, which never passed `scaleFactor` into the parsers — so the in-parser knob was dead on that path, but a caller using `parseMeshBatchObject`/`Blob` directly _and_ the orchestrator would double-scale.

  Unit scaling is a model-level concern that only the orchestrator can source (it owns `modelunits`), so it is now the single scaling home. The `scaleFactor?` option is removed from both parsers; they always emit identity-scaled meshes. The orchestrator's behavior (`getThreeMeshesFromComputeResponse`) is unchanged.

  **Migration:** callers using `parseMeshBatchObject`/`parseMeshBatchBlob` directly with a `scaleFactor` should scale the returned meshes themselves (`mesh.scale.set(s, s, s)`), or go through `getThreeMeshesFromComputeResponse`, which derives the scale from `modelunits`.

- 98f1c8d: Slim the public API surface: remove dead exports and internalize plumbing that was never part of the intended public API.

  This narrows the published surface to the high-level client/scheduler/IO APIs and the documented extension seams. The internal implementation is unchanged — the removed symbols still exist as module-internal code where the library uses them; they're just no longer re-exported.

  **Removed entirely (dead — no callers anywhere):**
  - `base64ToRhinoObject` (core util) — unused internal decode helper.
  - `getValueByParamName` / `getValueByParamId` methods on `GrasshopperResponseProcessor` — deprecated; use `getValue({ byName })` / `getValue({ byId })`.
  - `Values` and `ProcessedDataItem` types — unused.
  - The `normalizeDefault` schema-only wrapper — internal callers use `normalizeDefaultWithWarning`.
  - `camelcaseKeys` / `toCamelCase` (core string utils) — the IO layer reads fields case-insensitively via `readField` now; the old deep-camelCasing approach was removed and these had no remaining callers.
  - `zipArgs` (core util) and `decodeBase64ToString` (core encoding util) — internal, unused, never re-exported.
  - `DecompressedMeshData` type (visualization) — unused, stale (its `indices` type didn't match the parser); use `ParsedBinaryMeshBatch`.

  **Removed from the public API (still used internally; import the high-level API instead):**
  - Hashing internals: `hashSolveInput`, `hashDefinition`, `stableStringify`, `fnv1a`, `fnv1aBytes` — the `SolveScheduler` handles caching for you.
  - Scheduler wiring types: `SolveExecutor`, `CacheKeyExecutor`.
  - Decoder engine: `decodeRhinoGeometry`, `decodeRhinoObject`, `DecodeRhinoOptions` — the public extension seam remains `registerDecoder`.
  - IO/input plumbing: `processInputWithError` (use `processInput` / `processInputsWithErrors`), `extractFileData` (use `extractFilesFromComputeResponse` / `downloadFileData`).

  **Unchanged / still public:** `GrasshopperClient`, `GrasshopperResponseProcessor`, `SolveScheduler` (+ `SolveResult`/`SolveContext`/`SolveSchedulerOptions`/`SchedulerMode`/`CacheOptions`), `processInput`/`processInputs`/`processInputsWithErrors`, `solveGrasshopperDefinition`, `fetchDefinitionIO`/`fetchParsedDefinitionIO`, `getValue`/`getValues`, `registerDecoder`, `TreeBuilder`, the file-handling helpers, `ComputeServerStats`, and the full visualization toolkit.

### Minor Changes

- 603abe0: Add viewer support for caller-owned geometry that persists across solves, and mark compute geometry with a source tag.

  Previously every object in the scene except viewer infrastructure (`floor`/`grid`/`label-layer`) was cleared on each `updateScene` solve, so anything a caller added directly via `scene.add` was disposed on the next update. There was also no way to tell compute-generated geometry apart from other objects in the scene.

  Two additive changes:
  - Compute geometry now carries `userData.source = 'compute'` — meshes (merged and individual), curves, and points. Useful for picking, filtering, and debugging.
  - Three new viewer methods on the `initThree` return:
    - `addUserGeometry(object)` — tags the object `userData.source = 'user'` and adds it to the scene. User geometry persists across `updateScene` solves instead of being cleared with compute content, and is framed as normal content by fit-to-view.
    - `removeUserGeometry(object)` — removes a single user object and disposes its geometry/materials.
    - `clearUserGeometry()` — removes and disposes all user-added geometry.

  Non-breaking: existing call sites are unaffected, and nothing is tagged `'user'` until `addUserGeometry` is called.

## 2.6.0

### Minor Changes

- 2185417: Surface a definition-cache verdict on successful solves via `SolveResult.definitionReuploaded`.

  When `reuseServerDefinitionCache` is enabled the scheduler solves by server cache-key
  (pointer) and only re-uploads the full definition on a stale-pointer miss. The
  underlying executor already computed this `missed` flag for telemetry, but
  `runExecutor` discarded it before the result reached `onSettle`, so consumers had no
  way to tell a definition-cache HIT from a re-upload.

  The `success` variant of `SolveResult` now carries an optional `definitionReuploaded`:
  - `false` — the server reused its cached definition via the pointer (no upload).
  - `true` — the pointer was cold/stale, so the full definition was re-uploaded.
  - `undefined` — the server-definition-cache fast path didn't run (reuse disabled, or
    a non-reusable definition such as a remote-URL source).

  Additive and optional, so existing `onSettle` consumers are unaffected.

## 2.5.0

### Minor Changes

- e12b1a1: Add `cacheerroredsolves` opt-in for caching solves that report Grasshopper errors.

  By default the Rhino Compute server never caches a solve whose definition reported
  GH errors, so a definition that errors re-solves on every request — even when the
  errors are by design (a guarded Python component, a filtered/pruned branch) and
  the geometry is correct. Set `cacheerroredsolves: true` (alongside `cachesolve`)
  to let such completed-but-errored solves into the server's solve cache.
  - New optional field on `GrasshopperBaseSchema` and `GrasshopperComputeConfig`;
    forwarded to the `/grasshopper` request via `applyOptionalComputeSettings`.
  - Default unset/false — fully backward compatible.
  - Requires a Rhino Compute server that honors `cacheerroredsolves` (the VektorNode
    fork). Older servers ignore the unknown field.

## 2.4.0

### Minor Changes

- 33c10db: WebDisplay mesh payloads: uint16 indices, optional gzip container, and stable per-placement identity.

  **uint16 indices (SLVA v2).** The binary mesh parser reads a new flag (`FLAG_UINT16_INDICES`,
  bit 1 of the geometry flags word) and decodes 16-bit indices when set, halving the index payload
  for batches that address 65,535 or fewer vertices — typically the largest part of the blob for
  unwelded brep meshes.

  **Optional gzip container (SLVZ).** Mesh blobs that ship wrapped in a `SLVZ`-magic container are
  inflated (raw DEFLATE via `fflate`) and the inner SLVA blob is parsed unchanged. Plain
  (uncompressed) `SLVA` blobs are detected by their leading magic and flow through untouched.

  **Per-placement identity.** When building meshes, the envelope's `sourceComponentId` is preferred
  over the blob's embedded value, so a reloaded part instanced many times keeps a distinct web-pick
  identity per placement. The embedded blob value remains the fallback for raw-blob transport, which
  carries no envelope.

  Backward compatible: v1 blobs decode as v2 with the uint16 flag implicitly clear. This is forward
  compatibility on the decoder only — a v2 / SLVZ blob produced by an updated plugin will not decode
  on an older `@selvajs/compute`, so the plugin and this package must be released together.

  The package now builds on TypeScript 6.

## 2.3.0

### Minor Changes

- 7ee92d6: Detect server-side definition-cache misses by error code, not message.

  When solving by `pointer` (server cache key), a stale/evicted key now reliably
  triggers the transparent full-upload fallback even against a production Rhino
  Compute server. Previously the miss was detected by string-matching the server's
  exception message, which the server scrubs to a generic string when not in debug
  mode — so the fallback never fired in production and the caller saw a hard error.
  - Added `ErrorCodes.DEFINITION_NOT_CACHED`.
  - `fetchRhinoCompute` now reads an optional machine `code` from the server's JSON
    error body and maps `"definition_not_cached"` onto that code, taking precedence
    over the status-derived classification.
  - `solveByCacheKey` / `isDefinitionLoadMiss` match on the code first, keeping the
    legacy message match as a fallback for debug-mode servers and older forks.

  Requires a Rhino Compute server that emits `code: "definition_not_cached"` on a
  stale-pointer miss (VektorNode fork). Older servers continue to work via the
  message fallback when running in debug mode.

### Patch Changes

- 1763b6b: Prefer the envelope's `sourceComponentId` over the blob's embedded value when building meshes. The
  blob bakes in the id at encode time, but a reloaded part (e.g. a `.dmf` instanced many times)
  re-stamps a fresh id on the envelope to keep web pick identity distinct per placement. The embedded
  blob value remains the fallback for raw-blob transport, which carries no envelope.

## 2.3.0-beta.1

### Patch Changes

- 1763b6b: Prefer the envelope's `sourceComponentId` over the blob's embedded value when building meshes. The
  blob bakes in the id at encode time, but a reloaded part (e.g. a `.dmf` instanced many times)
  re-stamps a fresh id on the envelope to keep web pick identity distinct per placement. The embedded
  blob value remains the fallback for raw-blob transport, which carries no envelope.

## 2.3.0-beta.0

### Minor Changes

- 2e73673: Shrink WebDisplay mesh payloads: uint16 indices and optional blob compression.

  **uint16 indices (SLVA v2).** The binary mesh parser now reads a new flag (`FLAG_UINT16_INDICES`,
  bit 1 of the geometry flags word) and decodes 16-bit indices when set, halving the index payload for
  batches that address 65,535 or fewer vertices — typically the largest part of the blob for unwelded
  brep meshes.

  **Optional gzip container (SLVZ).** Mesh blobs otherwise ship uncompressed (no transport gzip on
  dynamic compute responses or the local WebSocket). The parser now detects a `SLVZ`-magic container,
  inflates it (raw DEFLATE via `fflate`), and parses the inner SLVA blob unchanged. The plugin applies
  this only when it shrinks the payload, so an uncompressed `SLVA` blob still flows through untouched.

  **Backward compatible.** v1 blobs are layout-identical to v2 with the uint16 flag implicitly clear,
  so previously persisted or cached blobs continue to decode; only versions outside
  `MIN_SUPPORTED_VERSION`..`BINARY_MESH_VERSION` are rejected. A plain (uncompressed) blob is detected
  by its leading magic, so non-SLVZ inputs are unaffected.

  Note: this is forward compatibility on the decoder only. A v2 / SLVZ blob produced by an updated
  plugin will not decode on an older `@selvajs/compute`, so the plugin and this package must be
  released together.

## 2.2.0

### Minor Changes

- 5cedef9: Expand `ComputeServerStats` to cover the full rhino.compute proxy/control surface (excluding the SELVA schema endpoints) so consumers no longer hand-roll fetches:
  - `getInstalledPlugins(kind)` — `/plugins/{gh,rhino}/installed`
  - `getServerTime()` — `/servertime`
  - `getIdleSpan()` — `/idlespan`
  - `launchChildren()` / `launchChild(port)` — `/launch-children`, `/launch-child`
  - `shutdownChildren(port?)` / `recycleChildren(port?)` — child-lifecycle controls
  - `purgeAllChildren()` — best-effort fleet-wide cache purge (loops `/cache/purge` across the round-robin pool; reports a `confident` flag, exact only at a single-child pool)
  - `getActiveChildren({ initialize })` — pass `initialize: false` for a passive count that does not spawn (and wake/bill) an idle server; `getServerStats()` now uses this passive read

  **Fix:** `isServerOnline()` now probes the proxy liveness root `/` instead of the non-existent `/healthcheck` route. The rhino.compute proxy never exposed `/healthcheck`; the old probe was forwarded to a child for an unknown path, so it reported reachability of a child rather than the proxy.

## 2.1.0

### Minor Changes

- 9264ebb: Unify the coordinate frame: the Three.js scene is now Rhino's frame (Z-up), end to end.

  Previously the display pipeline rotated Rhino Z-up geometry into Three's native Y-up
  (`(x, y, z) → (x, z, −y)`) during mesh decompression and display-item parsing. That hidden
  rotation meant every feature producing or consuming positions — measurements, mesh metadata,
  label anchors, picking, the new camera presets/grid — had to round-trip through it or silently
  land in the wrong frame.

  The rotation is removed everywhere. A Rhino point `(x, y, z)` is now the Three point `(x, y, z)`:
  - `rhinoToThree` is the identity (kept, deprecated, for call-site compatibility).
  - The int16/float32 vertex paths in `webdisplay/batch-parser.ts` pass vertices through unrotated.
  - `initThree` orients the camera, default iso position, sunlight, floor, and reference grid to the
    scene up axis (Z-up by default); the camera controller's presets are likewise up-derived.

  **Breaking:** any consumer that assumed viewer geometry was Y-up (e.g. reading mesh vertex
  positions, placing objects, or computing directions in Three space) must drop the
  `(x, z, −y)` conversion — Three space now equals Rhino space. The `applyTransforms` option is
  retained but no longer rotates; it will be removed in a future release.

- 9264ebb: Release v2.1.0: Z-up coordinate frame, measurement tool, and CAD viewer tooling.

  **Coordinate frame unification (breaking)**

  The Three.js scene is now Z-up end-to-end, matching Rhino's native frame. The hidden `(x, y, z) → (x, z, −y)` rotation that was applied during mesh decompression and display-item parsing is removed. `rhinoToThree` is kept as an identity for call-site compatibility but deprecated. Consumers that read mesh vertex positions or place objects in Three space must drop any `(x, z, −y)` conversion — Three space now equals Rhino space.

  **CAD viewer tooling — public exports**

  The camera controller, reference grid, view gizmo, edge overlays, label layer, and measurement tool are now exported from the public `visualization` entry point. Previously their factories and types were only available internally. New exports include `createCameraController`, `createGrid`, `createViewGizmo`, `addEdges`/`removeEdges`, `createLabelLayer`, `createMeasureTool`/`snapToVertex`, and all associated config/option types (`GridConfig`, `GizmoConfig`, `EdgesConfig`, `MeasureConfig`, `ViewPreset`, `CameraProjection`, …). Additive only — no existing export changed.

  **Measurement tool improvements**
  - Snapping extended to lines and points: `snapToVertex` snaps to the nearer endpoint of a struck segment and to the struck vertex on point objects. Raycast thresholds for lines and points are scaled by view distance so thin geometry is actually clickable at any zoom.
  - Cursor preview: a ghost marker follows the cursor and jumps to the snap vertex before a click commits it.
  - Drag-to-orbit no longer disturbs a measurement — clicks that follow a drag past the slop threshold are ignored.
  - Labels now show per-axis deltas (`Δx`/`Δy`/`Δz`) alongside the total distance. The `format` callback is widened to `(distance, delta) => string`; existing `(distance) => string` callbacks remain valid.
  - Labels ship with a default dark-pill style so they are legible on any background. Pass `labelClassName` to opt out.

  **Camera, grid, and label layer fixes**
  - `initThree` sets `camera.up` before constructing OrbitControls so preset views (`top`/`front`/…) and orbit behavior are correct for Z-up scenes.
  - The grid's default plane is derived from the scene up axis (Z-up → `plane: 'z'`); an explicit `plane` still takes precedence.
  - `clearScene` preserves the persistent `floor`, `grid`, and `label-layer` groups across content updates, fixing measurement labels disappearing in streaming viewers (e.g. per Grasshopper solve).
  - The CSS2D label overlay gets an explicit `z-index` so labels stack above container scrims while staying below menus and popovers.

- 9264ebb: Export the CAD viewer tooling from the public `visualization` entry point.

  The camera controller, reference grid, view gizmo, edge overlays, label layer, and
  measurement tool shipped in 2.1.0-beta.1 were wired through `initThree` at runtime, but
  their factories and types were only re-exported from the internal
  `features/visualization/index.ts` barrel — not from `src/visualization.ts`, the actual
  published entry. Consumers could enable the tools via options and read them off the
  `initThree` return, but could not import the supporting type names
  (`CameraController`, `MeasureTool`, `ViewPreset`, `CameraProjection`, …) or the
  config types (`GridConfig`, `GizmoConfig`, `EdgesConfig`, `MeasureConfig`).
  - Re-export `createCameraController`, `createGrid`, `createViewGizmo`, `addEdges`/`removeEdges`/`isEdgeOverlay`, `createRenderPipeline`, `createLabelLayer`, `createMeasureTool`/`snapToVertex` and their types from `visualization`.
  - Re-export the `GridConfig`/`GizmoConfig`/`EdgesConfig`/`MeasureConfig` option types.
  - Also surface `parseColor`, `applyOffset`, and `computeCombinedBoundingBox` from `three-helpers`.

  Additive only — no existing export changed.

### Patch Changes

- 9264ebb: Fix measurement/dimension labels never appearing in viewers that stream new content (e.g. per
  Grasshopper solve).
  - `updateScene`/`clearScene` removed every top-level scene child except the floor on each update,
    which detached the persistent CSS2D `label-layer` group. Labels added afterwards were parented to
    an orphaned group, so the CSS2D renderer (which walks the live scene) never injected their DOM.
    `clearScene` now preserves persistent infrastructure — `floor`, `grid`, and `label-layer` — across
    content updates. Demos that add geometry directly (never calling `updateScene`) were unaffected,
    which is why the label only went missing in consumer apps.
  - The CSS2D label overlay also gets an explicit `z-index` so it stacks above container scrims (e.g.
    blur/loading overlays) that previously painted over it, while staying below menu/popover layers.

- 9264ebb: Extend the measurement tool to lines and points, not just meshes.
  - `snapToVertex` now snaps line hits to the nearer endpoint of the struck segment and point hits to
    the struck vertex, in addition to the existing mesh triangle-vertex snapping. Hits without usable
    vertex indices (e.g. fat `Line2`) still fall back to the raw point.
  - Line and Points raycast thresholds are raised per-pick, scaled by the view distance, so thin lines
    and points are actually clickable at any zoom instead of being nearly impossible to hit with the
    default ~1-unit threshold.

- 9264ebb: Make the measurement tool easier to read and aim, and report per-axis deltas.
  - Distance labels now carry a default style (dark translucent pill, light text) so they stay
    legible on any background instead of inheriting the page color (previously invisible white-on-white).
    Passing `labelClassName` still opts out of all default styling.
  - The tool previews the snap point: a ghost marker follows the cursor and jumps to the vertex a
    click would lock onto, so you can aim before committing. `MeasureTool` gains `handleMove(event)`,
    which `initThree` wires to canvas `mousemove`.
  - Orbiting/panning no longer disturbs a measurement: the `click` a drag fires on release is ignored
    (pointer moved past a small slop threshold), so in-progress points and finished measurements survive
    rotation instead of being cleared or mis-placed.
  - The default label now shows the per-axis breakdown (`Δx`/`Δy`/`Δz`) under the total distance. The
    `format` callback signature widens to `(distance, delta) => string`; existing `(distance) => string`
    callbacks remain valid.

- 9264ebb: Make the viewer's camera controller, presets, and grid respect the scene up axis.

  The CAD tooling assumed Three's native Y-up, but Selva scenes are Z-up. `initThree` set
  `scene.up` to Z yet never set `camera.up`, so OrbitControls orbited as if Y-up and the
  preset views (`top`/`front`/…) framed the wrong faces; the grid also defaulted to the
  horizontal Y-up plane.
  - `initThree` now sets `camera.up` to the configured `sceneUp` _before_ constructing
    OrbitControls and the camera controller (both capture the orbit/preset basis from up).
  - The camera controller derives its preset view directions, iso angle, and orthographic
    camera up from the up axis instead of a hardcoded Y-up table, via a new optional `up`
    dependency (defaults to the perspective camera's up).
  - The grid's default plane is derived from the up axis (Z-up → `plane: 'z'`), so the grid
    lies under the model without callers passing `plane` explicitly. An explicit `plane`
    still wins.

  No API changes; behavior is corrected for non-Y-up scenes and unchanged for Y-up.

## 2.1.0-beta.7

### Patch Changes

- fdcc1f8: Fix measurement/dimension labels never appearing in viewers that stream new content (e.g. per
  Grasshopper solve).
  - `updateScene`/`clearScene` removed every top-level scene child except the floor on each update,
    which detached the persistent CSS2D `label-layer` group. Labels added afterwards were parented to
    an orphaned group, so the CSS2D renderer (which walks the live scene) never injected their DOM.
    `clearScene` now preserves persistent infrastructure — `floor`, `grid`, and `label-layer` — across
    content updates. Demos that add geometry directly (never calling `updateScene`) were unaffected,
    which is why the label only went missing in consumer apps.
  - The CSS2D label overlay also gets an explicit `z-index` so it stacks above container scrims (e.g.
    blur/loading overlays) that previously painted over it, while staying below menu/popover layers.

## 2.1.0-beta.6

### Patch Changes

- cf78444: Fix measurement/dimension labels being hidden behind host viewer overlays. The CSS2D label
  overlay now sets an explicit `z-index` so it stacks above container scrims (e.g. blur/loading
  overlays) that previously painted over it, while staying below typical menu/popover layers.

## 2.1.0-beta.5

### Patch Changes

- a9b134b: Extend the measurement tool to lines and points, not just meshes.
  - `snapToVertex` now snaps line hits to the nearer endpoint of the struck segment and point hits to
    the struck vertex, in addition to the existing mesh triangle-vertex snapping. Hits without usable
    vertex indices (e.g. fat `Line2`) still fall back to the raw point.
  - Line and Points raycast thresholds are raised per-pick, scaled by the view distance, so thin lines
    and points are actually clickable at any zoom instead of being nearly impossible to hit with the
    default ~1-unit threshold.

## 2.1.0-beta.4

### Minor Changes

- 9982b33: Unify the coordinate frame: the Three.js scene is now Rhino's frame (Z-up), end to end.

  Previously the display pipeline rotated Rhino Z-up geometry into Three's native Y-up
  (`(x, y, z) → (x, z, −y)`) during mesh decompression and display-item parsing. That hidden
  rotation meant every feature producing or consuming positions — measurements, mesh metadata,
  label anchors, picking, the new camera presets/grid — had to round-trip through it or silently
  land in the wrong frame.

  The rotation is removed everywhere. A Rhino point `(x, y, z)` is now the Three point `(x, y, z)`:
  - `rhinoToThree` is the identity (kept, deprecated, for call-site compatibility).
  - The int16/float32 vertex paths in `webdisplay/batch-parser.ts` pass vertices through unrotated.
  - `initThree` orients the camera, default iso position, sunlight, floor, and reference grid to the
    scene up axis (Z-up by default); the camera controller's presets are likewise up-derived.

  **Breaking:** any consumer that assumed viewer geometry was Y-up (e.g. reading mesh vertex
  positions, placing objects, or computing directions in Three space) must drop the
  `(x, z, −y)` conversion — Three space now equals Rhino space. The `applyTransforms` option is
  retained but no longer rotates; it will be removed in a future release.

### Patch Changes

- 9982b33: Make the measurement tool easier to read and aim, and report per-axis deltas.
  - Distance labels now carry a default style (dark translucent pill, light text) so they stay
    legible on any background instead of inheriting the page color (previously invisible white-on-white).
    Passing `labelClassName` still opts out of all default styling.
  - The tool previews the snap point: a ghost marker follows the cursor and jumps to the vertex a
    click would lock onto, so you can aim before committing. `MeasureTool` gains `handleMove(event)`,
    which `initThree` wires to canvas `mousemove`.
  - Orbiting/panning no longer disturbs a measurement: the `click` a drag fires on release is ignored
    (pointer moved past a small slop threshold), so in-progress points and finished measurements survive
    rotation instead of being cleared or mis-placed.
  - The default label now shows the per-axis breakdown (`Δx`/`Δy`/`Δz`) under the total distance. The
    `format` callback signature widens to `(distance, delta) => string`; existing `(distance) => string`
    callbacks remain valid.

- 9982b33: Make the viewer's camera controller, presets, and grid respect the scene up axis.

  The CAD tooling assumed Three's native Y-up, but Selva scenes are Z-up. `initThree` set
  `scene.up` to Z yet never set `camera.up`, so OrbitControls orbited as if Y-up and the
  preset views (`top`/`front`/…) framed the wrong faces; the grid also defaulted to the
  horizontal Y-up plane.
  - `initThree` now sets `camera.up` to the configured `sceneUp` _before_ constructing
    OrbitControls and the camera controller (both capture the orbit/preset basis from up).
  - The camera controller derives its preset view directions, iso angle, and orthographic
    camera up from the up axis instead of a hardcoded Y-up table, via a new optional `up`
    dependency (defaults to the perspective camera's up).
  - The grid's default plane is derived from the up axis (Z-up → `plane: 'z'`), so the grid
    lies under the model without callers passing `plane` explicitly. An explicit `plane`
    still wins.

  No API changes; behavior is corrected for non-Y-up scenes and unchanged for Y-up.

## 2.1.0-beta.3

### Minor Changes

- 15cdcfb: Export the CAD viewer tooling from the public `visualization` entry point.

  The camera controller, reference grid, view gizmo, edge overlays, label layer, and
  measurement tool shipped in 2.1.0-beta.1 were wired through `initThree` at runtime, but
  their factories and types were only re-exported from the internal
  `features/visualization/index.ts` barrel — not from `src/visualization.ts`, the actual
  published entry. Consumers could enable the tools via options and read them off the
  `initThree` return, but could not import the supporting type names
  (`CameraController`, `MeasureTool`, `ViewPreset`, `CameraProjection`, …) or the
  config types (`GridConfig`, `GizmoConfig`, `EdgesConfig`, `MeasureConfig`).
  - Re-export `createCameraController`, `createGrid`, `createViewGizmo`, `addEdges`/`removeEdges`/`isEdgeOverlay`, `createRenderPipeline`, `createLabelLayer`, `createMeasureTool`/`snapToVertex` and their types from `visualization`.
  - Re-export the `GridConfig`/`GizmoConfig`/`EdgesConfig`/`MeasureConfig` option types.
  - Also surface `parseColor`, `applyOffset`, and `computeCombinedBoundingBox` from `three-helpers`.

  Additive only — no existing export changed.

## 2.1.0-beta.2

### Minor Changes

- 38cf55d: Add optional `metadata` (`Record<string, string>`) to `FileData`, carrying arbitrary key/value pairs attached in Grasshopper through to downstream consumers for tagging and indexing. Optional and backwards-compatible — existing payloads and the `isFileData` guard are unaffected.

### Patch Changes

- 38cf55d: Make `GrasshopperClient.create()` resilient to a cold or briefly-busy-but-up Compute server.

  The pre-flight `/healthcheck` probe was a single-sample boolean gate with no retry and no timeout, so one missed probe (warm-up, a transient network blip, momentary non-200) made construction throw `NETWORK_ERROR` even though the server was online.
  - `create()` now retries the healthcheck with exponential backoff (default 3 probes, 250ms→1s) before failing, configurable via the existing `config.retry` policy, and disposes the client on final failure.
  - `isServerOnline(timeoutMs = 5000)` now bounds the probe with `AbortSignal.timeout` so a hung connection can't stall the caller; pass `0` to disable. The probe in `create()` always uses its own timeout, independent of `config.timeoutMs` (which may be `0` for long solves).

## 2.1.0-beta.1

### Minor Changes

- 5b8c969: Expand the viewer with CAD-style tooling: camera controller (2D/3D toggle, preset views, rotate lock), infinite fading reference grid, mesh edge overlays, label layer, and a two-click measurement tool.

## 2.1.0-beta.0

### Minor Changes

- Add display items and DisplayBatch support for visualizing non-mesh objects (curves, points) with coordinate transformation.

## 2.0.0

### Major Changes

- 5a332c4: Release v2.0.0.

## 2.0.0-beta.5

### Patch Changes

- c73e215: Fix tree-access `System.String` defaults being JSON-parsed, corrupting value-list inputs on the wire.

  The 2.0 input-normalization pipeline (`normalize-default.ts`) JSON-parsed any tree-access item typed `System.String` whose `data` started with `[` or `{`. A multi-value `Dynamic_ValueList` sends exactly such labels (e.g. `"[1,2,3]"`), so its default was turned into a real array on the leaf `data`. The Rhino.Compute (VektorNode) fork expects that leaf to be a string and its Newtonsoft reader throws `Unexpected character ... value: [` at the leaf position, crashing the solve. 1.5.3 sent the raw string, so this was a 2.0-line regression.
  - Restrict the JSON.parse branch in `normalizeDefaultWithWarning` to `Rhino.Geometry*` types (which really are JSON-encoded on the wire). `System.String` now falls through and round-trips unchanged.
  - Add a regression test pinning that bracket-leading string tree values stay strings.

## 2.0.0-beta.4

### Patch Changes

- ae0dce2: Fix `/io` parsing returning zero inputs (or crashing) on PascalCase server responses.

  beta.3 read the `/io` response straight through as camelCase (`response.inputs`, `schema.paramType`, …). That only holds when the server emits fully camelCase IO (the VektorNode Compute8 fork with `[JsonProperty]` on every field). Upstream-tracking branches (mcneel 8.x/9.x, `8.x.selva`) keep the C# classes close to source, so the top-level wrapper is PascalCase `Inputs`/`Outputs` and per-param fields are `ParamType`/`Minimum`/`Name`/… — and if a `[JsonProperty]` is ever dropped, individual fields silently revert to PascalCase. On such a server every read missed: `response.inputs` was `undefined`, so the input list came back empty (or, before the array guard, threw `inputs is not iterable`).
  - Read the top-level `Inputs`/`Outputs` case-insensitively via `readField` in `fetchDefinitionIO`, then guard each to an array with `Array.isArray` (not `?? []` — the symptom is non-iterability, so a non-array truthy value like `{}` or a string must coerce to `[]` too). The already-surfaced `loadErrors`/`loadWarnings` then explain _why_ a list came back empty instead of the client crashing.
  - Normalize each input/output record's field casing once at the parse boundary (`normalize-schema.ts`), so the per-type parsers stay branch-agnostic and read straight through. Only field KEYS are canonicalized — `default` (handled separately by `normalize-default`) and user-authored value-list `values` label keys ("Option A") are passed through verbatim, avoiding the label-mangling that a deep `camelcaseKeys` pass caused.
  - The client is now casing-agnostic: identical camelCase and PascalCase `/io` bodies parse to the same typed result.
  - Add regression tests pinning both wire shapes end-to-end, plus the malformed/non-array `inputs`/`outputs` guards.

## 2.0.0-beta.3

### Patch Changes

- 7e5a8dd: Fix `inputs is not iterable` crash when the server returns a malformed `/io` response.

  A server fault can return a 200 whose body omits `inputs`/`outputs` (e.g. a definition-LOAD failure that surfaced as a malformed success instead of a clean 500). `fetchDefinitionIO` passed `response.inputs` straight through, and the downstream `for...of` in `processInputsWithErrors` threw `inputs is not iterable`.
  - Coerce `inputs`/`outputs` to `[]` in `fetchDefinitionIO` using `Array.isArray` (not `?? []`) — the symptom is non-iterability, so a non-array truthy value like `{}` or a string must coerce too.
  - The already-surfaced `loadErrors` / `loadWarnings` then explain _why_ the list came back empty instead of the client crashing.
  - Add regression tests covering missing, `null`, non-array-object, and string `inputs`/`outputs`.

## 2.0.0-beta.2

### Patch Changes

- 5ac65cc: Fix input defaults being silently dropped due to wire-casing mismatch.

  The beta removed a global `camelcaseKeys` pass (which had been corrupting value-list label keys), but `normalizeDefault` still literal-matched the lowercase `innerTree` key. Because the `default` DataTree wrapper is serialized as PascalCase (`ParamName` / `InnerTree`) on every server branch — mcneel 8.x/9.x and the VektorNode Compute8 fork alike, since `Resthopper.IO.DataTree` carries no `[JsonProperty]` — the check never matched and every connected input default collapsed to `null` (with an `Unexpected structure in input.default` warning).
  - Add a case-insensitive `readField` / `hasField` wire-field reader (`@/core/utils/read-field`).
  - Read the `default` wrapper (`innerTree`) and item fields (`data` / `type`) case-insensitively, so defaults parse correctly regardless of server-branch casing without re-introducing the label-mangling global camelCase pass.
  - Surface a genuinely unrecognized default shape (no tree key at all) as a client-visible `MALFORMED_DEFAULT` entry in `parseErrors` instead of only logging a server-side warning — so a dropped default is observable on both client and server rather than vanishing silently.
  - Add regression tests pinning the real PascalCase wire shape, including a guard that a non-empty tree default can never silently become `null`.

## 2.0.0-beta.1

### Patch Changes

- f2040dd: Fix input defaults being silently dropped due to wire-casing mismatch.

  The beta removed a global `camelcaseKeys` pass (which had been corrupting value-list label keys), but `normalizeDefault` still literal-matched the lowercase `innerTree` key. Because the `default` DataTree wrapper is serialized as PascalCase (`ParamName` / `InnerTree`) on every server branch — mcneel 8.x/9.x and the VektorNode Compute8 fork alike, since `Resthopper.IO.DataTree` carries no `[JsonProperty]` — the check never matched and every connected input default collapsed to `null` (with an `Unexpected structure in input.default` warning).
  - Add a case-insensitive `readField` / `hasField` wire-field reader (`@/core/utils/read-field`).
  - Read the `default` wrapper (`innerTree`) and item fields (`data` / `type`) case-insensitively, so defaults parse correctly regardless of server-branch casing without re-introducing the label-mangling global camelCase pass.
  - Surface a genuinely unrecognized default shape (no tree key at all) as a client-visible `MALFORMED_DEFAULT` entry in `parseErrors` instead of only logging a server-side warning — so a dropped default is observable on both client and server rather than vanishing silently.
  - Add regression tests pinning the real PascalCase wire shape, including a guard that a non-empty tree default can never silently become `null`.

## 2.0.0-beta.0

### Major Changes

- 3417e9a: Align the Grasshopper client with the Compute8 server contract and overhaul the input/output processing pipeline.
  - Update Grasshopper client to align with the Compute8 server contract
  - Overhaul the input processing pipeline with type-specific parsers
  - Centralize settle-once logic in `SolveScheduler` and unify server URL validation
  - Reuse server-definition cache for more efficient solves
  - Surface previously-unused Compute server features
  - Strengthen hashing for binary definitions to prevent cache collisions
  - Improve error handling in `fetchRhinoCompute` and server exception paths

  This is a major release containing breaking changes to the client contract.

## 1.5.3

### Patch Changes

- 9253770: Match input `paramType` case-insensitively so lowercase schema types (e.g. `valueList`) no longer fail with "Unsupported paramType". Any casing now resolves to its canonical type before parsing.

## 1.5.2

### Patch Changes

- 137b7b5: Forward response body and headers on `RhinoComputeError.context` for all
  non-2xx responses. Adds `context.responseBody` (full body) and
  `context.responseHeaders`, and unifies the message format across status
  codes with a 200-char body hint. Makes upstream 500s easier to diagnose
  when the body is non-empty, and reveals whether the response came from
  Rhino Compute or from a proxy in front of it.

## 1.5.2-beta.1

### Patch Changes

- Structural cleanup: collapse sub-feature barrel files, rename `threejs.ts` entry point to `visualization.ts`, and merge `grasshopper/types/` split into a single file. No public API changes.

## 1.5.2-beta.0

### Patch Changes

- - Fold Rhino → Three coordinate transform into the mesh decompression read pass, eliminating a second pass over vertex data for batched WebDisplay meshes.
  - Use `fflate.gunzip` (Web Worker) in browsers and `gunzipSync` in Node for batched mesh decompression, removing the `requestIdleCallback`/`setTimeout` scheduling hop.
  - Skip excluded types (e.g. WebDisplay) in `getValue` / `getValues` so they no longer write `null` into aggregated results.
  - `solveGrasshopperDefinition` no longer mutates the response object when stripping the `pointer` field; it returns a shallow copy instead.
  - Fix `ComputeServerStats.getVersion` "Body has already been read" error when the response is non-JSON, by reading the body as text first.
  - Tighten hex color parsing in `parseColor` to require exactly 6 hex characters.

## 1.5.1

### Patch Changes

- 192d412: Merge with new project stucture

## 1.5.0

### Minor Changes

- feat: robust transport layer and SolveScheduler for managing solves

  **Transport robustness** (`fetchRhinoCompute`, `GrasshopperClient.solve`)
  - Switch to `AbortSignal.timeout` so per-request timeouts are not throttled when the tab is backgrounded.
  - Accept a caller-supplied `signal` on `ComputeConfig` and as a per-call override on `client.solve(definition, tree, { signal, timeoutMs, retry })`. Composes with the internal timeout via `AbortSignal.any` (with fallback for older runtimes).
  - Add a configurable `retry` policy with exponential backoff + jitter for transient errors (502 / 503 / 504, network errors, and timeouts). Caller cancellation is never retried.
  - Honor `Retry-After` on 429 responses (toggle via `retry.retryOn429`).
  - Scrub the request `args` from timeout/network error contexts; keep `requestId`, `endpoint`, `requestSize`, `url`.

  **`SolveScheduler`** — new opt-in class for managing many short solves and few long ones from one place
  - Three scheduling modes:
    - `latest-wins` — one in flight, supersede pending, abort in-flight when newer values arrive (slider scrubs).
    - `queue` — FIFO with `maxConcurrent` cap (submit-job flows).
    - `parallel` — concurrent up to `maxConcurrent` (closest to plain `client.solve`).
  - Per-call and bulk cancellation: `solve(def, tree, { signal })` and `scheduler.cancelAll()`.
  - Optional response cache (LRU + TTL) keyed by a stable hash of `(definition, dataTree)`.
  - Lifecycle hooks: `onStart`, `onSettle`, `onSuperseded`.
  - Observable state: `subscribe()`, `isSolving`, `hasPending`, `lastResult`, `lastError`, `lastDurationMs`, `inFlightCount`, `queueDepth`.
  - Created via `client.createScheduler(options)`; multiple schedulers can share one client.

  **New public exports**
  - `SolveScheduler`, `hashSolveInput`
  - Types: `SchedulerMode`, `SolveSchedulerOptions`, `CacheOptions`, `SolveContext`, `SolveResult`, `SolveExecutor`, `SolveOptions`, `RetryPolicy`

  No breaking changes — `client.solve(definition, tree)` works exactly as before; the third argument is optional.

### Patch Changes

- 9269727: fix: filter invisible objects from raycaster intersections

  Click and mousemove event handlers now exclude objects where `visible` is `false` from raycaster hit results, preventing interactions with hidden scene objects.

## 1.4.1

### Patch Changes

- a9c7ec1: fix: filter invisible objects from raycaster intersections

  Click and mousemove event handlers now exclude objects where `visible` is `false` from raycaster hit results, preventing interactions with hidden scene objects.

## 1.4.0

### Minor Changes

- 9e735d4: feat: add `onReady` and `onFrame` callbacks to `initThree`; fix canvas resize flicker

  ### New features
  - `events.onReady` — called once the HDR environment map has loaded (or immediately if HDR is disabled or fails), so consumers can coordinate scene loading
  - `events.onFrame(delta)` — called every animation frame before render, for custom per-frame logic or physics updates

  ### Bug fixes
  - **Canvas resize flicker** — resize is now applied inside the animation loop immediately before `renderer.render()`, so the buffer clear and the new frame are composited together. Previously a `ResizeObserver` callback triggered the resize asynchronously, leaving a blank frame between the clear and the next render
  - **`clearScene` ghost groups** — now removes top-level non-floor children and traverses their subtrees for disposal, instead of traversing the whole scene for meshes. This prevents empty `Group` nodes from accumulating after their mesh children were removed
  - **`computeCombinedBoundingBox` empty array** — now returns early on an empty array instead of returning a `Box3` with `+Infinity`/`-Infinity` bounds that would produce `NaN` vectors downstream
  - **Tone mapping mismatch** — `setupRenderer` was falling back to `ACESFilmicToneMapping` despite `applyDefaults` always setting `NeutralToneMapping`; the stale fallback is removed

  ### Breaking changes
  - `initThree` no longer returns a `resize` method (resize is now handled automatically every frame)

### Patch Changes

- 9e735d4: Fix: Enhanced validation in extractFileData to properly check FileData object structure
  - Changed property checks from uppercase (FileName, FileType, Data) to camelCase (fileName, fileType, data)
  - Added type guards for isBase64Encoded (boolean) and subFolder (string) properties
  - Improves type safety and ensures all required FileData properties are validated before parsing

## 1.3.1

### Patch Changes

- 2846ee5: Fix: Enhanced validation in extractFileData to properly check FileData object structure
  - Changed property checks from uppercase (FileName, FileType, Data) to camelCase (fileName, fileType, data)
  - Added type guards for isBase64Encoded (boolean) and subFolder (string) properties
  - Improves type safety and ensures all required FileData properties are validated before parsing

## 1.3.0

### Minor Changes

- 7680657: Expose `toCamelCase` and `camelcaseKeys` utilities in the public core API.

## 1.2.0

### Minor Changes

- e135baa: Improve `initThree` stability, correctness, and UX

  **Bug fixes:**
  - Fix canvas resize flickering — corrected size comparison to use `clientWidth * pixelRatio` instead of raw buffer dimensions, set `setSize(..., true)` consistently on both init and resize, and raised debounce to 100ms so the layout settles before re-rendering
  - Fix `createCamera` querying `document.querySelector('canvas')` (wrong canvas on multi-canvas pages) — now receives the correct canvas element directly
  - Fix `enableZoom: false` and `enablePan: false` being silently ignored due to `|| true` fallback — changed to `??`
  - Fix `autoRotate` having no effect when `enableDamping` was false — `controls.update()` now also runs when `autoRotate` is on
  - Fix HDR load-error handler adding a duplicate ambient light on top of the one already added by `setupLighting`
  - Remove dead code in `createScene` that iterated and mutated `scene.children` on a brand-new empty scene

  **New feature:**
  - Add smooth animated camera zoom on double-click via `animateCameraTo` (ease-out cubic, 200ms). Controlled by new `events.enableDoubleClickZoom` option (default `true`) and accompanied by an optional `events.onMeshDoubleClicked` callback

## 1.1.4

### Patch Changes

- c7d91be: Add Color input parameter type support for Grasshopper definitions. Color inputs are now properly parsed and normalized as RGB strings (e.g., "166, 111, 111"), with surrounding quotes removed during processing.

## 1.1.3

### Patch Changes

- a329571: Fix responsive resize handling and deprecated HDR loader in Three.js viewer initializer
  - Replace `setTimeout(fn, 16)` throttle with a double-rAF (requestAnimationFrame) pattern for post-layout resize measurements. This ensures `clientWidth`/`clientHeight` are read only after the browser has fully committed the new layout, fixing incorrect canvas dimensions during mobile fullscreen transitions.
  - Fix `rafId` type from `NodeJS.Timeout` to `number | null`, which is the correct browser return type for `requestAnimationFrame`.
  - Switch `ResizeObserver` target from `parent`-only to an exclusive parent-or-canvas strategy: when a parent container exists it is observed (no feedback loop risk); when no parent is present (fullscreen / `position:fixed`) the canvas itself is observed. This avoids the redundant observer callbacks that were triggered by `renderer.setSize()` mutating canvas attributes when both elements were observed simultaneously.
  - Replace deprecated `RGBELoader` with `HDRLoader` to resolve Three.js deprecation warning.
  - Update dependencies to latest compatible versions.

## 1.1.3-beta.0

### Patch Changes

- Fix responsive resize handling and deprecated HDR loader in Three.js viewer initializer
  - Replace `setTimeout(fn, 16)` throttle with a double-rAF (requestAnimationFrame) pattern for post-layout resize measurements. This ensures `clientWidth`/`clientHeight` are read only after the browser has fully committed the new layout, fixing incorrect canvas dimensions during mobile fullscreen transitions.
  - Fix `rafId` type from `NodeJS.Timeout` to `number | null`, which is the correct browser return type for `requestAnimationFrame`.
  - Switch `ResizeObserver` target from `parent`-only to an exclusive parent-or-canvas strategy: when a parent container exists it is observed (no feedback loop risk); when no parent is present (fullscreen / `position:fixed`) the canvas itself is observed. This avoids the redundant observer callbacks that were triggered by `renderer.setSize()` mutating canvas attributes when both elements were observed simultaneously.
  - Replace deprecated `RGBELoader` with `HDRLoader` to resolve Three.js deprecation warning.
  - Update dependencies to latest compatible versions.

## 1.1.2

### Patch Changes

- 789287a: Documentation and code quality improvements:
  - Fixed README.md spelling and grammar throughout
  - Restructured sections for better clarity and readability
  - Added comprehensive "Why this project exists" section with bullet points
  - Improved Acknowledgement section with proper formatting and links
  - Updated Requirements section with clear setup instructions for both standard and enhanced setup
  - Refactored error handling system:
    - Moved ValidationErrors factory methods to RhinoComputeError static methods for simpler API
    - Removed unused error factory classes (InputErrors, DataErrors, ConfigErrors)
    - Updated all callsites to use new simplified error creation pattern
  - Added implementation requirements documentation to GrasshopperResponseProcessor:
    - extractMeshesFromResponse requires Selva Display component and custom VektorNode compute
    - getFileData requires Block to File, Geometry To File components and custom compute
  - Added context-specific README files:
    - src/features/file-handling/README.md with setup workflow
    - src/features/visualization/webdisplay/Readme.md with usage instructions
  - Improved compute-fetch documentation with clearer API explanations
  - Removed unused error-factory.ts file
  - Cleaned up unused imports across the codebase

## 1.1.1

### Patch Changes

- 58e5a24: Refactor visualization helpers: fix bounding box calculation, optimize shadow camera bounds, and externalize camera configuration constants.

## 1.1.0

### Minor Changes

- dac3245: Changed file types from PascalCase to camelCase

## 1.0.1

### Patch Changes

- c0ae495: Updated some naming issues

## Unreleased

### Major Changes

- **Node.js 20+ requirement**: Updated minimum Node.js version from 16 to 20.0.0 for better performance and modern API support

### Minor Changes

- **Structured logging system**: Added configurable logger with `setLogger()`, `getLogger()`, and `enableDebugLogging()` APIs
  - Libraries no longer pollute console by default (NoOp logger)
  - Users can enable console logging via `enableDebugLogging()` or integrate custom loggers (Winston, Pino, Sentry, etc.)
  - Replaced all 37 `console.*` calls throughout codebase with structured logging
  - Supports log levels: `debug`, `info`, `warn`, `error`

- **Three.js decoupling**: Mesh processing now uses dynamic imports for Three.js dependencies
  - `extractMeshesFromResponse()` is now async and lazy-loads Three.js only when needed
  - Reduces bundle size for users who don't use visualization features
  - No breaking changes - function signature remains compatible

- **Browser environment guards**: Added runtime checks for browser-only APIs
  - File handling functions now throw `RhinoComputeError` with `BROWSER_ONLY` error code when used in Node.js
  - Prevents cryptic runtime errors when accidentally using browser APIs server-side

### Patch Changes

- **Improved base64 encoding**: Replaced `btoa`/`atob` with Node.js Buffer API
  - More reliable for Node.js 20+ environments
  - Added `encodeStringToBase64()`, `decodeBase64ToString()`, and `isBase64()` utilities
  - Proper error handling with `ENCODING_ERROR` error code

- **Error standardization**: Enhanced error handling across modules
  - Added new error codes: `BROWSER_ONLY`, `ENVIRONMENT_ERROR`, `ENCODING_ERROR`
  - Consistent use of `RhinoComputeError` with proper error codes
  - Better error messages with context (e.g., original error preserved in `originalError` property)

- **Test coverage improvements**: Added baseline test files for previously untested modules
  - `solve.test.ts`: Grasshopper solve function tests
  - `batch-parser.test.ts`: Mesh batch parsing tests
  - `webdisplay-parser.test.ts`: WebDisplay parsing tests

## 1.2.0

### Minor Changes

- cd6ad4b: ## Features

  ### Mesh Selection and Metadata System
  - **Added optional mesh click event handlers** with configurable selection highlighting
    - `onMeshMetadataClicked`: Callback fired when a mesh with metadata is clicked, returns metadata object
    - `onObjectSelected`: Callback fired when any mesh is selected, returns Three.js object
    - `onBackgroundClicked`: Callback fired when background is clicked
  - **Configurable selection color** (`selectionColor` option) - defaults to red (#ff0000), supports any CSS color or THREE.Color
  - **Material cloning on selection** - only selected mesh is highlighted without affecting other meshes sharing the same material

  ### Event Handlers Configuration
  - **`enableEventHandlers`** - Master switch to enable/disable all event listeners (defaults to true)
  - **`enableClickToFocus`** - Individual control for click-to-focus behavior
  - **`enableKeyboardControls`** - Individual control for keyboard shortcuts (F, Space, ESC)

  ### Type Safety Improvements
  - **Proper type exposure for viewer options**
    - `ProcessMeshBatchesOptions` interface for mesh batch processing
    - `EventConfig` type for all event-related options
    - `ModelUnit` type derived from valid SCALE_FACTORS keys
  - **Removed unused `any` types** in ViewerState - now properly typed with THREE.Scene, THREE.PerspectiveCamera, and OrbitControls
  - **Proper re-exports** from `@selva/shared` for convenience access to core visualization functions

  ## Breaking Changes
  - **Removed wrapper functions** from `@selva/shared`:
    - `initializeViewerScene()` - use `initThree()` directly
    - `updateViewerScene()` - use `updateScene()` directly
    - `processMeshBatches()` - use `parseMeshBatchObject()` in a loop directly

    These were thin wrappers that added minimal value. Direct access to core functions is more flexible and easier to understand.

  ## Architecture
  - **Cleaner abstraction layers** - `@selva/shared` now serves as a convenience re-export layer rather than adding unnecessary wrapper logic
  - **Metadata already attached during batch parsing** - no additional processing needed; metadata is preserved in mesh.userData
  - **Event system is optional** - can be completely disabled with `enableEventHandlers: false` for performance-critical scenarios

  ## Migration Guide

  If you were using the wrapper functions from `@selva/shared`:

  **Before:**

  ```typescript
  import { initializeViewerScene, updateViewerScene, processMeshBatches } from '@selva/shared';

  const state = await initializeViewerScene(canvas, schema);
  await updateViewerScene(state, meshes);
  const meshes = await processMeshBatches(batches, options);
  ```

  **After:**

  ```typescript
  import {
  	initThree,
  	updateScene,
  	parseMeshBatchObject,
  	SCALE_FACTORS
  } from 'selva-compute/visualization';

  const { scene, camera, controls } = initThree(canvas, options);
  updateScene(scene, meshes, camera, controls, initialized);
  const meshes = await parseMeshBatchObject(batch, options);
  ```

  The core functions are still re-exported from `@selva/shared` for convenience, but calling them directly from `selva-compute/visualization` is recommended.

## 1.1.0

### Minor Changes

- **File Handling & Import**
  - Add comprehensive file import functionality supporting 3dm, STEP, IGES, DXF, DWG, OBJ, FBX, and GLB formats
  - Implement file upload validation with configurable size limits
  - Add file handling utilities for browser and Node.js environments

  **Grasshopper Client Improvements**
  - Update `fetchRhinoCompute` argument types for improved flexibility
  - Enhance data tree parsing and serialization
  - Improve error handling and response processing

  **Code Quality**
  - Add comprehensive unit tests for input parsers (boolean, numeric, text)
  - Refactor code structure for improved readability
  - Simplify exception handling patterns
  - Add detailed README documentation for core features
