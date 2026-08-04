# Geometry Backend Seam — Feasibility Investigation

> **Status: investigation only (2026-08-04).** No decision, no code. Answers one question:
> how big a change is it to let Selva solve against a non-Rhino geometry backend
> (e.g. an OpenCascade compute server) instead of Rhino.Compute?

## Verdict

**Medium. The architecture is already most of the way there — but it is not one seam, it is four,
and one of them (the C# plugin) is a separate product, not a refactor.**

The layered design pays off here. The client half of the stack (solve session, drivers, memo,
throttle, the whole UI) is already backend-neutral and needs **no change**. The SLVA mesh wire
format is a Selva invention carrying triangles and PBR materials — zero Rhino concepts — and is
reusable verbatim. `ui-schema.json` has no Rhino geometry types in it.

What is genuinely Rhino-shaped is the **server-side solve path** (`@selvajs/solve/server` +
`@selvajs/compute/grasshopper`) and the **admin/health surface**.

The load-bearing question is not in this codebase at all: today a "definition" is a `.gh` file whose
schema is produced by the **Selva C# plugin running inside Rhino** (`POST /grasshopper/schema`
returns a `UISchema`). A second backend has to answer "what is a definition, and where does its
UISchema come from?" — that is an authoring-tool problem, not a TypeScript refactor.

---

## What you get for free

| Layer                                                                              | State                                                                                                                                                                                                                     | Work                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `@selvajs/solve/shared` — `SolveFn`, `SolveResult`                                 | Backend-neutral by construction. `TMesh`/`TSource` are opaque generics precisely so the package never learns geometry types.                                                                                              | **None**                                 |
| `@selvajs/solve/client` — session, `SolveDriver`, memo, throttle, external storage | Neutral. `SolveDriver` already has two implementations (HTTP request/response, and a WebSocket driver in `plugin-ui`) — the seam is proven, not hypothetical.                                                             | **None**                                 |
| SLVA binary mesh format                                                            | `magic + version + metadata JSON + quantized vertices + indices (+ UVs, vertex colors)`. No BRep, no NURBS, no blocks, no instance refs. Normals are recomputed client-side.                                              | **None** (write an OCC-side SLVA writer) |
| `ui-schema.json`                                                                   | `GrasshopperParamType` values are `number\|integer\|boolean\|text\|valueList\|file\|color\|generic` — not one Rhino type. Param IDs are opaque strings with no GUID constraint. No GH component GUIDs, no DataTree paths. | Rename 2 types, reword ~12 doc strings   |
| `SolveOutcome` / `SolveFailureKind`                                                | `ok\|timeout\|client_abort\|too_large\|shed\|compute_error` — transport vocabulary, survives a swap intact.                                                                                                               | **None**                                 |
| Definition byte cache, single-flight coalescing, gzip/size-guard envelope tail     | Format-blind (`versionId → Uint8Array`, `key → promise`).                                                                                                                                                                 | **None**                                 |
| `IComputeServerStore`, `serverConfigWrite.ts`, server resolution order             | Structurally generic (id/label/url/key/timeout/retry + scope).                                                                                                                                                            | Add a `kind` discriminator               |
| Persisted `SolveMetric` fields                                                     | No backend-specific field is stored.                                                                                                                                                                                      | **None**                                 |

The `SchemaSource` seam in `plugin-ui` already documents this exact scenario in its header comment:
_"to retarget at a different backend, write one more adapter and nothing in the composables/routes
changes."_ `FakeSource` is the existence proof.

---

## What actually has to change

Ranked by cost.

### 1. The C# authoring story — the real blocker, and not a refactor

Upload is gated on schema extraction: `POST {serverUrl}/grasshopper/schema` with the `.gh` bytes,
which only answers because the **Selva plugin is installed inside that Rhino**. The error text tells
the user to "verify a Context Bake component with the output name 'Schema'".

So a second backend needs, at minimum: a definition format, a way to declare inputs/outputs, and a
service that returns a `UISchema` and can solve. That is the Grasshopper plugin's whole job,
re-done. **Everything below is small next to this.** Whether the OCC side is a node graph, a Python
script with annotated params, or something else is the actual design decision.

Also closed-enum: `DefinitionFileExt = 'gh' | 'ghx'` appears in the TS type, a Zod enum, an upload
allowlist, and the storage path (`definitions/{guid}/versions/v{n}.{ext}`). Widening it is
mechanical but touches persistence.

### 2. `@selvajs/solve/server` — the port that does not exist yet

There is **one** line that calls Rhino: `solve-pipeline.ts:174` — `client.scheduler.solve(...)`.
But the types around it are nailed to Grasshopper:

- `SolvePipelineArgs.inputTree?: DataTree[]` — GH DataTree in the public arg type
- `SolveEnvelope.result: GrasshopperComputeResponse` — the envelope payload type
- `buildSolveInputTree` → `TreeBuilder.fromInputParams`, filtering on `paramType`
- `transform-input.ts` — the lowerCamel→PascalCase paramType translator (whole file is backend-specific)
- `client-cache.ts` — `CachedClient` hard-binds `GrasshopperClient` + `SolveScheduler`; the
  `getActiveChildren()` probe models rhino.compute's child-process pool and has no OCC analogue
- `RhinoComputeError` + `ErrorCodes.QUEUE_*` → `shed` mapping
- `rhino_decode/solve/encode` Server-Timing — a **documented wire contract**, so changing it means
  bumping `COMPUTE_CONTRACT_VERSION`

Needed: a `GeometryBackend` port at that call site (`solve`, plus an `inputIdentity` for the
coalesce key, which today is `stableStringify(DataTree)`), and genericizing the response type.
Roughly 60% of `solve-pipeline.ts`, 100% of `client-cache.ts` and `transform-input.ts`.

### 3. `@selvajs/compute` — split core from Grasshopper

`core/` is ~85% backend-agnostic already (retry, backoff, abort composition, `Retry-After`,
status→code mapping, base64, file handling). Five small leaks:

- `request.ts:33` — `RhinoComputeKey` header name is hardcoded (`ComputeConfig.headers` merges
  _under_ it, so it cannot be overridden)
- `response.ts:97` — `definition_not_cached` mapping sits in core
- `core/types.ts` — `RhinoModelUnit` (27 Rhino unit names) lives in core, belongs in `grasshopper/`
- `validate-server-url.ts` — blocks `compute.rhino3d.com` specifically
- `fetchRhinoCompute` / `RhinoComputeError` naming — ~205 references, cosmetic but pervasive

Bigger: the scheduler's queue/cancel/cache/LRU **mechanism** is neutral, but its signatures are
pinned to `GrasshopperComputeResponse`/`DataTree`. Generifying it is the reuse unlock.

`rhino3dm` is a hard `dependencies` entry — should become optional so an OCC-only consumer does not
pull a WASM Rhino kernel.

Shape-wise this fits the existing module layout: `/grasshopper` is already its own subpath export,
so `/cascade` is a sibling, not a rewrite.

### 4. Admin / health surface — more Rhino-shaped than the solve path

`ComputeServerStats` is entirely rhino.compute's control plane: `GET /`, `/version`,
`/activechildren`, `/plugins/gh/installed`, `/cache/purge`, `/idlespan`, `/servertime`,
`/launch-child`, `/recycle-children`.

That shape propagates all the way to the UI: the `/admin/compute` status payload has
`rhinoVersion`, `computeVersion`, `selvaInstalled`, `plugins`, `activeChildren`, `idleSpanSeconds`,
and `useServerHealth.svelte.ts`'s readiness state machine is built around "wait for a Rhino child to
finish enumerating Grasshopper add-ons". This needs a capability-based redesign, not a rename.

### 5. Frontend curve decoding — one cheap, high-leverage fix

rhino3dm in the browser is used for **exactly one thing**: tessellating curve display items.
`curves.ts` calls `rhino.CommonObject.decode()` on openNURBS JSON, then `pointAt`/`isPolyline`.
Meshes and points need none of it — `rhino` is already an optional injected param.

**Change `DisplayCurve` to carry a pre-tessellated polyline instead of openNURBS JSON, and rhino3dm
leaves the entire frontend** (`visualization`, `plugin-ui`, and the app viewer's WASM lazy-load).
Worth doing on its own merits, independent of any backend work.

Minor: `modelunits` is a Rhino `UnitSystem` name looked up in `SCALE_FACTORS`; replace with a
numeric metres-per-unit.

---

## Config model

`ComputeServerConfig` has **no `kind`/`backend` discriminant** today — that is the first field to
add, and it is additive:

- `ComputeServerCommon` gains `kind?: 'rhino' | 'opencascade'`, defaulting to `'rhino'`
- Flows free through `IComputeServerStore` and the local JSON store
- Supabase needs one additive migration (`kind text not null default 'rhino'` on `compute_servers`)
- `validateIncomingServers` gains an allowlist check; both write routes thread the field
- `ResolvedServer` (`client-cache.ts:33`) and the `getClient` narrowing (`engine.server.ts:76` — a
  3-field projection) widen to carry `kind`, then dispatch client construction on it

**Register it keyed by `kind`, not as a process-wide `SelvaConfig` slot.** The existing per-server
`sharedWith`/`ownerOrgId` model means one instance will want to serve Rhino and OCC servers
simultaneously.

ADR 0004 already helps: a compute server's identity is its opaque `id`, never its URL, and every
stored reference (pins, org defaults, shares) obeys that. Adding a `kind` does not disturb it.

Per repo convention, ship a `runGeometryBackendConformance` suite in `platform/src/testing/suites/`
from day one — every seam here has one.

---

## Suggested sequencing

Each step is independently shippable and useful on its own.

1. **Pre-tessellate curves.** Deletes rhino3dm from the frontend. Pure win, no backend work.
2. **Un-Rhino `compute/core`.** Configurable auth-header name, move `RhinoModelUnit` out,
   parameterize the blocked host, caller-supplied error-code map. Small, mechanical.
3. **Add `kind` to `ComputeServerConfig`.** Additive; one Supabase migration.
4. **Extract the `GeometryBackend` port** at `solve-pipeline.ts:174`; genericize the response type
   and the coalesce identity. The real refactor.
5. **Capability-based health/admin surface**, replacing the child-process/plugin-inventory contract.
6. **Only then**: an actual OCC adapter — which is gated on the C# authoring answer (#1), not on any
   of the above.

Steps 1–3 are worth doing regardless: they reduce coupling, drop a WASM dependency from the
frontend, and cost little. They also make the size of step 4 much easier to judge.

---

## Rename-only (do not mistake for coupling)

`GrasshopperParamType` (values already generic), `GrasshopperInputStructure` (`item|list|tree` is
just arity), param IDs documented as "GH InstanceGuid" but typed as bare `string`, and ~12 doc
strings. Zero structural change.

## Incidental findings

Two pre-existing duplication hazards, unrelated to this work but worth a ticket:

- `routes/api/v1/compute/schema/+server.ts:52-89` is a near-copy of
  `packages/server/src/definitions/schema-extraction.ts:67-123` — CLAUDE.md's rule about a shared
  rule living in `$lib/server/` rather than being copied into two routes.
- `admin/system/health/+server.ts:161` probes `/healthcheck`, which `compute-server-stats.ts:114`
  says the rhino.compute proxy does not have.
