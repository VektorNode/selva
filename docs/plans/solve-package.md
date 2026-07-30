# `@selvajs/solve` — one owner for the solve flow

> **Status: Phases 0–1 DONE (2026-07-30); Phases 2–6 not started.** Supersedes the open
> items in [visualization-standalone](./visualization-standalone.md) — §1–§4 **landed** (its §3 chose
> option 3a), and §5/§6 are absorbed here. Scope: extract the client-side solve orchestration out of
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

**Cross-validated 2026-07-30** (independent check, not the implementer's own report):

- Zero `@selvajs/compute` **imports** in `src/` or `tests/`. The 9 remaining textual hits are all
  comments/docs explaining why something is local — no code path.
- `shared/errors.ts` uses **identical code string values** (`VALIDATION_ERROR`, `INVALID_STATE`,
  `ENVIRONMENT_ERROR`) to compute's, so existing `catch` sites matching on `code` still match.
- §3's assignability claim holds under scrutiny — the risky one. Viz declares `modelunits: string`
  non-optionally; compute's `GrasshopperComputeResponse` has `modelunits: RhinoModelUnit`, a string
  union, which is assignable. All three consumers type-check unchanged.
- `pnpm build` (13), `pnpm check` (14), `pnpm test` (20) green; viz's **425 tests pass on a forced
  uncached run**.

Two things the implementation got **better** than this plan specified, recorded so they aren't
"corrected" later:

- **§4 copied only `decodeBase64ToBinary`**, not the other eight exports in compute's encoding module
  (`encodeStringToBase64`, `detectBase64Payload`, `base64ByteArray`, `utf8ByteLength`, …). Copying the
  whole file would have been the easy mistake.
- **The logger defaults to no-op, not `console`.** The §1 text below says "defaulting to `console`… no
  behaviour change" — that was **wrong**: compute's default is a `NoOpLogger`, so a `console` default
  would have introduced new output wherever no sink is set. The implementation matches compute.

**Carried into Phase 2:** `pnpm lint` in viz reports **5 warnings, all inside `session/`** (2
`no-explicit-any` — including `SolveResult.meshes`, which [§C1](#c1-solveresultmeshes-must-stay-opaque)
fixes — and 3 `console.debug` in `compute-throttle.ts` / `drivers/request-response.ts`). Pre-existing
and untouched by §1–§4. They travel with the files; clear them so `@selvajs/solve` starts clean.

### Phase 1 — scaffold + `shared/` — ✅ DONE 2026-07-30

New `packages/solve` (package.json, tsconfig, tsup, eslint, vitest), mirroring `packages/visualization`.
Sub-path exports only — see [§4](#phase-4--enforce-the-clientserver-boundary) on the root barrel.
Move `solve-fn.ts` into `shared/` and **collapse the duplicate input type**: `PipelineInput` and
`SolveInput` become one exported type.

**As landed:**

- `@selvajs/solve@0.1.0`, exporting **only `./shared`** — no `.` root export, and `tsup.config.ts`
  carries the comment saying why, so the Phase 4 decision is enforced from the first commit rather
  than retrofitted onto a barrel that already exists.
- `shared/solve-fn.ts` — `SolveResult<TMesh = unknown>` and `SolveFn<TMesh = unknown>`. **[§C1](#c1-solveresultmeshes-must-stay-opaque)
  is applied here, in Phase 1 rather than Phase 2**, because the type moved in this phase and typing
  it `any[]` first only to re-narrow it later would put the leak in the published surface for one
  phase. The memo's injected clone/dispose policy is still Phase 2 — only the type moved.
- `shared/solve-input.ts` — one `SolveInput`, replacing the two identical declarations.
- Only dependency is `@selvajs/schemas` (per open question 2). No `three`, no `@selvajs/compute`, no
  `@selvajs/platform`.

**Nothing was deleted.** `@selvajs/visualization/session/solve-fn.ts` and the pipeline's
`PipelineInput` are still in place and still the ones in use — Phases 2 and 3 repoint their
consumers. Phase 1 is purely additive, so `pnpm build` (14) / `check` (14) / `test` (21) stay green
with no consumer touched.

**Two things worth recording:**

- **Root ESLint already covers the new package** — verified by probe, not assumed. `compute` and
  `visualization` are excluded from the root run and delegated to their own `lint` scripts because
  they have their own tsconfig roots; `solve` is not excluded, so adding it to the root `lint`
  script's filter chain would double-lint it. The package keeps its own `eslint.config.mjs` for
  lint-staged and for the Phase 4 `no-restricted-imports` rules to live in.
- **`vitest run` does not typecheck test files.** `shared/` is types-only, so its 6 tests are
  `expectTypeOf` assertions — which vitest happily runs green even when the assertion itself is a
  type error. They are covered because `src/**` is in tsconfig `include` and `pnpm build` runs
  `type-check` first. Verified both directions: widening `meshes` back to `any[]` fails the
  typecheck, and a genuinely broken assertion was caught by `tsc`, not by `vitest`.

### Phase 2 — `client/`

Move the 9 session files + 55 tests. Apply C2, and the **remaining half of C1** — the opaque
`SolveResult<TMesh>` type landed in Phase 1, so what is left here is the memo's injected
clone/dispose policy and deleting viz's now-duplicate `solve-fn.ts`. `@selvajs/visualization/session` is deleted;
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

### Phase 5 — consolidate stable-input hashing

_(Was numbered "3b" — renumbered, because it must run **after** both halves are in place. Doing it
before Phase 3 would mean merging three hashes across three packages and then relocating two of
them: the same merge done twice, the second time against a moved tree.)_

Small, and it removes a class of silent bug. Three implementations of the same idea, free to disagree:

| Where                             | Hash                              | Keyed over                     |
| --------------------------------- | --------------------------------- | ------------------------------ |
| `stableInputKey` (M2, browser)    | sorted-key JSON serialization     | raw input values               |
| `solve-cache-key.ts` (L2, server) | SHA-256 over a canonical preimage | **transformed** input tree     |
| `stable-hash.ts` (L1, compute)    | 32-bit FNV                        | scheduler's own solve identity |

A cache keyed inconsistently doesn't throw — it silently never hits, or hits when it shouldn't.

**Informed by [caching-audit-2026-07](./caching-audit-2026-07.md) §F2**, which found a fourth
inconsistency worth reconciling deliberately rather than merging blindly: **single-flight coalesces on
the raw `{inputs, values}` while L2 keys on the transformed tree.** So two inputs that are
raw-different but transform-identical coalesce as separate flights, then both hit the same L2 key.

Two things must **not** be flattened away:

- **L1 keeps its 32-bit FNV.** Deliberate — fine for a 20-entry in-process Map, and it stays in
  `compute` per [§C1b](#c1b-the-schedulers-l1-cache-stays-in-selvajscompute).
- **L2 keeps SHA-256 plus the re-verified `inputHash` envelope field.** `solve-cache-key.ts:4-7`
  records that a collision serving one user's geometry to another **already shipped once**. Key
  strength scales with blast radius on purpose; this phase unifies the _derivation_, not the strength.

Realistic target: one canonical **canonicalization + preimage** helper in `solve/shared`, with each
tier choosing its own digest. Verify before merging; don't assume the three are interchangeable.

### Phase 6 — verify

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

## Naming: why `solve`

Settled 2026-07-30 after checking what the codebase already calls this concept. Recorded because
renaming a published package is expensive and the question will recur.

**The vocabulary already exists and is consistent** (occurrences across `src/` and `docs/`):

| Term             | Uses |
| ---------------- | ---- |
| "solve session"  | 23   |
| "solve path"     | 18   |
| "solve flow"     | 9    |
| "solve pipeline" | 8    |
| "solve core"     | 4    |

**"Solve" is already this project's noun for the thing** — and notably _not_ "compute", which is
reserved for Rhino.Compute, the external service. That split is already enforced in the prose: a
**solve** is the operation, **compute** is the machine that performs it.

**Rejected — `coordinator`.** `coordinate`/`coordinates` appears 37 times in `src/`, and **every
occurrence is geometry** (coordinate frames and systems, plus
`visualization/src/shared/coordinate-frame.ts`). In a CAD repo, a package named `coordinator` would
collide with one of the most overloaded words in the domain — grepping `coordinate` would return both
meanings mixed together.

**Rejected — `orchestrator`.** No collision, but it names _how the code behaves_ rather than _what it
owns_, it's generic infra vocabulary, and it's long enough to read as noise at every import site
(`@selvajs/orchestrator/client`).

**Rejected — `solve-flow`.** Maximally distinct from `compute` and matches this plan's own charter
sentence, but hyphenated, longer, and the extra word earns nothing once `solve` is established as
unambiguous.

**On the compute/solve proximity worry** (this plan's original open question 1): **overstated.** The
two are not near-synonyms here; they already carry a consistent split, so "which do I import?" has a
crisp answer — _do you need to speak to a Rhino.Compute server, or run a solve?_ The confusing case
would be two packages both plausibly owning one job, which is not the situation.

```ts
import { createSolveSession } from '@selvajs/solve/client';
import { runSolvePipeline } from '@selvajs/solve/server';
```

### The rename that IS worth doing — inside the package

**`SolveSession` is the misnomer, not the package name.** With 23 uses it is the most entrenched term
in the codebase, and it oversells the object: there is no connection, no lifecycle, no session — it is
a **schema-driven form state machine** (seed defaults from a `UISchema`, decide auto-vs-manual solve,
track dirty flags, project values to inputs).

Its own docblock gives it away: "a framework-free shell over the pure transition logic." That is a
controller, not a session. ShapeDiver's `session` genuinely is a connection object, which is likely
where the borrowed name came from.

**Candidate for Phase 2** (`SolveController`, or `SchemaForm` if the form framing wins), deliberately
kept **separate from the package name** and **optional**:

- It touches 23 sites plus the **published** API: `createSolveSession`, `SolveSession` and
  `SolveSessionArgs` are all re-exported from both `@selvajs/ui` (`lib/index.ts`) and
  `@selvajs/ui/public`. Verified 2026-07-30: **Parafa does not import them** (it reaches the session
  only through `ComputeApp`, as this plan assumes elsewhere) — but `plugin-ui` imports
  `createSolveSession`, `SolveSession` and `SolveReporter` **by name from `@selvajs/ui`**
  (`usePreviewState.svelte.ts:9`), so the rename is not free even in-repo, and it is still a breaking
  change to a published surface for any consumer outside these two repos.
- Phase 2 is already moving these files and applying [§C1](#c1-solveresultmeshes-must-stay-opaque) and
  [§C2](#c2-createcomputethrottle-is-misnamed). A third simultaneous change to the same files raises
  review risk for a cosmetic gain.

**Recommendation: do it as its own change after Phase 2 lands**, with a deprecated alias export, or
skip it. The name is wrong but it is not costing anything today — unlike
[§C2](#c2-createcomputethrottle-is-misnamed)'s `createComputeThrottle`, which actively misleads about
where the code belongs.

## Relationship to the caching work

Two threads opened on 2026-07-30 — this extraction, and
[caching-audit-2026-07](./caching-audit-2026-07.md). **Settled: this plan runs first, and they never
overlap.**

The ordering is forced by the code, not preference. The caching unification target is one canonical
hash, and **two of the three implementations move packages during this plan** (M2 from
`visualization/session` → `solve/client`; L2's key from `server/compute` → `solve/server`). Doing
caching first means doing that merge twice. After Phase 3 the two land in the _same_ package with a
`shared/` folder that exists to hold exactly this — the merge becomes local.

They must also not run **concurrently**: `solve-memo.ts` is where both
[§C1](#c1-solveresultmeshes-must-stay-opaque) (opaque `SolveResult<TMesh>`) and the hash unification
land. A move plus a semantic change to one file is how you get a merge that type-checks and keys
wrongly — and caches fail silently.

Scope note, since "unify the caching" is ambiguous: this means **M2 + L2 share one key derivation**.
The GPU caches (geometry, texture, edges) are untouched by either thread — they hold live GPU buffers
and stay in `visualization`. L1 stays in `compute`
([§C1b](#c1b-the-schedulers-l1-cache-stays-in-selvajscompute)).

**Audit item F1 is independent of both** and is the only one that might be a live bug rather than a
refactor: the edge line-geometry cache assumes identity caches never hit across solves, but the
geometry cache now returns the same `BufferGeometry` instance across solves, so those entries may
survive in a cache with no size bound. Measuring it is ~an hour (instrument the entry count, scrub a
slider through many solves, watch for a plateau) and is worth doing **before** this plan starts, so an
unbounded-growth question isn't sitting open across a large refactor.

## Open questions

1. **Package name** — ~~decide before Phase 1.~~ **SETTLED 2026-07-30: keep `@selvajs/solve`.** See
   [Naming](#naming-why-solve) below for the vocabulary counts that settled it.
2. **Does `client/` keep `@selvajs/schemas`?** Yes, necessarily — the form state machine is
   schema-driven (`UISchema`, `getDefaultValue`, `getInputItems`). Noting it so the dep isn't read as
   a leak later. It also means viz becomes fully dependency-free only once `session/` leaves.
3. **Is the honest minimal alternative the right call?** ~~Decide before Phase 3.~~ **Leaning no —
   take the full plan**, on evidence gathered after this plan was written: Parafa is a real second
   consumer that hand-wrote its own solve coordinator and paid for it with a poisoned-cache bug, and
   its `onSolve` is a documented strip-port of Selva's. The minimal alternative (session → `@selvajs/ui`)
   fixes the viz scope problem but leaves that duplication in place. **Still revisit if Phase 2 lands
   and the apps don't get simpler** — that was the stated falsification condition and it holds.
4. **Was Phase 4's `*.server.ts` naming applied?** A reminder, not a question: it is free, already
   load-bearing in both apps, and easy to forget because it isn't a code change.
