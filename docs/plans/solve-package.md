# `@selvajs/solve` — one owner for the solve flow

> **Status: PLAN, not started.** Supersedes the open items in
> [visualization-standalone](./visualization-standalone.md) (§5/§6 are absorbed here; §1–§4 stay
> there and can land independently). Scope: extract the client-side solve orchestration out of
> `@selvajs/visualization/session` and the server-side solve core out of `@selvajs/server/compute`
> into one package with `client/` and `server/` halves, so the whole "slider moved → solve → result"
> chain has a single owner.
>
> **Not in this plan:** the HTTP/API layer, route handlers, and the CLI. Those are real and
> discussed at the bottom under [Deliberately deferred](#deliberately-deferred), but designing them
> now would be speculative — see [Self-critique](#self-critique-where-this-could-be-over-engineered).

## The problem, stated once

The solve flow is one causal chain scattered across four packages, and **no package owns it**:

```
slider change      @selvajs/ui           (ComputeApp, useSolveSession)
throttle + memo    @selvajs/visualization/session
HTTP call          each app, hand-written  ← Selva and Parafa both wrote this
pipeline + caches  @selvajs/server/compute
Rhino.Compute      @selvajs/compute
parse → render     @selvajs/visualization/{parse,render}
```

Two consequences, both measured rather than assumed:

1. **`session/` is squatting in a rendering package.** It is a schema-driven form state machine
   (seed defaults, auto-vs-manual solve, dirty flags, project values to inputs). It has nothing to do
   with meshes — `meshes` is typed `unknown[]` and passed straight through. Its presence is why
   `@selvajs/visualization` can't be described in one sentence.
2. **The duplication already caused a production bug.** Both Selva and Parafa hand-wrote a solve
   coordinator. Parafa's `solve.server.ts` header records that its hand-rolled version had a
   _"poisoned-empty-result bug F-B [that] persisted until restart"_, fixed only by adopting
   `@selvajs/server/compute`. This is not a tidiness argument.

**Verified before writing this plan** (2026-07-30), because the plan's shape depends on it:

- Parafa's compute route is a **stripped port**, not a divergent implementation — its line 1 says so,
  and the other shared routes name the exact commit (`@ selva@20c4722d`) plus their deviations.
- Both apps already call the same `runSolvePipeline`, receive the same discriminated `SolveOutcome`,
  and map the same five variants to the same status codes.
- `PipelineInput` (Selva) and `SolveInput` (Parafa) are **the same type declared twice**:
  `SchemaInput & { minimum?, maximum?, stepSize? }`.
- Every divergence between the two apps is **authorization/tenancy policy**, never what the
  operation does or returns.

So this is an **extraction**, not a reconciliation. That is what makes it worth doing now.

## Boundaries

### What `@selvajs/solve` owns

**One sentence:** _the solve flow — from an input change to a solve result, on both sides of the
wire, with no transport and no UI._

| Half      | Owns                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `client/` | form state machine, auto/manual solve decision, throttle, result memo (M2), driver interface               |
| `server/` | solve pipeline (tree build → solve → serialize → envelope), L2 cache, single-flight, definition-byte cache |
| `shared/` | `SolveResult`, `SolveOutcome`, input keying, the input type that is currently declared twice               |

### What it must never know

This column is the point — it is what makes a violation reviewable:

- **No UI framework.** No Svelte, no runes, no DOM. (`client/` is a state machine, not a component.)
- **No renderer.** No `three`. `meshes` stays opaque — see [§C1](#c1-solveresultmeshes-must-stay-opaque).
- **No authorization, orgs, projects, or share links.** Those are app policy. The pipeline's existing
  docblock already disclaims them; this plan keeps that promise.
- **No HTTP.** No routes, no status codes, no `Response`. The client half stops at a `SolveFn`; the
  server half stops at a `SolveOutcome`. Mapping either to HTTP is the app's job.
- **`client/` must never import `server/`.** Enforced — see [§4](#phase-4--enforce-the-clientserver-boundary).

### What stays where it is

| Stays in                                                                   | Why                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `@selvajs/compute`                                                         | the Rhino.Compute client + data-tree marshalling. `solve/server` depends on it. |
| `@selvajs/visualization`                                                   | mesh conversion + viewer. Becomes exactly that once `session/` leaves.          |
| `@selvajs/ui`                                                              | `ComputeApp`, `useSolveSession`, `solving.svelte.ts` — the Svelte shells.       |
| `@selvajs/server` (`http`, `logging`, `errors`, `ops`, `tokens`, `access`) | generic web plumbing, nothing to do with solving. **Not touched by this plan.** |
| `@selvajs/platform` / providers                                            | unchanged; the model this plan imitates.                                        |

**Explicitly NOT moving into `solve/`: the GPU caches.** `parse/webdisplay/geometry-cache.ts`,
`parse/webdisplay/texture-cache.ts` and `render/edges/cache.ts` hold live `BufferGeometry` with
resident GPU buffers. They cannot exist without a WebGL context and belong beside the renderer. Only
the _solve-result_ caches (client M2, server L2) move here. Two different things share the word
"cache"; this plan keeps them apart.

## Where a result becomes pixels — the `SolveFn` seam

The plan above says `solve` "stops at a `SolveFn`" and treats that as a clean boundary. It isn't one
yet, and this section says what it actually is. **Read this before Phase 2** — it is the part the
first draft of this plan under-specified.

`onSolve` — the `SolveFn` each app hands to `ComputeApp` — does six things today:

| Step | What                                                           | Belongs to                                |
| ---- | -------------------------------------------------------------- | ----------------------------------------- |
| 1    | cooldown / rate-limit check                                    | app policy                                |
| 2    | `fetch('/api/compute')` + error mapping (401/429/503/non-JSON) | **unowned — duplicated per app**          |
| 3    | `JSON.parse` → `GrasshopperResponseProcessor`                  | `@selvajs/compute` (owns the wire format) |
| 4    | response → `THREE.Object3D[]`                                  | `@selvajs/visualization/parse`            |
| 5    | pull named outputs by schema id                                | `@selvajs/compute`                        |
| 6    | browser-side timing (ttfb / download / parse / mesh)           | app                                       |

It returns `{ outputs, meshes }`; `session.report()` merges it; `Viewer.svelte` renders `meshes`.

**So the seam where `solve` meets `visualization` is inside the app, and that is deliberate.** Two
options were considered:

- **`solve` owns assembly** — it would have to import `visualization/parse`, giving the solve package
  a renderer dependency and forcing a headless CLI solve to drag in the parse layer. **Rejected.**
- **The app owns assembly, and the pieces stay composable** — `solve` stays renderer-free; the app
  remains the assembly point. **Chosen.**

This is why [§C1](#c1-solveresultmeshes-must-stay-opaque) matters beyond type hygiene: opaque
`SolveResult<TMesh>` is precisely what lets the app be the assembly point. The session carries meshes
it never inspects; only the app and the viewer know they are `THREE.Object3D`.

**In scope to shrink, not to absorb.** Step 2 is the same 401/429/503 dance in both apps and is a fair
candidate for a small `client/transport.ts` helper. Steps 3–5 stay with the packages that own those
formats. The line to hold: a transport helper is **something the app may call**, never _the way solves
happen_ — the moment it becomes mandatory we are building the API layer this plan deferred.

Selva spends ~150 lines on steps 1–2 and ~90 on 3–6. Parafa's equivalent is thinner (it extracted
`solveRequest`), which is mild evidence the helper is worth extracting — confirm by diffing the two
before doing it.

## What moves, concretely

Counted 2026-07-30, excluding tests.

**Client half — from `@selvajs/visualization/session` (835 lines, 9 files, 55 tests):**

| File                          | Lines | Note                                                                         |
| ----------------------------- | ----- | ---------------------------------------------------------------------------- |
| `solve-session.ts`            | 197   | state ownership + subscriber set                                             |
| `solve-session-core.ts`       | 122   | pure transition logic                                                        |
| `solve-memo.ts`               | 140   | M2; loses its `three` import — [§C1](#c1-solveresultmeshes-must-stay-opaque) |
| `compute-throttle.ts`         | 122   | **rename** — [§C2](#c2-createcomputethrottle-is-misnamed)                    |
| `external-storage.ts`         | 64    | client-sourced input hydration                                               |
| `solve-fn.ts`                 | 29    | `SolveFn` / `SolveResult` → `shared/`                                        |
| `drivers/driver.ts`           | 30    | `SolveDriver` / `SolveReporter`                                              |
| `drivers/request-response.ts` | 75    | memo + throttle over a `SolveFn`                                             |

**Server half — from `@selvajs/server/compute` (2666 lines, 13 files):**

Moves (the solve core — verified decoupled from the rest):

| File                           | Lines |
| ------------------------------ | ----- |
| `solve-pipeline.ts`            | 662   |
| `client-cache.ts`              | 342   |
| `memory-solve-cache.ts`        | 203   |
| `definition-byte-cache.ts`     | 168   |
| `solve-cache-envelope.ts`      | 98    |
| `solve-cache-key.ts`           | 84    |
| `solve-cache-single-flight.ts` | 72    |
| `transform-input.ts`           | 66    |

**Stays in `@selvajs/server/compute`** — `rate-limit.ts` (204), `safe-url.ts` (219),
`limits.ts` (307), `remote-definition.ts` (157). These are HTTP-request policy, not solve mechanics;
`solve-pipeline.ts` imports none of them (verified). Rate limiting is request admission, and
`safe-url` is an SSRF guard on a URL — neither belongs in a solve coordinator.

**Total: ~2530 lines moved.** No rewrite. No behaviour change except [§C1](#c1-solveresultmeshes-must-stay-opaque)
and [§C2](#c2-createcomputethrottle-is-misnamed), both small and both listed.

## Two design corrections that come with the move

### C1. `SolveResult.meshes` must stay opaque

`solve-memo.ts` is the only `three` import in the client half. Root cause: `SolveResult.meshes` is
`any[]`, and the memo silently reinterprets it as `THREE.Object3D[]` to clone and dispose. Nothing in
the type system holds that seam, which is why it never surfaced as an error.

**Fix:** `SolveResult<TMesh = unknown>` plus an injected clone/dispose policy on the memo:

```ts
createSolveMemo({ clone: cloneSceneObjects, dispose: disposeSceneObjects });
```

The three-specific implementation lives in `@selvajs/visualization` (where the GPU ownership rule
already lives) and is injected by whoever wires a viewer. `@selvajs/solve` then has **no renderer
dependency at all**, which is what makes "no `three`" in the boundary table true rather than
aspirational.

Cost: one options object. This is not speculative generality — it is the minimum needed to keep a
renderer out of the package, and it deletes a documented walk-back (visualization-package correction
15).

### C1b. The scheduler's L1 cache stays in `@selvajs/compute`

Asked and answered 2026-07-30: should `@selvajs/compute`'s cache move here too, leaving compute
stateless? **No.** Recorded because it will be asked again.

`SolveScheduler` holds five interlocking pieces of state, and the cache is one of them:
`cache` (L1 responses — 20 entries / 5-min TTL / byte-budgeted, enabled by the server at
[client-cache.ts:236](../../packages/server/src/compute/client-cache.ts#L236)), `inFlight`,
`fifoQueue`/`pendingForLatestWins`, `serverCacheKeys`, `subscribers`.

Two reasons it can't move:

1. **L1 lookup is coupled to queue admission** — you check the cache before burning a concurrency
   slot, and latest-wins supersession must not serve a stale entry. Extracting it would leave the
   scheduler reaching into another package's cache: worse coupling than today.
2. **`serverCacheKeys` is protocol state, not a performance cache.** It is the learned map of
   definition identity → the Rhino.Compute server's own definition pointer — the client's memory of
   the remote server's cache. That is wire-protocol knowledge, which is exactly compute's charter.
   (The stale-pointer miss / `isDefinitionLoadMiss` bug lived here — protocol handling, not caching
   policy.)

**And the framing needs correcting: `@selvajs/compute` is legitimately stateful.** A client doing
connection reuse, queueing, retry and pointer tracking has to hold state — `client-cache.ts` caches
warm clients precisely _because_ they are expensive to recreate. Statelessness is a virtue for a
parser, not for a client.

### C2. `createComputeThrottle` is misnamed

It is generic over `T`, takes any `(values, signal) => Promise<void>`, and contains no reference to
Rhino.Compute, HTTP, WebSockets, or geometry. Proof it isn't compute-specific: plugin-ui drives it
over a **WebSocket to Grasshopper**. Rename to `createAsyncThrottle`; drop the `[Compute/throttle]`
log prefix. Mechanical.

## Phases

Each phase is independently reviewable and leaves the tree green. Order matters: the cheap
independent work first, the risky boundary last.

### Phase 0 — prerequisite (from the other plan) — ✅ DONE 2026-07-30

Landed [visualization-standalone](./visualization-standalone.md) §1, §2, §4: local logger, local
`VisualizationError`, local `decodeBase64ToBinary`. §3 landed too (option **3a** — the envelope is
declared structurally in `parse/webdisplay/response-envelope.ts`), so **all 15 `@selvajs/compute`
import sites are gone and the dependency is removed from `package.json`**, not just reduced.

`@selvajs/visualization`'s only remaining Selva dependency is `@selvajs/schemas`, confined to
`session/` — i.e. exactly the thing Phase 2 below moves out. When `session/` leaves, viz is
dependency-free apart from `three` / `rhino3dm` / `fflate`.

### Phase 1 — scaffold + `shared/`

New `packages/solve` (package.json, tsconfig, tsup, eslint, vitest), mirroring `packages/visualization`.
Sub-path exports only — see [§4](#phase-4--enforce-the-clientserver-boundary) on the root barrel.
Move `solve-fn.ts` into `shared/` and **collapse the duplicate input type**: `PipelineInput` and
`SolveInput` become one exported type.

### Phase 2 — `client/`

Move the 9 session files + 55 tests. Apply C1 and C2. `@selvajs/visualization/session` is deleted;
`@selvajs/ui` re-exports from the new home so `ComputeApp` and Parafa's `@selvajs/ui` imports keep
working. `useSolveSession.svelte.ts` and `solving.svelte.ts` stay in `@selvajs/ui` — they are the
Svelte binding, and this package is framework-free.

After this phase `@selvajs/visualization` is **mesh conversion + viewer only**, which was the original
goal three plans ago.

### Phase 3 — `server/`

Move the 8 solve-core files. `@selvajs/server/compute` keeps `rate-limit`, `safe-url`, `limits`,
`remote-definition` and re-exports the moved symbols from `@selvajs/solve/server` so its 14 importers
across two repos keep resolving. **Do not break `@selvajs/server/compute`'s public surface in this
phase** — Parafa is on published `@selvajs/server@0.2.1`, and a re-export shim costs nothing.

### Phase 4 — enforce the client/server boundary

`client/` must never pull `server/` (or `@selvajs/platform`, or storage credentials) into a browser
bundle. Three cheap guards, in order of value:

1. **No root barrel.** `@selvajs/solve` exports `./client`, `./server`, `./shared` — and nothing at
   the root. A root barrel re-exporting both halves would defeat every other guard here. One decision
   in `package.json`; the highest-leverage line in the plan.
2. **ESLint `no-restricted-imports`** in the package: files under `src/client/**` may not import
   `../server/*`, `@selvajs/platform`, or `@selvajs/server*`. ~20 lines, instant in-editor feedback,
   uses the ESLint already configured (no new plugin).
3. **One bundle test.** Bundle `dist/client.js` with esbuild and assert no server module or
   `process.env` reference appears. ~30 lines. This is the only check that verifies the _shipped
   artifact_ rather than the source.

Also name server-only modules `*.server.ts`. That is free and already load-bearing in both apps —
SvelteKit hard-fails the build with an import trace if a `.server.ts` module reaches client code, so
consumers get the guard without configuring anything.

### Phase 3b — consolidate stable-input hashing

Small, and it removes a class of silent bug. `solve-cache-key.ts` (server) and `stable-hash.ts`
(compute, staying) both compute a stable identity hash over solve inputs — plus `stableInputKey` in
the client memo, which is a third. Same idea, three implementations, free to disagree: two tiers
keying the same solve differently is a cache that silently never hits, or worse, one that hits wrongly.

One canonical implementation in `solve/shared`, used by M2, L2 and the def-bytes key. `compute` keeps
its own only if the scheduler's key genuinely differs (it hashes for a different purpose — verify
before merging, don't assume).

### Phase 5 — verify

`pnpm build && pnpm check && pnpm test` green. Then **build Parafa against the local packages** —
it is a real second consumer on published versions, and it is the only way to know the re-export
shims hold. Changeset: `major` for `@selvajs/visualization` (loses `/session`), `minor` for
`@selvajs/server` and `@selvajs/ui` (additive re-exports), new package at `0.1.0`.

**Known Parafa breakage, independent of this plan.** Found 2026-07-30 while tracing the seam:
`src/routes/app/solve/[guid]/+page.svelte` still calls
`processor.extractMeshesFromResponse({ parsing: { mergeByMaterial: false } })` — a method the
**visualization-package refactor already removed**. Parafa breaks the moment it takes the new
`@selvajs/compute`, regardless of anything here. Fix is the documented one:

```ts
import { getThreeMeshesFromComputeResponse } from '@selvajs/visualization/parse';
const meshes = await getThreeMeshesFromComputeResponse(processor.response, {
	debug: processor.debug,
	rhino,
	parsing: { mergeByMaterial: false }
});
```

Note Parafa's call passes `mergeByMaterial: false` deliberately ("keep one THREE object per compute
mesh so parts stay individually selectable"), so the option must survive the move — verify it is
still honoured by the standalone parser.

## Self-critique: where this could be over-engineered

Written deliberately, because the brief asked for it.

**Things I removed from this plan after arguing myself out of them:**

- **A `@selvajs/api` package.** Discussed at length and cut. It would need an injected
  auth/tenancy policy to be usable by both apps, and designing that interface before there is a
  second concrete consumer of the _handlers_ (as opposed to the pipeline) is guesswork. Deferred, not
  rejected.
- **Splitting `@selvajs/server` apart / renaming it.** Its nine subfolders are already
  near-completely decoupled (only `providers` reaches into `compute`), and Parafa already consumes it
  as **five independent sub-paths**, never the root barrel. The boundary being sought already exists
  and is in use. Splitting it would break a live consumer to achieve a rename. **Do not do this.**
- **A `@selvajs/session` package.** Zero direct consumers — both apps reach the session only through
  `ComputeApp`. A package existing for architectural symmetry.
- **A repo-wide dependency-boundary lint scheme.** Tempting, and it would encode the whole package
  graph. But it is a separate concern from this extraction, and bundling it here would double the
  plan's size for no gain to the solve flow. Worth doing later, on its own.

**Risks I am not hiding:**

- **`solve-pipeline.ts` is 662 lines** and this plan moves it as-is. Splitting it would be a second
  change mixed into a move; do it after, if ever. Moving it unchanged is what keeps this an
  extraction.
- **Phase 3 touches a package with 14 importers across two repos.** The re-export shim is the whole
  mitigation. If it turns out to be leaky, stop and reconsider rather than pushing through.
- **Two runtimes in one package is a real hazard.** A leak ships server credentials to a browser.
  Phase 4 is not optional ceremony; it is the reason this can be one package instead of two.
- **`@selvajs/solve` is a 5th package in the solve path** (`compute`, `solve`, `visualization`, `ui`,
  app). That is one more hop than today. The justification is that it _replaces_ hand-written
  coordination in every app, not that it adds a layer for neatness. If Phase 2 and 3 land and the apps
  do not get simpler, the premise was wrong.

**The honest minimal alternative:** move `session/` into `@selvajs/ui` (its only consumer), do C1 and
C2, and leave the server side alone. That is a fraction of the work and fixes the
`@selvajs/visualization` scope problem completely. It does **not** fix the duplicated solve
coordination between Selva and Parafa — which is the thing that already produced a bug. Choose this
plan only if that second problem is worth the extra work; otherwise take the alternative and stop.

## Deliberately deferred

- **API/HTTP layer + CLI.** The design constraint discovered while verifying this plan, recorded so
  it isn't rediscovered: the five route families shared by Selva and Parafa (`compute`,
  `compute/schema`, `definitions`, `definitions/[guid]/versions`, `files/[...path]`) diverge **only**
  in authorization/tenancy. Any shared handler layer must take an injected policy, following the
  `platform`/`providers` pattern, or it will be unusable by the second app — exactly the wall that
  made Parafa strip-port rather than reuse. A CLI `solve` needs `@selvajs/solve/server` **without**
  HTTP, which this plan's boundary already allows.
- **Splitting `solve-pipeline.ts`.** After the move, if ever.
- **Repo-wide boundary enforcement.** Its own plan.
- **`server`'s non-solve folders.** Left alone on purpose.

## Open questions

1. **Package name** — `@selvajs/solve` reads well but is close to `@selvajs/compute`, and the
   compute/solve distinction is already the subtlest one in the repo. Worth a moment's thought.
2. **Does `client/` keep `@selvajs/schemas`?** Yes, necessarily — the form state machine is
   schema-driven (`UISchema`, `getDefaultValue`, `getInputItems`). Noting it so the dep isn't read as
   a leak later.
3. **Is the honest minimal alternative above actually the right call?** Decide before Phase 3.
