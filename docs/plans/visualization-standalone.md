# `@selvajs/visualization` — make it standalone

> **Status: §1–§4 LANDED (2026-07-30). §5 and §6 handed off to
> [solve-package](./solve-package.md).** `@selvajs/visualization` no longer depends on
> `@selvajs/compute` at all — the dependency is gone from `package.json`, and `shared/`, `parse/`,
> `render/` and `scene/` need only `three` / `rhino3dm` / `fflate`.
>
> **What landed:**
>
> | §   | Fix                                                                                        |
> | --- | ------------------------------------------------------------------------------------------ |
> | §1  | `shared/logger.ts` — local `getLogger`/`setLogger`/`enableDebugLogging`, 9 sites rewired   |
> | §2  | `shared/errors.ts` — `VisualizationError` + `ErrorCodes`, replacing `RhinoComputeError`    |
> | §3  | **3a chosen** — `parse/webdisplay/response-envelope.ts` declares the envelope structurally |
> | §4  | `shared/encoding.ts` — `decodeBase64ToBinary` copied from compute                          |
>
> **Decisions taken, with what settled them:**
>
> - **§5 → option C (session stays), deferred to [solve-package](./solve-package.md).** That plan
>   supersedes §5 outright: session moves to `@selvajs/solve/client`, not to `@selvajs/ui` (option A)
>   and not to a `@selvajs/session` package (option B — which that plan explicitly argues against, as
>   a package with zero direct consumers). So viz keeps its `@selvajs/schemas` dep for now, confined
>   to `session/`.
> - **§3 → 3a, not 3b.** Settled by the solve plan's seam table: the app is the assembly point and
>   passes a whole response into `getThreeMeshesFromComputeResponse` (its Parafa fix snippet does
>   exactly that). 3b would have broken the call the other plan depends on. Verified after the fact:
>   all three consumers type-check unchanged, because compute's `GrasshopperComputeResponse` is a
>   structural superset of the local `DisplayComputeResponse`.
> - **Open question 4 → no-op default, not `console`.** The premise in §1 below was wrong: compute's
>   `getLogger` defaults to a **NoOpLogger**, not the console. Defaulting to `console` would have been
>   a behaviour change (new console output wherever no sink is set), not the "no behaviour change" §1
>   claimed. `enableDebugLogging()` is one call away.
>
> **Open question 1 (headless solve)** no longer blocks anything — the solve plan's boundary gives a
> headless CLI solve `@selvajs/solve/server` without HTTP, so it does not hinge on where `session/`
> lands. **Open question 3 (publish standalone?)** is moot for §3 now that 3a broke no API.
>
> Original discussion follows, unedited.

> **Status: OPEN — discussion, nothing implemented.** Follow-on to
> [visualization-package](./visualization-package.md) (COMPLETE, all 8 steps landed). That plan moved
> the five layers into one package but left the package's _external_ dependencies untouched: it still
> hard-depends on `@selvajs/compute` **and** `@selvajs/schemas`, both as real `dependencies`. So
> `npm i @selvajs/visualization` today drags in the Rhino.Compute client and Selva's schema package.
>
> **The requirement driving this doc** (stated 2026-07-30): the package should do exactly two things —
> **mesh conversion (binary → JS)** and **the viewer pipeline** — and should be usable on its own by
> someone who has neither Selva nor Rhino.Compute.
>
> **One open decision blocks the rest: where `session/` goes.** See [§5](#5-open-decision-where-does-session-go).

## Why the previous plan didn't cover this

Not an oversight — a scope boundary that the new requirement moves. The old plan's principle 2 was
about the _internal_ direction (`session → scene → render → parse → shared`, downward only), and
correction 3 explicitly settled the external edge as "the dependency direction is viz → compute, so
compute can never import viz." That was coherent: viz was allowed to lean on compute freely.

Standalone-ness makes that edge the problem rather than the solution. Two decisions recorded in the
old plan were _correct under its assumptions_ and are now invalidated:

- **`shared/errors.ts` was deliberately NOT created** — "`RhinoComputeError`/`ErrorCodes` are imported
  from `@selvajs/compute` directly. A re-export would be indirection with no added behaviour."
  Under the standalone requirement it isn't indirection; it's the thing that cuts the dep.
- **`decodeBase64ToBinary` was moved _to_ compute's root export** for viz's benefit (changeset,
  breaking-changes section). That's the wrong direction now.

## The blockers

Current external imports, counted 2026-07-30 (excludes `__tests__`):

| Dep                | Sites | Layers                      | Verdict                |
| ------------------ | ----- | --------------------------- | ---------------------- |
| `@selvajs/compute` | 15    | `parse`, `render`, `shared` | All removable — §1–§4  |
| `@selvajs/schemas` | 5     | `session` only              | **Not** removable — §5 |

### 1. `getLogger` — 7 sites, trivial

`parse/{display-items-parser, items/curves, items/points, webdisplay-parser, batch-parser, texture-cache}`,
`render/scene-setup/{setup-environment, setup-events}`, `shared/geometry.ts`.

Used only as `getLogger().warn(...)` / `.debug(...)`. A logging facility, not a compute concern.
**Fix:** a local logger in `shared/logger.ts` with a settable sink defaulting to `console`. No
behaviour change; removes >half the import sites on its own. The host can point it back at compute's
logger in one call, so Selva keeps unified logging.

### 2. `RhinoComputeError` / `ErrorCodes` — ~10 sites, and the name is itself a bug

`parse/webdisplay/{binary-parser, batch-parser, batch/metadata, binary/geometry}`.

A binary mesh parser throwing **RhinoComputeError** for "this blob has bad magic bytes" is wrong on
the project's own terms: in the plugin's WebSocket path the payload never went near Rhino.Compute.
The error names a transport the failure has nothing to do with.

**Fix:** `shared/errors.ts` with a `VisualizationError` carrying the same `code` + `context` shape.
Reverses the old plan's "not created" note (see above). Keep the code values identical
(`VALIDATION_ERROR`, `INVALID_STATE`, `ENVIRONMENT_ERROR`) so existing catch-sites keep matching.

### 3. `GrasshopperComputeResponse` / `DataItem` — the only genuine coupling

[webdisplay-parser.ts:10](../../packages/visualization/src/parse/webdisplay/webdisplay-parser.ts#L10),
used at lines 114, 176, 184, 200 — walking `InnerTree` and its branches.

This is the one place viz knows the Rhino.Compute **wire envelope**. Note the split already present:
`binary-parser` and `batch-parser` eat bytes and are format-agnostic; only the outer envelope walk is
Grasshopper-shaped. That matches the stated scope — "only the mesh conversion from binary mesh to JS"
does not include unwrapping a Grasshopper response.

**Fix — two options, undecided:**

- **3a. Declare the envelope structurally in viz.** A local minimal `interface` for the shape actually
  read (`values[].InnerTree[branch][]`). Cheap, keeps `getThreeMeshesFromComputeResponse` working as-is
  for Selva. Cost: the shape is duplicated, and drift with compute's type is silent.
- **3b. Move the envelope walk out to the caller.** Viz exposes only "here are bytes/base64 → here are
  meshes"; whoever holds the Grasshopper response extracts the blobs. Truest to the stated scope and
  no duplication, but a breaking API change for a function the changeset _just_ published as the entry
  point, and it pushes work into both `@selvajs/ui` and `plugin-ui`.

### 4. `decodeBase64ToBinary` — 1 site, copy it

[binary/geometry.ts:3](../../packages/visualization/src/parse/webdisplay/binary/geometry.ts#L3). ~20
lines. Its forgiving-base64 normalization + Node pool-slab copy are subtle enough that the changeset
called them out as reason not to duplicate — but that reasoning assumed the dep was free. **Fix:**
copy into `shared/`, with a comment pointing at compute's copy as the origin. Duplication of 20 stable
lines is cheaper than the package dep it buys.

### 5. Open decision: where does `session/` go?

**This is the one that needs a call.** Unlike §1–§4, this dep is not accidental. All 5 `@selvajs/schemas`
imports are in `session/` (`UISchema`, `getDefaultValue`, `getInputItems`), and the session's job _is_
projecting a Selva UI schema into solve inputs. It cannot be made schema-free without gutting it.

So standalone-ness lands differently per layer:

| Layer                                | Standalone after §1–§4?                   |
| ------------------------------------ | ----------------------------------------- |
| `shared`, `parse`, `render`, `scene` | **Yes** — needs only `three` / `rhino3dm` |
| `session`                            | **No** — inherently Selva-schema-shaped   |

Note the stated scope ("mesh conversion" + "viewer pipeline") **doesn't mention session at all**.

#### Options

- **A. Session → `@selvajs/ui`** (as a `session` sub-path). It already depends on `@selvajs/schemas`,
  and its only real binding, `useSolveSession.svelte.ts`, already lives there. Viz becomes exactly the
  stated scope, no new package. _Cost:_ headless solving now requires `@selvajs/ui` (a Svelte package)
  — kills the headless story unless ui's sub-path stays framework-free in practice.
- **B. Session → `@selvajs/session`.** Own package, depends on schemas, viz stays clean. Justified not
  by size (835 lines) but by a genuinely different dependency footprint. _Cost:_ one more package —
  build, tsconfig, changeset lane, version graph.
- **C. Status quo.** Session stays in viz; viz keeps the `@selvajs/schemas` dep. Cheapest; viz is not
  standalone in the stated sense.

**Leaning A**, on the grounds that it needs no new package and puts the session beside its only
binding. **B if headless solving is a shippable feature** — unresolved question below.

#### Unresolved question that decides A vs B

Is a **headless solve** (inputs → outputs, no WebGL, e.g. Node) something we intend to ship? If yes,
B is the better home and §6 matters. If session is always in service of a viewer, A is right and §6
is optional cleanup.

### 6. `session/` internal cleanups (independent of §5)

Two items from the 2026-07-30 discussion, both worth doing wherever session lands:

- **`solve-memo.ts` is the only `three` import in the layer** (1 of 9 files; 835 lines total), inside
  `cloneSceneObjects`/`disposeSceneObjects`. The root cause is `SolveResult.meshes: any[]`
  ([solve-fn.ts](../../packages/visualization/src/session/solve-fn.ts)) — the pipeline's central
  contract is untyped, and the memo silently reinterprets it as `THREE.Object3D[]`. Nothing in the
  type system holds this seam, which is why it never surfaced as an error. **Fix:** `SolveResult<TMesh>`
  - an injected `MeshOwnership<TMesh>` clone/dispose policy. Same seam already used twice in this
    refactor (`onMaxAnisotropy`, `subscribe()`), so consistent rather than novel. Lets
    [visualization-package.md](./visualization-package.md) correction 15 be deleted — the layer diagram's
    "depends on nothing below" becomes true instead of walked-back.
- **`createComputeThrottle` is misnamed and knows nothing about compute.** It is generic over `T`,
  takes any `(values, signal) => Promise<void>`, and contains no reference to Rhino.Compute, HTTP,
  WebSockets, or geometry — a single-in-flight/latest-wins scheduler with an abort timeout. Proof:
  plugin-ui drives it over a **WebSocket to Grasshopper**, no Rhino.Compute in that path. **It must
  not move to `@selvajs/compute`** — that inverts the dependency and would make plugin-ui import the
  Rhino.Compute client to throttle a socket. **Fix:** rename to `createAsyncThrottle` /
  `createLatestWinsThrottle`, drop the `[Compute/throttle]` log prefix.

  Correct split already in place, for the record: client-side throttle here, server-side limit in
  [computeLimits.ts:15](../../packages/selva/src/lib/server/computeLimits.ts#L15), which only
  _references_ this file in a comment. Server enforces; client is polite about it.

## Sequencing

§1, §2, §4 are mechanical, independent, and safe to land in any order — together they remove 14 of the
15 compute import sites. §3 needs the 3a/3b call. §5 is the blocking decision and should be settled
before §3, since 3b changes who owns the envelope walk and that interacts with where session lives.
§6 is independent of everything and can land at any point.

## Not in scope

- Neutral scene-graph layer — still deferred (see the old plan's decision).
- Splitting `parse`/`render`/`scene` apart. One package, internal layers, unchanged.
- `three` / `rhino3dm` peer deps. Those are legitimate and stay.
- `@selvajs/compute`'s own cleanup — see [compute-package-cleanup](./compute-package-cleanup.md).

## Open questions

1. **Headless solve — shipping or not?** Decides §5 A vs B.
2. **§3a or §3b** — duplicate the envelope shape, or push the walk to the caller?
3. **Does `@selvajs/visualization` get published to npm standalone**, or is "standalone" only about
   keeping the dependency graph honest internally? Changes how much the §3b API break costs.
4. **Should `shared/logger.ts` default to `console` or to silence?** Selva wires compute's logger
   either way; the default only affects third-party consumers.
