# @selvajs/ui

## 6.0.0-beta.6

### Minor Changes

- d747039: `onViewerReady` on `<Viewer>` and `<ComputeApp>` hands the live three.js viewer to the host, so an
  app can draw into the same scene the solve renders into — a point cloud, draft lines, annotations —
  and register pointer tools. Return a cleanup function to tear down what you added. Previously the
  viewer handle died inside `onMount` and nothing could reach it.

  `ComputeApp`'s `onReady` also gains `getSession()`, so a host can drive solves from its own state
  (`setValue`/`solve`) and react to results, rather than only pushing values in through `loadValues`.

  The viewer-app types (`ThreeViewer`, `PointerTool`, `ToolRegistry`, `LabelLayer`, …) and the scene
  ownership helpers are re-exported from the public entrypoint so hosts can annotate without adding a
  direct `@selvajs/visualization` dependency.

## 6.0.0-beta.5

### Patch Changes

- a011c5e: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

## 6.0.0-beta.4

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.

## 6.0.0-beta.3

### Patch Changes

- Updated dependencies [5292563]
  - @selvajs/schemas@5.0.0-beta.0

## 6.0.0-beta.2

### Patch Changes

- 9f60b66: Drop the `rhino3dm` dependency. Curves now arrive pre-tessellated from the plugin, so the demo's
  lazy WASM loader is gone and nothing in this package needs it. No public API change — the loader
  lived in `src/demo/`, which is not exported.

  The demo fixture's curve items carried openNURBS blobs that only rhino3dm could decode; they now
  carry `points` baked with the same tessellation, so the demo renders identically.

## 6.0.0-beta.1

### Major Changes

- b9c9d6a: One name, one value, for how long a solve may run. The deadline is now sourced
  from the server and carried unchanged to the browser's `AbortController`, rather
  than each layer keeping its own answer under its own name.

  **Fixed — the client could abort a solve the server would have finished.** The
  throttle defaulted to `60_000` while the server's deadline was `100_000`, so any
  host that embedded `<ComputeApp>` without passing a timeout aborted at 60 s a
  solve the server was still happily running. The user saw a failure for work that
  succeeded. `@selvajs/solve` can't read env, so the fix is to require the value
  rather than guess it — there is no client-side default left to drift.

  **Breaking — the per-solve deadline is now required:**

  - `createAsyncThrottle`: `options.timeout` → **`options.runDeadlineMs`**, required,
    and the options bag itself is no longer optional. The name says what elapses;
    the throttle is generic, so its field is named after a run, not a solve.
  - `createRequestResponseDriver`: `options.timeout` → **`options.solveDeadlineMs`**,
    required.
  - `ComputeApp`: `solveTimeoutMs?` → **`solveDeadlineMs`**, required. Pass the value
    the server enforces; omitting it is now a type error rather than a silent 60 s.
  - `ComputeLimits.maxSolveDurationMs` → **`solveDeadlineMs`**.

  **Renamed — `MAX_SOLVE_DURATION_MS` → `COMPUTE_SOLVE_DEADLINE_MS`.** It joins the
  `COMPUTE_*` namespace every other compute knob already uses, and says what it
  bounds — one solve — instead of a vague "duration". The old name still works for
  one minor version and warns at boot, so no deployment breaks on upgrade.

  **`selva migrate` now rewrites deprecated env keys in your `.env`**, so a tuned
  value survives the shim being dropped later instead of silently reverting to a
  default. Only the key changes — value, comments, ordering and spacing are left
  byte-identical, a commented-out old name is ignored, and the old line is dropped
  outright when the new name is already set. `.env.bak` is written alongside the
  existing backups and restored if the migration rolls back.

  `selva doctor` reports the same deprecations without changing anything, covering
  this rename plus the four that were previously silent
  (`COMPUTE_DEFINITION_BYTE_CACHE_MB`, `COMPUTE_RESPONSE_CACHE_MB`,
  `DEFINITION_CACHE_TTL_MS`, `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE`). The last of those
  is reported but not auto-fixed: its replacement encodes a value
  (`SELVA_FLAG_COMPUTE_DEBUG=verbose`), so migrate won't guess at it.

  Migration: run `selva migrate` to rewrite the env var, and pass `solveDeadlineMs`
  wherever you mount `ComputeApp` or build a driver.

### Minor Changes

- b9c9d6a: Make the reported `SolveResult` reachable from a `ComputeApp` host, so a commit path can pair the
  artifact it persists with the inputs that produced it.

  `source` and `values` travel correctly through the request/response driver's memo, but stopped at the
  session: `applySolveResult` merged `outputs` and discarded the rest, and `ComputeApp`'s only outbound
  seam was `onReady({ loadValues })`. So a host wanting the pair had to capture it inside its own
  `SolveFn` — which a memo hit never calls. Solve A, solve B, scrub back to A: the memo serves A, the
  viewer shows A, and the host commits B's geometry.

  `SolveSession` now exposes `lastResult: RetainedSolveResult | null` — the last reported result minus
  its meshes — and `ComputeApp` hands out `getLastResult()` alongside `loadValues`. Because the session
  fills it in `report()`, a memo hit populates it exactly like a fresh solve.

  Meshes are dropped from the retained slice rather than kept: they are GPU-backed and the viewer
  disposes what it renders on the next scene update, so retaining them would hand out disposed
  instances with no policy governing them. Live meshes stay on `session.meshes`. `rebuild()` nulls
  `lastResult` for the same reason it clears the driver memo; `reportError` deliberately leaves it, as
  the viewer still shows the geometry that produced it.

  `values` remains driver-supplied and absent on push transports (the plugin's WebSocket driver cannot
  attribute an unsolicited frame to a request) — documented on `SolveDriver` and `SolveResult`.

### Patch Changes

- b9c9d6a: Fix a type error in `Viewer.svelte`: its `onMeshMetadataClicked` handler declared its parameter as
  `Record<string, string>`, but the callback receives a Three.js object's `userData`, typed
  `Record<string, unknown>`. Callback parameters are checked contravariantly, so the narrower
  annotation failed to assign and `svelte-check` errored on the package.

  The handler now takes `Record<string, unknown>` and coerces the object name with `String(… ?? '')`
  before falling back to the localized placeholder. Nothing downstream changes shape —
  `hasUsefulMetadata`, `selectedMeshMetadata` and `MeshMetadataDialog` all already accept
  `Record<string, any>`.

- Updated dependencies [b9c9d6a]
- Updated dependencies [b9c9d6a]
  - @selvajs/solve@1.0.0-beta.5

## 6.0.0-beta.0

### Minor Changes

- 8b2c168: The solve session moves out of `@selvajs/visualization` into `@selvajs/solve/client`.

  `@selvajs/visualization` is now **mesh conversion + viewer, and nothing else**. The session was a
  schema-driven form state machine that typed meshes as `unknown` and never inspected one — its
  presence was why the package couldn't be described in a sentence. With it gone the package also
  drops its last Selva dependency (`@selvajs/schemas`), so every sub-path needs only `three`,
  `rhino3dm` and `fflate`.

  **Breaking — `@selvajs/visualization`:**

  - **The `/session` sub-path export is removed.** Import from `@selvajs/solve/client` instead
    (`createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`,
    `createSolveMemo`, `stableInputKey`, the external-input storage helpers, the pure
    `solve-session-core` transitions). `SolveFn`/`SolveResult` come from `@selvajs/solve/shared`.
  - The root barrel no longer re-exports any of the above.
  - `@selvajs/ui` re-exports all of it unchanged, so hosts importing from `@selvajs/ui` or
    `@selvajs/ui/public` need no edit.

  **Renamed — `createComputeThrottle` → `createAsyncThrottle`** (`isComputing` → `isRunning`). It is
  generic over `T`, takes any `(values, signal) => Promise<void>`, and mentions neither Rhino.Compute
  nor HTTP nor geometry — plugin-ui drives it over a WebSocket. The old name said "compute" only
  because of where the file happened to live.

  **Mesh ownership is now injected, not assumed.** `SolveResult<TMesh>` is opaque and the result memo
  no longer imports `three`; the clone/dispose rules are a `MeshPolicy` passed in. The three.js
  implementation is `meshPolicy`, newly exported from `@selvajs/visualization/parse`:

  ```ts
  import { meshPolicy } from '@selvajs/visualization/parse';
  const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
  ```

  `ComputeApp` wires this for you. A custom driver must pass it, or a memo hit will serve geometry the
  viewer already disposed. `createSolveMemo(max)` accordingly becomes
  `createSolveMemo({ max, meshPolicy })`.

  **Fixed while extracting it:** the memo's mesh clone copied `geometry.userData` **by reference**, so
  a cloned geometry shared the cross-solve geometry cache's ownership flag. `clearScene` skips flagged
  geometries (the cache disposes those itself), which meant nothing ever freed the memo's clones. The
  clone now copies `userData` before dropping the flag, and `releaseSceneObjects` refuses to dispose
  genuinely cache-owned geometry.

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

### Patch Changes

- Updated dependencies [53da168]
- Updated dependencies [46327d9]
- Updated dependencies [8b2c168]
- Updated dependencies [49cac15]
- Updated dependencies [46327d9]
- Updated dependencies [49cac15]
- Updated dependencies [7751bd0]
- Updated dependencies [e3c4832]
  - @selvajs/compute@4.0.0-beta.0
  - @selvajs/visualization@1.0.0-beta.0
  - @selvajs/solve@0.2.0-beta.0

## 5.0.1

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

## 5.0.0

### Minor Changes

- aa2abf6: Beta release covering the pre-open-source hardening pass and follow-on work across the app stack:

  - **Audit/erasure**: user-deletion erasure now scrubs `audit_events`, `invites`, and redacts embedded emails from surviving `invite.created` payloads; `solve_metrics` is anonymized rather than cascaded.
  - **Logging**: structured logging via Pino with request-ID correlation, replacing ad hoc console logging across the server.
  - **Caching**: durable L2 solve-result cache with a memory backend, client-side result memoization (LRU), warm-client caching per server, backpressure controls, and definition byte caching; response wire-size tracking feeds caching efficiency metrics.
  - **Definitions**: extracted definitions server slice (`@selvajs/server/definitions`) with schema-version-aware extraction/caching and hardened schema-version parsing/error handling.
  - **Tests**: new e2e core-loop tests against a fake compute server, and per-file test isolation to fix flaky mocks.

- 5077fe9: Adding advanced caching
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

- 594b5ad: Adding advanced caching

### Patch Changes

- a8e1b47: Export two utilities that had no publishable engine home, so downstream apps can share them instead of re-implementing them.

  - `@selvajs/platform` now exports `slugify(name)` alongside `SlugSchema` (in `organizations/schemas.ts`, re-exported from the org and root barrels). It coerces an arbitrary name into the shape `SlugSchema` validates — lowercase, non-alphanumeric runs collapsed to single hyphens, edge hyphens trimmed, capped at 63 chars — but does not itself guarantee validity (an all-symbol name yields `''` and reserved words pass through), so callers must still run the result through `SlugSchema`. The Selva app's private `server/slug.ts` copy is deleted and its six importers repoint to the package.
  - `@selvajs/schemas` now exports `getDefaultValue(paramType)` (the value an input carries when the schema supplies no explicit default), moved from `@selvajs/ui`'s `schema/defaults` so server-side callers can share it without pulling in the UI package. `@selvajs/ui/schema/defaults` keeps working as a thin re-export, so existing UI consumers are unaffected.

## 5.0.0-beta.6

### Minor Changes

- Adding advanced caching

## 5.0.0-beta.5

### Patch Changes

- a8e1b47: Export two utilities that had no publishable engine home, so downstream apps can share them instead of re-implementing them.

  - `@selvajs/platform` now exports `slugify(name)` alongside `SlugSchema` (in `organizations/schemas.ts`, re-exported from the org and root barrels). It coerces an arbitrary name into the shape `SlugSchema` validates — lowercase, non-alphanumeric runs collapsed to single hyphens, edge hyphens trimmed, capped at 63 chars — but does not itself guarantee validity (an all-symbol name yields `''` and reserved words pass through), so callers must still run the result through `SlugSchema`. The Selva app's private `server/slug.ts` copy is deleted and its six importers repoint to the package.
  - `@selvajs/schemas` now exports `getDefaultValue(paramType)` (the value an input carries when the schema supplies no explicit default), moved from `@selvajs/ui`'s `schema/defaults` so server-side callers can share it without pulling in the UI package. `@selvajs/ui/schema/defaults` keeps working as a thin re-export, so existing UI consumers are unaffected.

## 5.0.0-beta.4

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

## 5.0.0-beta.3

### Minor Changes

- aa2abf6: Beta release covering the pre-open-source hardening pass and follow-on work across the app stack:

  - **Audit/erasure**: user-deletion erasure now scrubs `audit_events`, `invites`, and redacts embedded emails from surviving `invite.created` payloads; `solve_metrics` is anonymized rather than cascaded.
  - **Logging**: structured logging via Pino with request-ID correlation, replacing ad hoc console logging across the server.
  - **Caching**: durable L2 solve-result cache with a memory backend, client-side result memoization (LRU), warm-client caching per server, backpressure controls, and definition byte caching; response wire-size tracking feeds caching efficiency metrics.
  - **Definitions**: extracted definitions server slice (`@selvajs/server/definitions`) with schema-version-aware extraction/caching and hardened schema-version parsing/error handling.
  - **Tests**: new e2e core-loop tests against a fake compute server, and per-file test isolation to fix flaky mocks.

## 5.0.0-beta.1

### Minor Changes

- 594b5ad: Adding advanced caching

## 5.0.0-beta.0

### Patch Changes

- Updated dependencies [2673995]
  - @selvajs/schemas@4.7.0-beta.0

## 4.12.5

### Patch Changes

- 1449c8c: Fix a browser freeze (`effect_update_depth_exceeded`) when a dynamic value list's computed options depend on the current selection. Such a definition oscillates — the empty/stale-selection fallback auto-picks a valid option and force-solves, the next solve returns options that exclude that pick, the effect fires again — looping without a fixed point until Svelte's effect scheduler exhausts its update depth and the tab hangs on every solve. The reconciliation effect now caps consecutive system-initiated auto-picks (reset by any real user selection); once the cap is hit it logs a warning naming the input and stops, keeping the empty-value invariant intact. This makes the UI resilient to a definition that can't produce stable value-list options (e.g. one whose upstream errors null out the option source), turning a hard freeze into a bounded warning.

## 4.12.4

### Patch Changes

- 6edd345: A dynamic value list input never dispatches an empty or stale value to solve anymore. The auto-pick fallback had two paths that leaked invalid values into the solve request: a user-cleared selection was honored as empty (but an empty selection is never a valid solve input — there is always at least one option), and the consecutive-auto-pick loop breaker gave up leaving whatever stale value was in place. Every terminal state now resolves to a currently-valid option, so the definition always receives a value it can match.

## 4.12.3

### Patch Changes

- 0815369: Diagnostic logging for the dynamic value list memory investigation: large options-payload parses log size, option count and duration (should fire once per distinct solve result — a storm means memoization is defeated); every system auto-pick on a value list logs itself so a reconciliation loop is visible as a numbered sequence; and the browser solve line includes a JS heap watermark (Chrome) so a retention leak shows as a monotonic climb across a session.
- 0815369: Bound the dynamic value list auto-pick fallback to 3 consecutive system-initiated picks (reset by any real user selection). A definition whose computed options depend on the current selection could oscillate — auto-pick → force-solve → new options invalidate the pick → auto-pick again — force-solving in an unbounded loop that can run the tab out of memory. The fallback now stops with a console warning identifying the input instead of looping.
- 0815369: Memoize dynamic value list payload parsing. In compute mode the options payload arrives as a JSON string — several MB for large option lists — and the options map derives from the live values, recomputing on every value change. Each recompute re-parsed the full string and allocated a fresh options object whose new identity re-rendered the entire dropdown subtree; with a measured 6.4 MB payload this drove the tab out of memory when fast (cached) solve results triggered several recomputes in one frame. Repeated payloads (including identical strings from later solves) now return the same parsed object, so unrelated value changes no longer touch the dropdown at all.

## 4.12.2

### Patch Changes

- 739b1cd: Refine the dynamic value list empty-selection fallback: it now only fills a selection that was never made. A user who deliberately clears the selection (e.g. unchecks every checklist entry) is no longer fought by the auto-fallback re-selecting the first option.
- 739b1cd: Move the solve-request values projection into the solve session itself. The session merges solve outputs into the same values map that inputs live in (so widgets like dynamic value lists can read them), and previously dispatched the whole map to the transport — the Selva app filtered it back down in its own onSolve, but any other app built on `@selvajs/ui` would unknowingly re-upload multi-MB output payloads (a measured 6.4 MB options list) on every solve. `dispatch()` now projects values down to schema-input ids before calling the driver, so every transport — HTTP, WebSocket, or custom — gets input-only values by contract, and the app-level filter is removed as redundant.

## 4.12.1

### Patch Changes

- 0a978ac: Dynamic value list inputs now fall back to the first available option when no selection was ever made (empty string or empty checklist), not only when a previous selection went stale. An empty selection solved as an empty string, cascading through definitions as null-data errors ("File not found", Text→Number conversion failures) and producing geometry-less results that the solve caches then replayed.

## 4.12.0

### Minor Changes

- 2173bef: Add an optional branding logo watermark to the 3D viewer. `Viewer` and `AppLayout` gain a `logoUrl` prop, and `ComputeApp` gains a `logo` prop; when set, the logo renders as a small, non-interactive watermark in the viewer's bottom-right corner (omitted/empty renders nothing). Note: `ComputeApp`'s `logo` now drives this viewer watermark rather than the app header.

## 4.11.0

### Minor Changes

- fd2bb4f: Remove `slotLabel` from client-input slots.

  The optional `source.client.slotLabel` field is dropped from the UI schema and from
  `ClientSlotArgs`. A custom slot still reserves the input's cell and hands it to the
  host's `clientSlot` snippet — the host now derives its own caption (from the input's
  display name / its own knowledge of the producer) instead of an author-set label.

  Non-breaking for existing data: stored schemas that still carry `slotLabel` are
  ignored everywhere (the schema is type-generation only, not runtime-validated; the
  Grasshopper plugin deserializes `source.client` as an opaque object). Hosts that
  read `ClientSlotArgs.slotLabel` should drop that reference.

## 4.10.0

### Minor Changes

- 728a3a6: Add `onValueChange` to `ClientSlotArgs`, letting a client slot commit a value back into the solve session like any built-in widget. Slots can now be interactive controls (e.g. a custom picker), not just display cells.

## 4.9.0

### Minor Changes

- 9d73f8e: Extend multi-language (en/de) support to the compute app shell. `<ComputeApp>` now takes a `lang` prop that provides the UI locale to its whole subtree, so the panel layout, calculate/solving controls, collapsed panel strip, and loading/empty states are localized alongside the viewer.

  Set the language with the `lang` prop on `<ComputeApp>` (or on a standalone `<Viewer>`), or drive it app-wide via the exported `setLocaleContext`. Defaults to English when unset. Schema-authored labels and Grasshopper-sourced names/metadata are not translated.

## 4.8.0

### Minor Changes

- e069192: Add multi-language (en/de) support to the Viewer and its panels. The viewer chrome — tools menu, view presets, scene manager, and metadata dialog — is now localizable. Set the language with the new `lang` prop on `<Viewer>`, or drive it app-wide via the exported `setLocaleContext`. Defaults to English when unset. Grasshopper-sourced names and metadata are not translated.

## 4.7.1

### Patch Changes

- 2d3e963: Expose `Viewer` and its `ViewerConfig` type from the published public API so external applications can embed the standalone 3D viewer directly (driven by a `meshes` array and an optional `viewerConfig`), without going through `ComputeApp`.

## 4.7.0

### Minor Changes

- 2655d2e: Add grid toggle to viewer tools menu. The grid can now be shown/hidden at runtime via a new `showGridToggle` prop (defaults to `true`). Grid starts hidden by default for a cleaner initial viewport. Hidden viewer helper objects (grid, floor, labels, measurement overlay) are now filtered from the scene object list.

### Patch Changes

- fa64d0e: Scene manager now labels line geometry as "Curve" instead of the internal Three.js class name
  (`Line2`/`LineSegments2`), which read as a 2D type. The relabel applies to both the object label
  fallback and the type column.

## 4.7.0-beta.2

### Minor Changes

- 2655d2e: Add grid toggle to viewer tools menu. The grid can now be shown/hidden at runtime via a new `showGridToggle` prop (defaults to `true`). Grid starts hidden by default for a cleaner initial viewport. Hidden viewer helper objects (grid, floor, labels, measurement overlay) are now filtered from the scene object list.

## 4.6.2-beta.1

### Patch Changes

- fa64d0e: Scene manager now labels line geometry as "Curve" instead of the internal Three.js class name
  (`Line2`/`LineSegments2`), which read as a 2D type. The relabel applies to both the object label
  fallback and the type column.

## 4.6.2-beta.0

### Patch Changes

- 8505304: Roll beta prerelease for @selvajs/ui.

## 4.6.1

### Patch Changes

- a196044: Update `@selvajs/compute` peer dependency to 2.0.0.

## 4.6.0

### Minor Changes

- 7db97cb: Support dynamic value lists in the preview runtime, plus a client-side file-size guard.
  - `buildDynamicValueListOptions` now takes the whole `UISchema` (was just `outputs`) and collects every `dynamicValueList` source from both `schema.outputs[]` and the layout. The layout pass is back-compat defense for schemas persisted by an older plugin that did not mirror dynamic outputs into `outputs[]`; for current schemas it finds nothing new. `TabLayout` is updated to pass the schema.
  - `FileInput` now rejects oversize uploads client-side (against `APP_DEFAULTS.FILE_UPLOAD.MAX_SIZE_BYTES`) instead of letting the request fail server-side with an opaque 413, matching the existing URL-import check.

### Patch Changes

- 9ea2137: Fix dev-mode binding warning by removing the redundant two-way binding on `values` in `AppLayout` and `TabLayout`. The `values` object is a `$state` proxy that is only ever mutated in place, so `bind:`/`$bindable()` was unnecessary and produced a "did not declare values as a binding" warning through the `AppShell` → `AppLayout` prop chain.

## 4.5.0

### Minor Changes

- d2f17d9: Surface the Solve Session API and fix the `onLoadValues` callback contract.

  **New public exports.** `createSolveSession`, `createRequestResponseDriver`, and the
  `SolveSession` / `SolveSessionArgs` / `SolveDriver` / `SolveReporter` types are now exported
  from the package root. This lets transports outside the package (e.g. a WebSocket driver)
  satisfy `SolveDriver` and drive a session. See `CONTEXT.md` for the vocabulary.

  **Fix — `AppLayout` `onLoadValues` forwards the loaded values.** Previously the callback
  fired with no argument (and its type was `() => void`), so a host subscribing to a preset
  load received `undefined`. The signature is now
  `onLoadValues?: (values: Record<string, unknown>) => void | Promise<void>` and the loaded
  values are passed through. Additive for callers that ignore the argument.

## 4.4.0

### Minor Changes

- af63f6e: Add shared schema layout-traversal helpers.

  **New — `getGroups` / `getLayoutItems` / `getInputItems`** in `@selvajs/schemas`
  (`src/traversal.ts`). One place that knows how to walk a `UISchema`'s `tabbed`/`flat`
  layout union, replacing the hand-rolled `layout.type === 'tabbed' ? tabs.flatMap(...) :
groups` branch that was duplicated across both packages. Readers are defensive — a
  missing layout or empty groups/items yields an empty result rather than throwing.
  `@selvajs/ui` re-exports all three so existing consumers are unaffected.

  Internally collapsed onto these: `getExternalInputs`, the preset exporter's group walk,
  and (in plugin-ui) `getAllLayoutItems`, `isItemUsedInLayout`, `batchSetNumberWidgetType`.

- b589841: Deepen the compute/footer/visibility internals for testability and locality.

  **New — Solve Session.** `createSolveSession` + a transport-agnostic `SolveDriver` seam
  (with `createRequestResponseDriver`) extract the value/lifecycle state machine out of
  `ComputeApp` into `lib/compute/`. Pure transition logic lives in `solve-session-core.ts`
  (unit-tested); the reactive wrapper is a thin shell. `SolveResult` is now exported from
  the public surface. See `packages/ui/CONTEXT.md` for the vocabulary.

  **New — `buildVisibilityMap` / `itemKey`** in `lib/schema/visibility-rules`: evaluate
  each layout item's visibility once per render instead of repeatedly across `Group` and
  `TabLayout`.

  **Tests.** Added coverage for `createComputeThrottle` (latest-wins, abort-on-retrigger,
  timeout, cancel) — the vitest config now loads the Svelte plugin so `.svelte.ts` rune
  modules run in tests.

  **⚠️ Footer registration API changed (potentially breaking).** `useFooterItem` and
  `FooterStore.register` now take a single typed options object instead of positional
  arguments, and `FooterItem` is generic over its component's props (no more `any`).

  Migrate call sites from:

  ```ts
  useFooterItem('ws-status', WsStatusFooter, () => ({ connected }), 'left', 10);
  ```

  to:

  ```ts
  useFooterItem({
  	id: 'ws-status',
  	component: WsStatusFooter,
  	getProps: () => ({ connected }),
  	position: 'left',
  	priority: 10
  });
  ```

  Released as a minor because the footer registration is used internally; bump to major
  in your own release if an external consumer relies on the old positional signature.

## 4.3.0

### Minor Changes

- 58edad5: Add an optional presentation mode for client-sourced inputs. An input with `source.kind === 'client'` can now set `source.client.presentation` to `'hidden'` (default, prefilled silently) or `'slot'`, where the host app renders its own element in the input's place via a new `clientSlot` snippet on `ComputeApp`. Selva reserves the cell and passes `{ inputId, displayName, slotLabel, value }` to the host snippet without interpreting it — e.g. an "Edit JSON" button that navigates back to a producer page. An optional author-set `slotLabel` is passed through untouched.

## 4.0.0

### Patch Changes

- Updated dependencies [9ded581]
  - @selvajs/schemas@4.0.0

## 3.1.0

### Minor Changes

- e6ec352: Expose customization hooks on `ComputeApp` for embedding the parameter app in external sites.
  - **Pluggable preset persistence**: new optional `onSaveState` / `onListStates` props on `ComputeApp` (threaded through `AppLayout` → `ParameterPresetManager`). When `onSaveState` is set, saving a parameter state calls it instead of downloading a `.sps` file; when `onListStates` is set, the Load dialog lists the returned presets (each routed through the existing validation flow) instead of showing a file input. Both fall back to the file-based behavior when unset, so existing apps are unchanged.
  - **Localizable preset UI**: new optional `presetLabels` prop accepts a `Partial<PresetLabels>` overriding every string in the Save/Load/validation dialogs. `PresetLabels` and `DEFAULT_PRESET_LABELS` are exported from the package root.
  - **Footer text**: new `copyrightName` and `footerText` props. `footerText` fully overrides the footer line with `{name}` / `{year}` substitution; otherwise the default `by {name} © {year}` is used.
  - **Bring-your-own header**: new `header` snippet on `ComputeApp` (and `AppShell`). When provided, it renders inside the standard sticky header bar at the fixed `--header-h` height — so the fixed-mode layout is unaffected — and takes precedence over `headerRight`.

## 3.0.0

### Patch Changes

- Updated dependencies [3e5ebe3]
  - @selvajs/schemas@3.0.0

## 2.0.11

### Patch Changes

- @selvajs/schemas@2.0.11

## 2.0.10

### Patch Changes

- @selvajs/schemas@2.0.10

## 2.0.9

### Patch Changes

- @selvajs/schemas@2.0.9

## 2.0.8

### Patch Changes

- @selvajs/schemas@2.0.8

## 2.0.7

### Patch Changes

- @selvajs/schemas@2.0.7

## 2.0.6

### Patch Changes

- @selvajs/schemas@2.0.6

## 2.0.5

### Patch Changes

- @selvajs/schemas@2.0.5

## 2.0.4

### Patch Changes

- @selvajs/schemas@2.0.4

## 2.0.3

### Patch Changes

- @selvajs/schemas@2.0.3

## 2.0.2

### Patch Changes

- @selvajs/schemas@2.0.2

## 2.0.1

### Patch Changes

- @selvajs/schemas@2.0.1

## 2.0.0

### Patch Changes

- 9cd112b: **v2.0.0 — consolidation release.** All four published packages now share one version, locked in fixed mode.
  - **CLI renamed:** `@selvajs/create` → `@selvajs/cli` (same bins, same behavior, more accurate name).
  - **Providers internalized:** `@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`, and `@selvajs/header-auth-provider` are no longer published. Their code is bundled into `@selvajs/selva`'s build artifact at compile time.
  - **Operator install simplified:** the only packages you install are `@selvajs/selva` (the app) and `@selvajs/cli` (the tool). Everything else is implementation detail.
  - **External UI consumers:** `@selvajs/ui` still publishes alongside `@selvajs/schemas` as a peer dependency for repos that consume the component library directly.

  See [`docs/Hotfix-CLI-Runtime.md`](https://github.com/VektorNode/selva/blob/main/docs/Hotfix-CLI-Runtime.md#migrating-an-existing-deployment-from-selvajscreate) for the one-time migration step on existing deployments.

- Updated dependencies [9cd112b]
  - @selvajs/schemas@2.0.0

## 0.10.0

### Minor Changes

- # 0.10.0

  A broad release covering platform foundations, a new drawing/PDF pipeline, unified drag-and-drop, schema-source-of-truth work, and a new forward-auth provider. Web apps and `@selvajs/ui` are aligned at 0.10.0; library packages move to the next minor in their respective tracks. The Grasshopper plugin ships as 0.10.0 (beta tag dropped).

  ## Apps & UI (`@selvajs/plugin-ui`, `@selvajs/selva`, `@selvajs/ui`)

  ### Plugin-UI
  - Unified drag-and-drop on `svelte-dnd-action` with a thin cross-type coordinator (replaces three coexisting systems).
  - Schema source-of-truth refactor: canonical/draft split, content-hash for safe save, removal of version/edit-intent state, eliminates drift between plugin `_embeddedSchema`, UI state, and localStorage.
  - New components: `ImageUploadField`, `DataTable`, mode toggle, resizable, scroll-area, search, select, separator, slider, sonner, switch, tabs, textarea, theme switcher.
  - `NumberWidgetConfig` gains `hideRange` for UI control.
  - External input handling with a UI toggle for input sources.
  - Resizable-handle styling, grid-item visibility + column positioning, dropzone active-state highlights.
  - Compute throttle + solving indicator; util reorganisation.

  ### Selva
  - Project-owner definition uploads with access-control tests.
  - Project visibility handling tightened in access-control logic.
  - StatCard refactor across project/team pages and updated project navigation.
  - Audit-log functionality with query support and UI integration.
  - API endpoints for managing platform projects and grants; reclaim functionality.
  - Email-link authentication.
  - Compute-server management refactored to support platform and org-private servers; permissions docs clarified for role scopes.

  ### Cross-cutting UI
  - WebSocket connection handling and schema-history management hardened.
  - Schema history + validation improvements.
  - `NotificationManager` interface + implementation for message handling.
  - Primitive imports and layout-structure refactor; component conventions normalised (see plugin-ui `lib/README`).

  ## Drawing system (`Selva.Drawing` + UI)
  - New SVG drawing components, dimensioning, curve creation, and export.
  - `GH_Page`, `GH_PathStyle` improvements; `RhinoViewportVisitor` rendering enhancements.
  - `DrawingView` / `GH_DrawingView` support multiple geometry elements with auto-fit.
  - New table/grid header-style + fill options.
  - Document layout + pagination logic refactor; `GridOverflow` class + `ComputeOverflows` method for multi-page output.
  - New icons and a page-flow plan for multi-page output.

  ## Schemas (`@selvajs/schemas`)
  - Modular Zod-based validation system for `UISchema`.
  - Custom `IGH_Goo` types for `ValueList`, `ThreeMaterial`, `FileData`, `UISchema` with serialization.
  - `SchemaArchiveSerializer` for schema + values archive serialization.

  ## Platform & providers
  - `@selvajs/header-auth-provider` (new): forward-auth via trusted upstream proxy. Identity verification from proxy headers, allowlist management for user entries.
  - `@selvajs/platform`: project-grant store + interfaces; reclaim flow; clearer role scopes.
  - `@selvajs/local-provider`: env-var handling refactor.

  ## Plugin (.NET / Grasshopper)
  - WebSocket message handling and validation overhauled.
  - Document synchronization and schema handling refactor.
  - Robust volatile + persistent parameter-value extraction.
  - Multi-target: net48 + net7.0 (Rhino 8), net9.0 (Rhino 9-wip) with separate `manifest-rh8.yml` / `manifest-rh9.yml`. Rhino 7 is not supported.
  - Grasshopper group import + enhanced grouping options.
  - `BinaryGeometryWriter` for optimized mesh delivery.
  - `ValueApplicator` + `ValueCollector` services replace ad-hoc plumbing in UIBuilder.
  - Install-directory resolution improvements in the update script.

  ## Tooling, infra, docs
  - Turborepo integration: `pnpm build` / `check` / `type-check` / `test` / `generate` orchestrated via turbo with caching (see `docs/Turborepo.md`).
  - New data-directory layout + setup script changes.
  - PM2 deployment: `--env-file` flag via `node_args` (replaces silently-ignored `env_file` on `pm2 start`).
  - `@selvajs/schemas` workspace dependencies normalised to `workspace:*`.
  - Grasshopper example definitions unignored.
  - Added CONTRIBUTING + changelog; TypeScript schema generation pipeline.

### Patch Changes

- Updated dependencies
  - @selvajs/schemas@1.2.0

## 0.9.0

### Minor Changes

- **WebDisplay: Layer input + Scene Manager rewrite**

  **Viewer refactor**
  - `Viewer.svelte` moved to `components/viewer/Viewer.svelte`; `index.ts` export updated accordingly
  - `Viewer` no longer accepts a `schema` prop — background color and feature flags are now passed via `viewerConfig`:
    - `showScreenshotButton`, `showFullscreenButton`, `showSceneManager`, `enableMeshClick`, `backgroundColor`
  - Mobile layout hides the scene manager panel by default (`showSceneManager: false`)

  **Scene Manager — full rewrite**
  - Layer-based grouping: meshes grouped by `userData.layer` (falls back to `userData.category` then `"Default"`)
  - Search bar to filter by layer name or mesh name
  - Collapsible layer groups with chevron toggle
  - Per-object and per-layer visibility toggle; partial-visibility state shown visually
  - Multi-select: `Ctrl+Click` (toggle), `Shift+Click` (range), bulk visibility toggle for selection

  **MeshMetadataDialog — new component**
  - Opens on mesh click; shows custom metadata key/value pairs
  - Filters internal keys (`name`, `layer`, `originalIndex`, `sourceComponentId`) from the table
  - Fullscreen-aware positioning via `data-viewer-fullscreen` attribute

  **Builder**
  - Visibility rules section now renders for both input and output items (was input-only)
  - `VisibilityRulesEditor` receives `isGroupCondition={true}` for output items

## 0.8.4

### Patch Changes

- Refactor: extract solve/state logic into self-contained `ComputeApp` component
  - Add `ComputeApp.svelte` — wraps all solve logic, throttling, solving indicator, definition switching, embed mode, custom primary color, and footer registration into one component
  - Add `showSaveButton`, `showLoadButton`, `stateManagerActions` props to `ComputeApp` and `AppLayout` for flexible state manager configuration
  - Add optional `header` and `children` snippets to `ComputeApp` for custom nav/layout
  - Extract `ActionButton` type to `shared/types/actionButton.ts` and `SolveFn`/`SolveResult` to `shared/types/solveFn.ts`
  - Move `hexToOklch` color utility from compute-app

## 0.8.3

### Minor Changes

- Pin dev dependencies so they resolve correctly in external projects
