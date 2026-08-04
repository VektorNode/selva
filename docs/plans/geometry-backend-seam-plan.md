# Geometry Backend Seam — Pre-Open-Source Plan

> **Goal: close the one-way doors before the repo goes public.** Make the public API shape
> swappable so a contributor can add a geometry backend later without a breaking change. **No OCC
> adapter is built here**, and the admin/health redesign is explicitly out of scope.
>
> Breaking renames are in scope — `@selvajs/compute` is `4.0.0-beta.1`, pre-1.0, and this lands as
> one coordinated major. Background and the full coupling audit:
> [geometry-backend-seam-investigation.md](./geometry-backend-seam-investigation.md).
>
> **Progress:** QW1 (pre-tessellated curves) and QW2 (`core/` de-Rhino) are code-complete — see the
> status box on each section. QW3 (the rename pass) is unblocked: it collides with QW2 on
> `core/compute-fetch/response.ts` and `core/index.ts`, and QW2 has landed.
> for what shipped, where the implementation diverged from this plan, and the two live checks plus
> changesets still outstanding. Everything else is unstarted.

## What "one-way door" means here

A change is a one-way door if doing it _after_ open-sourcing breaks someone else's code. Three
qualify:

1. **Symbol names in the published API** — `fetchRhinoCompute`, `RhinoComputeError`,
   `GrasshopperParamType`. Renaming post-launch breaks every consumer.
2. **The absence of a `kind` discriminator** on `ComputeServerConfig` — adding it later is fine, but
   only if nothing has meanwhile keyed behavior off "there is exactly one backend".
3. **`GrasshopperComputeResponse` / `DataTree[]` in `@selvajs/solve/server`'s public types** —
   `SolveEnvelope.result` and `SolvePipelineArgs.inputTree`. These are the load-bearing ones: a
   contributor cannot write a second backend without changing types that are already public.

Everything else (the OCC adapter, admin/health, the C# authoring story) is a normal additive
feature and can wait. It is genuinely deferrable — see [Explicitly out of scope](#explicitly-out-of-scope).

---

## Quick wins

Ordered by value-per-hour. 1–3 are pure decoupling and stand on their own merits even if the seam
work never happens.

### QW1 — Pre-tessellated curves: delete rhino3dm from the frontend ✅ IMPLEMENTED

> **Status: code complete, not yet live-verified.** All of the below shipped except the Rhino
> check in [Step 3](#step-3--qw1-pre-tessellated-curves). Changesets still outstanding.

**The single highest-leverage change in this document.** rhino3dm was used in the browser for
exactly one thing: tessellating curve display items. Meshes and points never touched it.

`DisplayCurve.json` carries openNURBS JSON (`curve.ToNurbsCurve().ToJSON()`), decoded via
`rhino.CommonObject.decode()` and tessellated with `pointAt`/`isPolyline`/`tryGetPolyline`. It now
carries `points` alongside, and the web prefers it.

**Shipped without a compatibility path, on purpose.** The plan proposed keeping the rhino3dm
branch as a fallback for old payloads. That was rejected during the build: with no users on the
product yet, carrying a second tessellation implementation plus a WASM dependency to serve
hypothetical stale definitions is pure cost. **Old definitions fail loudly and get upgraded.**

- **C#** — `DisplayItem.cs` gained `Points` (flat `double[]`, world coords) plus a `Curve(...)`
  overload; the json-only overload is `[Obsolete]`. New `CurveTessellator.cs` runs at
  `GH_WebDisplay.cs:657-666` and `DisplayBatchTransformer.cs:114-122`.
- **TS** — `DisplayCurve.points` is **required**; `DisplayCurve.json` is deleted. `items/curves.ts`
  went 290 → 76 lines: all tessellation, `decodeCurve`, and the rhino3dm import are gone.
- **A curve without `points` throws** `VisualizationError` naming the item and telling the author to
  run Solution → Upgrade obsolete components. Skipping was rejected — a scene quietly missing its
  curves is indistinguishable from a definition that has none.
- **rhino3dm is gone from all four frontends**, not three: `plugin-ui`, `ui`, `selva`, and
  `visualization` (which also lost `examples/shared/rhino.ts`). `@selvajs/compute` keeps it — it
  _is_ the Rhino backend.
- **Removed public API:** `MeshExtractionOptions.rhino` / `.loadRhino`, `DisplayItemParseOptions`
  entirely (`parseDisplayItems` now takes one argument), and
  `ComputeFetchSolveFnOptions.meshes.loadRhino` with its `TRhino` type param. Deleted outright, not
  left as deprecated stubs — this is a coordinated pre-1.0 major, so there is nothing to ease.

#### Where implementation diverged from this plan

1. **The fallback was cut, not kept.** See above — this is the big one, and it reverses the plan's
   central assumption. Two intermediate designs were built and then discarded on the way here: a
   renamed `loadRhino?: () => Promise<RhinoModule>` (lazy, so a current definition paid nothing),
   and a throw-but-keep-the-fallback hybrid. Both are gone.
2. **`DisplayItem.Json` stays, and keeps serializing.** `WebDisplayPreview.cs:138` rebuilds real
   curves from it for the **Grasshopper viewport** (points would draw a faceted polyline) and
   `DisplayBatchTransformer.cs:115` needs the NURBS so repeated transforms don't compound a
   tessellation error. It must stay serialized because `WebDisplayGoo` round-trips the whole
   `DisplayBatch` through `JsonConvert` into the `.gh` archive — dropping it would degrade a saved
   definition's preview to its tessellation. It is Rhino-internal geometry the web ignores, not a
   wire shim, so the plan's "drop it in a later major" was wrong.
3. **`OBSOLETE/` could not be left alone.** Both frozen WebDisplay snapshots emitted curves, so
   they now tessellate like the live component. What is frozen there is the param list and GUID,
   not the payload — a snapshot emitting untessellated curves would fail in the viewer.

Both demo fixtures (`ui/src/demo/example-mesh.json`, `visualization/examples/shared/samples/`)
held opennurbs-blob curves that would now throw; `points` were baked into them.

**A `wire-format.json` codegen seam was built and then removed.** While the TS fallback still
existed, its four tuning constants duplicated the C# ones by hand, so they were generated into both
stacks from one JSON. Cutting the fallback orphaned the TS half — one consumer in one language
needs no codegen — so the constants went back inline in `CurveTessellator.cs`. Worth knowing if
SLVA ever wants the same treatment (compat-gate plan, work item 5): the generator pattern works,
it just had nothing left to keep in sync here.

**Payoff:** rhino3dm and its `locateFile` plumbing leave the frontend entirely — 2.5 MB of WASM
never fetched, one less Rhino tie, and one tessellation implementation instead of two.

**Cost:** medium, as estimated. Cross-stack, so it still needs a plugin release and the live check.

### QW2 — De-Rhino `@selvajs/compute/core` ✅ IMPLEMENTED

All six landed as specified; 620 compute tests pass (7 new), workspace type-check and lint clean.
Three notes on what the implementation added beyond the letter of the plan:

- The `serverErrorCodes` map is applied at **both** Grasshopper fetch sites (`solve.ts` runSolve
  and `io/definition-io.ts`), not just the solve path, via `withGrasshopperErrorCodes`. The `io`
  endpoint can return the same coded errors; supplying the table on only one would have made the
  classification depend on which call produced it.
- `apiKeyHeader` interacts with the caller-headers precedence rule. The key still merges over
  `config.headers`, but only under **whichever** name is configured — so with a custom header,
  `config.headers.RhinoComputeKey` becomes an ordinary caller header and is no longer shadowed.
  Both directions are pinned by tests.
- `ComputeServerStats` moved as a file too (`core/server/` → `grasshopper/server/`), not just its
  export line, so the class no longer sits under a directory it doesn't belong to.

Also swept the three Rhino-branded strings core emitted at runtime (`[Rhino Compute]` in the
no-auth warning, "Grasshopper errors" in the partial-success log, "the default public endpoint" in
the blocked-host error) — user-visible text is part of the leak.

`core/` is already ~85% backend-agnostic (retry, backoff, abort composition, `Retry-After`,
status→code mapping, base64, file handling). Six mechanical fixes — four leaks in, two wrong homes:

- `core/compute-fetch/request.ts:33` — the `RhinoComputeKey` header name is hardcoded, and
  `ComputeConfig.headers` merges _under_ it so it cannot be overridden. Add
  `ComputeConfig.apiKeyHeader?: string`, defaulting to `'RhinoComputeKey'`.
- `core/compute-fetch/response.ts:97` — the `definition_not_cached` mapping is Grasshopper-specific
  logic sitting in core. Move behind a caller-supplied code map.
- `core/types.ts:2-29` — `RhinoModelUnit` (27 Rhino unit names) belongs in `grasshopper/types`.
- `core/server/validate-server-url.ts:10` — parameterize the blocked `compute.rhino3d.com` host.
- `ComputeServerStats` is exported from `/core` (`core/index.ts:48`) but is pure rhino.compute
  control plane — `/activechildren`, `/plugins/gh/installed`, `/idlespan`, the
  `"compute.rhino3d running"` liveness probe. Move the export to `/grasshopper`. (The admin/health
  _contract_ stays deferred per out-of-scope; this is only the class's home.)
- The inverse move: `grasshopper/definition-ref.ts` (`SolveDefinition` / `DefinitionRef` — bytes or
  a lazy byte-ref, nothing Grasshopper in it) → `/core`. It sits in the port's own signature
  (`SolvePipelineArgs.definitionSource`, re-exported by `@selvajs/solve/server`), so a second
  backend's author must not be forced to import it from the Grasshopper subpath.

**Payoff:** `core/` becomes honestly reusable transport, so a second backend inherits all the retry
and abort machinery for free. **Cost:** low, no cross-stack coordination.

### QW3 — The rename pass

Approved as breaking, one coordinated major. Values are already generic — only names are Rhino-flavored.

| Old                         | New              | Where                          |
| --------------------------- | ---------------- | ------------------------------ |
| `fetchRhinoCompute`         | `fetchCompute`   | `@selvajs/compute/core`        |
| `RhinoComputeError`         | `ComputeError`   | `@selvajs/compute/core`        |
| `GrasshopperParamType`      | `ParamType`      | `@selvajs/schemas` (generated) |
| `GrasshopperInputStructure` | `InputStructure` | `@selvajs/schemas` (generated) |

~240 references for the first two (75 + 168, including changelogs/docs; ~215 in code). `ParamType`'s
values are already `number|integer|boolean|text|valueList|dynamicValueList|file|color|generic` — not
one Rhino type; `InputStructure` is `item|list|tree`, just arity. The rename does not touch wire
data: `paramType` serializes as its lowercase string value, never the type name.

Regenerate via `packages/schemas` (`pnpm generate`) — **do not hand-edit** `src/generated/schema.ts`
or `UISchema.Generated.cs`. The C# side regenerates too, so this needs a plugin rebuild.

**The generator itself hardcodes the old names.** `schemas/scripts/generate-csharp.js:80` keys
`STRING_ALIAS_TYPES` on `'GrasshopperParamType'`/`'GrasshopperInputStructure'` (and templates them
into doc comments at 375-376). Rename in `ui-schema.json` without updating that set and the C#
output silently changes shape — edit both in the same commit.

Also reword the ~12 Rhino-flavored doc strings in `ui-schema.json` (param IDs documented as "GH
InstanceGuid" but typed as bare `string`).

**Env var names are public API too** — for operators, they harden at open-source exactly like npm
symbols. Swept `.env.example`: every var is neutral (`COMPUTE_*`) except one —
`MAX_GH_FILE_SIZE_BYTES` → `MAX_DEFINITION_FILE_SIZE_BYTES` (rename in this pass; prose mentions of
Rhino.Compute in comments are fine, they describe the Rhino backend).

**Decide the root barrel in this major.** `compute/src/index.ts` is
`export * from './core'; export * from './grasshopper'` — a kitchen sink that gets worse with every
backend added (name collisions between backend subpaths, and the root forever promising
Grasshopper). Recommendation: drop the `.` export — subpaths only — matching `@selvajs/solve`
(no root barrel, load-bearing per its README) and `@selvajs/visualization` (root deliberately
empty). Root-importing consumers get fixed in this same sweep; post-launch this is a fresh major.

**Payoff:** the public vocabulary stops promising Rhino. **Cost:** low but wide; mostly mechanical.

### QW4 — Fix the two incidental bugs

Unrelated to the seam, both worth clearing before the code is public:

- `routes/api/v1/compute/schema/+server.ts:52-89` is a near-copy of
  `packages/server/src/definitions/schema-extraction.ts:67-123`. CLAUDE.md's rule: a rule two
  endpoints share belongs in `$lib/server/` or `@selvajs/server`, not copied into both.
- `admin/system/health/+server.ts:161` probes `/healthcheck`, which `compute-server-stats.ts:114`
  states the rhino.compute proxy does not have.

---

## Step-by-step plan

Each step is independently shippable and leaves `main` green. Steps 1–3 are the quick wins above;
4–6 are the actual door-closing.

### Step 1 — QW2 + QW4 (`core/` cleanup and the two bug fixes)

No cross-stack coordination, no wire change. Lands first because it is pure win and makes the later
diffs smaller.

**Verify:** `pnpm type-check && pnpm lint && pnpm test`.

### Step 2 — QW3 (the rename pass)

Do it in one commit per package so the diff stays reviewable. `pnpm generate` after the
`ui-schema.json` edit; rebuild the plugin because the C# types regenerate.

**Verify:** `pnpm type-check && pnpm lint && pnpm test`, plus `cd Plugin && dotnet build`. Note the
known-environment caveat: `dotnet test` aborts at CoreCLR launch here, so a clean build is the pass
signal.

### Step 3 — QW1 (pre-tessellated curves)

⚠️ **Code complete; verification outstanding.**

Additive wire change; ship the C# and TS sides together. The rhino3dm fallback path is retained so
old saved payloads still render.

**Done:** `pnpm type-check`, `pnpm lint` (0 errors), `pnpm test`; `Selva.GH` builds clean on
net48/net7.0/net9.0; 328 `Selva.Tests` pass. Both wire-format guard tests were confirmed to fail
on a hand-edit, not just assumed to work.

**Still to do before this ships:**

1. **Live check in Rhino** (the original verify step, unchanged): build the `.gha`, open a
   definition with curve output, confirm curves render identically in `/preview` and in the app
   viewer, then confirm no `rhino3dm.wasm` request appears in the network tab.
2. **Live check the stale-definition path**, which the original step didn't cover: open a `.gh`
   saved by a pre-QW1 plugin and confirm `WebDisplayGoo.BackfillCurvePoints` rescues its curves on
   load. Then confirm a batch it can't rescue surfaces the upgrade message rather than a bare
   render failure.

Changesets are written (`@selvajs/visualization` and `@selvajs/solve` major, `@selvajs/ui` and
`@selvajs/selva` patch).

**Transitional code to delete later.** Two pieces exist only to carry definitions saved before
tessellated curves, and should go once none are in circulation:

- `WebDisplayGoo.BackfillCurvePoints` plus both call sites (`Read`, `CastFrom`)
- the `untessellated` warning in `WebSocketTransport`

Re-saving a definition through any current plugin build makes its batch self-sufficient, so these
only serve `.gh` files not opened since the upgrade. Removing them early is not silent — such a file
starts failing in the viewer with an upgrade message instead. Delete both together.

**Environment note:** `dotnet test` runs fine here — the "aborts at CoreCLR launch" caveat noted
elsewhere in this repo did not reproduce.

### Step 4 — Add `kind` to `ComputeServerConfig`

Purely additive; nothing reads it yet.

- `packages/platform/src/computeServer/types.ts:17` — `ComputeServerCommon` gains
  `kind?: 'rhino'`, documented as the backend discriminator and defaulting to `'rhino'` when absent.
  Keep the union at one member for now: adding `'opencascade'` is a one-line change once an adapter
  exists, and a single-member union still forces every `switch` to be written exhaustively.
- Flows free through `IComputeServerStore` and `LocalComputeServerStore`'s JSON (the local store
  round-trips whole `ComputeServerConfig` objects to disk — verified, no field projection).
- **Supabase:** one additive migration — `kind text not null default 'rhino'` on
  `selva.compute_servers` — **plus the store's explicit column mapping.**
  `SupabaseComputeServerStore.ts` selects via `SERVER_COLUMNS` allowlists (lines 26/33) and maps
  rows through `serverToRow`/`rowToServer`; unlike the local store, an unmapped field drops
  silently there. Four touch points in that file, or `kind` never survives a Supabase round-trip.
- `serverConfigWrite.ts:37` `validateIncomingServers` — allowlist check; thread the field through
  both write routes (`api/admin/compute`, `api/v1/orgs/[orgId]/compute`).
- Widen `ResolvedServer` (`solve/src/server/client-cache.ts:33`) and the `getClient` narrowing
  (`selva/src/lib/server/compute/engine.server.ts:76` — a 3-field projection) to carry `kind`.

**Register backends keyed by `kind`, not as a process-wide `SelvaConfig` slot.** The existing
per-server `sharedWith`/`ownerOrgId` model means one deployment will want Rhino and OCC servers
side by side. This contradicts the `SELVA_*_PROVIDER` pattern used for auth/data/storage — that is
deliberate and worth a comment at the registration site.

ADR 0004 already guarantees a server's identity is its opaque `id`, never its URL, so adding `kind`
disturbs nothing stored.

**Forward note — the definition↔server compatibility contract.** Server resolution
(`resolveServerForOrg`, pure helper in `@selvajs/platform`; app wrapper in
`selva/src/lib/server/compute/resolve.server.ts`) is kind-blind: definitionPin → org default →
global default. Fine with one backend; with two, a `.gh` definition whose pinned server vanished
falls back onto an incompatible server and fails opaquely at compute. The rule, when a second kind
exists: a definition's required kind is **derived from its file format** (`gh`/`ghx` → `rhino`) —
no new persisted field, `fileExt` is already on every version — and enforced at three points:
the upload pin (schema extraction already pins a server; validate its kind), resolution (an
optional `requiredKind` filter on the pure resolver, so fallback can never cross kinds; no match →
the existing `ComputeServerUnconfiguredError`, naming the kind), and the server pickers (filter by
compatible kind). All additive; nothing to build now. The resolver is a door-#2 site — don't let
new resolution logic assume one backend.

**Verify:** `pnpm test`, plus the compute-server conformance suite in both providers.

### Step 5 — Extract the `GeometryBackend` port

The real refactor, and the last true one-way door. Exactly one line calls Rhino today —
`solve/src/server/solve-pipeline.ts:174`, `client.scheduler.solve(...)` — but the types around it
are pinned to Grasshopper.

**5a. Define the port** in `@selvajs/solve/server`:

```ts
interface GeometryBackend<TRequest = unknown, TResponse = unknown> {
	/** Marshal schema inputs + user values into whatever the backend's wire format is. */
	buildRequest(inputs: PipelineInput[], values: Record<string, unknown>): TRequest;
	/** Stable identity for `buildRequest`'s output — the solve coalescing key. */
	requestIdentity(request: TRequest): string;
	solve(
		definition: SolveDefinition,
		request: TRequest,
		opts: { signal: AbortSignal }
	): Promise<TResponse>;
	/** Map a backend error to the neutral outcome vocabulary (shed / timeout / compute_error). */
	classifyError(error: unknown): SolveFailureClassification;
	/** Backend-named Server-Timing entries, replacing the hardcoded `rhino_*` trio. */
	serverTiming?(response: TResponse): Record<string, number>;
	/** Per-node diagnostics, so `errorCount`/`warningCount` stay meaningful. */
	diagnostics(response: TResponse): { errors: string[]; warnings: string[] };
}
```

**5b. Genericize the public types.** `SolveEnvelope.result` becomes `TResponse` instead of
`GrasshopperComputeResponse`; `SolvePipelineArgs.inputTree?: DataTree[]` becomes an opaque
`TRequest`. `SolveOutcome` is **already** neutral (`ok|timeout|client_abort|too_large|shed|compute_error`)
and survives untouched.

**5c. Move the Grasshopper specifics behind a `GrasshopperBackend` implementation** — the whole of
`transform-input.ts` (it feeds compute's `processInput`, where the lowerCamel→PascalCase paramType
mapping actually lives, and special-cases `dynamicValueList`), `buildSolveInputTree` →
`TreeBuilder.fromInputParams`, the `RhinoComputeError` + `ErrorCodes.QUEUE_*` → `shed` mapping, and
the `rhino_decode/solve/encode` timing. Good news on the timing rename: no in-repo consumer parses
the `rhino_*` names (only the pipeline's own tests and a website demo string) — the contract bump
is for external consumers.

**5d. `client-cache.ts` is the messiest part.** `CachedClient` hard-binds `GrasshopperClient` and
`SolveScheduler`, and `getActiveChildren()` models rhino.compute's child-process pool with no
analogue elsewhere. Make the cache generic over a backend-supplied client factory, and treat the
child probe as an optional backend capability rather than a required one.

While in there: the scheduler itself (`grasshopper/scheduler/`) is neutral machinery in Rhino
clothes — queue, concurrency cap, wait deadlines, abort handling, byte-budget cache are all
backend-agnostic; only the threaded payload types (`DataTree[]`, `GrasshopperComputeResponse`) are
GH. Don't relocate it now, but genericize its type parameters in the same pass
(`SolveScheduler<TDef, TReq, TRes>` with Grasshopper defaults, source-compatible) — a later
extraction to `/core` for a second backend then becomes trivial or unnecessary. Same applies to
`stable-hash.ts` and `definition-ref.ts`.

**5e. Decide the adapter's home now — the export location hardens at open-source.** The plan says
"move the Grasshopper specifics behind a `GrasshopperBackend`" but not which package exports it.
`@selvajs/solve` hard-depends on `@selvajs/compute` today; if `GrasshopperBackend` is exported from
`@selvajs/solve/server`, that dependency is permanent and every future backend either joins solve
or lives inconsistently elsewhere — and moving the export later breaks importers. The clean shape:
the `GeometryBackend` port is **structural** — `@selvajs/solve/server` exports only the interface
and the generic pipeline; `@selvajs/compute` exports the concrete `GrasshopperBackend` (it _is_ the
Grasshopper package, no type import from solve needed); the app composes them at the kind-keyed
registration site. Even if solve's runtime dep on compute survives 5d for now, exporting the
adapter from compute on day one makes the eventual dep-cut invisible to consumers. A future OCC
adapter then joins as another subpath (`@selvajs/compute/opencascade`, reusing `/core` transport)
or as its own package — additive either way, decided when real; the only wrinkle to remember is
that `rhino3dm` is a package-level hard dep, so an OCC-only consumer of `/core` would pull it —
solvable then (optional dep, or split core out).

**5f. The render/IO path is a second Rhino surface the port does not cover.**
`@selvajs/server`'s `load-for-render.ts:159-183` types `GrasshopperClient` outright and calls
`client.getIO(...)` on the same warm `CachedClient` to merge compute defaults into the schema at
render time. A second backend cannot render definitions without an IO analogue. It belongs to the
same cluster as the deferred C# authoring story (it's "describe this definition", like
`/grasshopper/schema`) — deferring is fine, but name it: either add an optional `describeIO`
capability to the port now, or record in ADR 0008 that render-IO is explicitly Grasshopper-only
until the authoring story lands. Otherwise "one line calls Rhino" reads as the full inventory when
it is the full _solve_ inventory.

**Watch:** `rhino_*` Server-Timing is a **documented wire contract** (`solve/src/server/README.md`,
"The Server-Timing string is a wire contract"). Changing it means bumping
`COMPUTE_CONTRACT_VERSION` in `solve-pipeline.ts:33`.

**Verify:** the existing solve tests must pass unchanged against `GrasshopperBackend` — that is the
proof the extraction is behavior-preserving. Then a live solve in the app.

### Step 6 — Conformance suite + docs

- Ship `runGeometryBackendConformance` in `packages/platform/src/testing/suites/`. Every seam in this
  repo has one; a public seam without a conformance suite is an invitation to write a subtly wrong
  adapter.
- Write **ADR 0008 — geometry backend is a port**: record that identity is `kind`, that backends
  register per-server rather than per-process, and what a contributor must implement. This is the
  artifact that makes the seam legible to an outside contributor. Also declare **SLVA + the
  display-item JSON the backend-neutral display interchange**: the blob is positions/indices/
  normals/uv/color with delta+zigzag — nothing Rhino in it — and since QW1 shipped the display
  items are plain points too, so a second backend that emits the same wire gets the entire viewer
  (`parseMeshBatch*` → THREE, outliner, measure) for free. Without this line, an OCC contributor
  reads "SLVA is private to the Rhino path" and builds a parallel mesh pipeline. **Say explicitly
  that `DisplayCurve.json` is Rhino-only and deprecated** — a second backend emits `points` and
  nothing else; the field survives purely for pre-QW1 payloads.
- Update `CLAUDE.md` / `STRUCTURE.md` so the `three`-prohibition-style rules mention the new port.

---

## Explicitly out of scope

Deferred deliberately — none of these are one-way doors, and saying so publicly is better than
half-building them:

- **Any OCC/Cascade adapter.** Gated on the C# authoring question below, not on this refactor.
- **The admin/health redesign.** `ComputeServerStats` is entirely rhino.compute's control plane
  (`/activechildren`, `/plugins/gh/installed`, `/cache/purge`, `/idlespan`), and that shape reaches
  the UI as `rhinoVersion`, `activeChildren`, `idleSpanSeconds`. It needs a capability-based
  contract, but it is **additive** — a second backend can report a reduced capability set without
  breaking the first. Safe to leave visibly Rhino-shaped at launch, because neither consumer is
  external: `/api/admin/compute/status` ships in lockstep with the admin pages, and the published
  `ComputeServerStats` class lives in what Step 5 turns into the Rhino adapter package, where a
  Rhino shape is honest. Two cheap guards keep it deferrable: **(1)** when Step 4 lands, stamp
  `kind` on the status response and render stats in the admin UI as a per-`kind` capability blob —
  the admin panel is the most likely place for code to key off "there is exactly one backend"
  (door #2); **(2)** if the API v1 redesign later promotes compute status into the versioned PAT
  surface, do the capability restructure _before_ that promotion — that is the moment this shape
  would harden into a public contract.
- **`DefinitionFileExt = 'gh' | 'ghx'`.** A closed enum across the TS type, a Zod schema, an upload
  allowlist, and the storage path. Widening touches persistence and buys nothing until a second
  definition format exists.
- **The C# authoring story.** The actual blocker for a real second backend: upload is gated on
  `POST /grasshopper/schema`, which only answers because the Selva plugin runs _inside_ Rhino and
  emits the `UISchema`. A second backend needs a definition format, a way to declare inputs/outputs,
  and a service returning a `UISchema`. That is re-doing the Grasshopper plugin's job — a product
  decision, not a refactor, and best made in the open with contributors.
- **Curve/geometry _inputs_ (future param type).** Deferred, but the shape of the answer is decided
  now so nobody reaches for browser WASM later. **Transport already exists**: the input pipeline has
  a full `Geometry` lane (`geometryParser` in `compute/io/input/input-type-parsers.ts`; tree leaves
  carry `Rhino.Geometry.*` JSON envelopes, JSON-parsed but otherwise opaque —
  `normalize-default.ts:129`). A geometry value that _originates Rhino-side_ (a default baked at
  schema extraction, an object echoed from a prior solve) round-trips through the web today as an
  opaque blob — no rhino3dm, no adapter. The only real gap is **browser-authored** geometry (user
  draws/edits a curve): the rule is **neutral JSON payload, backend-side construction** — the web
  sends `{points, degree?, closed?}`-style data; a `GetCurve`-style interactive param in the
  plugin's ComputeIO feature (the `GetValueListParameter` pattern) builds the Rhino curve at solve
  time, in both Local and Cloud modes, and an OCC adapter would interpret the same neutral shape.
  Fallback: convert in `GrasshopperBackend.buildRequest` via Node-side rhino3dm (`@selvajs/compute`
  already depends on it). Never rhino3dm in the browser — that undoes QW1. Simple cases need no new
  type at all: a points input plus curve components inside the definition.

  **File-borne geometry (STEP/IGES/STL/OBJ uploads) already follows this rule and already works.**
  The `file` input lane carries a discriminated value `{type: 'path' | 'url' | 'base64', …}`
  (`FileInputData`), the `Get File` param imports it to geometry at solve time
  (`FileImporter.cs` handles `.3dm`/`.step`/`.stp`/`.stl`/`.obj` via `FileStp.Read` etc.), and
  `Get Server File` is the existing by-reference variant. This is the _most_ OCC-portable input of
  all — STEP is OCC's native format; a second backend reads the same value directly. The seams to
  keep: (1) the file value stays a discriminated union, so an `assetId`/store-ref variant is
  additive when inline base64 hits body-size limits on multi-MB STEPs; (2) format support lives in
  the backend's importer + per-input `acceptedFormats` — new formats are data, never a wire change;
  (3) conversion stays backend-side, never in the browser or the Node layer.

---

## Sequencing note

Steps 1–3 are safe to ship in any order and are worth doing regardless of whether the seam is ever
finished. Step 4 is additive and low-risk. **Step 5 is the only one that needs real care** — it is
the one that must land before open-sourcing, because it is the only change here that a contributor
cannot make themselves without breaking published types.

If time runs short, the honest minimum is **steps 2, 4, and 5**: the rename, the discriminator, and
the port. QW1 was the most satisfying win and the most deferrable — dropping a frontend dependency
later breaks nobody — but it is now done, so what remains is 1, 2, 4, 5.

---

## Running this in parallel

The numbering above is a reading order, not a dependency chain. Verified file-level overlap:

|                | QW1 curves | QW2 core    | QW3 rename  | S4 `kind`             | S5 port               |
| -------------- | ---------- | ----------- | ----------- | --------------------- | --------------------- |
| **QW1 curves** | —          | none        | none        | none                  | none                  |
| **QW2 core**   | none       | —           | **2 files** | none                  | none                  |
| **QW3 rename** | none       | **2 files** | —           | none                  | wide                  |
| **S4 `kind`**  | none       | none        | none        | —                     | **`client-cache.ts`** |
| **S5 port**    | none       | none        | wide        | **`client-cache.ts`** | —                     |

### Three tracks that can run at once

**Track A — curves (QW1).** ✅ **Done** apart from live verification. Was fully isolated:
`visualization/parse/display-items/*`, `plugin-ui/websocket-solve-driver.ts`,
`selva/routes/library/[guid]/+page.svelte`, `solve/src/client/compute-fetch-solve-fn.ts`,
`ui/src/demo/dummy-output-values.ts`, three package.jsons, the C# display feature, and (added
during the build) `schemas/wire-format.json` plus both codegen scripts. Touched **nothing** any
other track touches — the solve/client file is untouched by QW3/S5, which live in
`solve/src/server`, and the codegen additions only append. What remains is blocked on a human at a
Rhino box, not on code, so it parallelizes with everything below.

**Track B — `core/` cleanup + the two bug fixes (QW2 + QW4).** Confined to
`compute/src/core/**` plus two route/lib files. Independent of everything else.

**Track C — `kind` discriminator (Step 4).** `platform/computeServer/types.ts`, the Supabase
migration, `serverConfigWrite.ts`, both write routes. Its only contact with Track D is
`ResolvedServer` at `client-cache.ts:33`.

### What must be serialized

**QW3 (rename) after QW2.** They collide on `core/compute-fetch/response.ts` and
`core/server/validate-server-url.ts`. Both edits are mechanical, so the merge is trivial — but the
rename is a ~205-reference sweep, and resolving that against a moving `core/` is pointless churn.
Land QW2 first, then rename.

**Step 5 (port) last, or at least last to merge.** It touches `solve-pipeline.ts`,
`transform-input.ts`, and rewrites `client-cache.ts` — which Step 4 also edits. And because the
rename sweeps the same symbols the port is re-typing, doing both concurrently means resolving the
same conflict twice.

The clean order: **A ∥ B ∥ C → QW3 → S5.**

### Practical notes

- **The `client-cache.ts` collision is small and predictable** — Step 4 adds one field to
  `ResolvedServer` (line 33); Step 5 rewrites the client construction below it. If both are in
  flight, have Step 4 land its `ResolvedServer` change first as a standalone commit; Step 5 then
  builds on it.
- **Track A needs a plugin release**, so start it early — it has the longest lead time (C# build →
  `.gha` → install → restart Rhino → visually diff curve output) despite being the least entangled
  code.
- **Run `pnpm type-check && pnpm lint && pnpm test` per track, not per commit.** Batch verification
  at each track's end.
- **One caveat on `pnpm generate` (QW3):** it rewrites both `schemas/src/generated/schema.ts` and
  `Plugin/Selva.Schema/Models/UISchema.Generated.cs`. If Track A has the plugin open, regenerate on
  the rename branch and rebuild once, rather than both tracks racing the same generated C# file.
