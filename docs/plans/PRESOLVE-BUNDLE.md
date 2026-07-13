# Pre-solved bundle + prewarm (F1) — feature spec

> **Status: PLANNING (2026-07-13).** Design only — no implementation yet. This
> was the caching plan's "F1 / Phase 5"; it is a **product feature**, not
> transparent caching, so it lives in its own spec. It builds on the caching work
> — the durable L2 solve cache (H1) shipped and validated (its keying +
> gzipped-envelope machinery lives in `@selvajs/server/compute`:
> `solve-cache-key.ts`, `solve-cache-envelope.ts`) — but adds author-facing
> surface: an admin action, a UI, a file format, and an offline read-path.
> Caching made the same solves cheaper invisibly; this lets an author
> _pre-compute_ a definition's discrete input space and ship the results.
>
> (The former `docs/plans/CACHING.md` tracker was deleted 2026-07-13 after all
> its caching work was implemented and validated; the two deferred package/routing
> seams it noted are GitHub issues #144 and #145.)

---

## The ask

Pre-solve a definition across a set of input combinations, then either:

1. **Prewarm** — seed the durable L2 solve cache so live requests for those
   combos become instant cache hits (no file, no viewer change); or
2. **Bundle** — package the results as a downloadable file a user can run
   **without compute**: the viewer serves any matching combo offline and falls
   back to a live solve on a miss.

Both are the same engine (enumerate the input space → solve each combo → write
to a sink); they differ only in the sink (L2 cache vs. a file).

---

## Why it's feasible

`GrasshopperComputeResponse` is self-contained and replayable: the viewer's
`GrasshopperResponseProcessor` reads `values`/geometry off the response, never
re-running the definition. So a stored response _is_ a complete solve. The
caching work already built the two hard parts:

- **Keying** — a stable, collision-defended input key
  (`solve-cache-key.ts`, H2), folding `COMPUTE_CONTRACT_VERSION` + compute-server
  identity so a bundle can't serve a result from an incompatible Rhino/plugin.
- **Serialization + envelope** — `runSolvePipeline` (`@selvajs/server/compute`)
  produces the solve result already gzipped and framed
  (`solve-cache-envelope.ts`), with an L2 write-through hook. **The prewarm sink
  is free**: solve each combo through the same pipeline with the same
  `solveCache` hook the live route uses, and L2 is populated correctly-keyed
  with zero new persistence code.

---

## Hard constraint — state it up front

Grasshopper input spaces are **continuous and combinatorial**. A bundle can only
cover **discrete, enumerable** inputs. This is an **exact-match lookup with
graceful live-solve fallback**, never a general offline solver. A free-float
slider cannot be baked; a definition dominated by them can't be meaningfully
bundled at all (and shouldn't be — see non-determinism below).

### Which inputs are enumerable

| paramType          | enumerable? | value space comes from                                                                    |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------- |
| `boolean`          | **yes**     | always `{false, true}`                                                                    |
| `valueList`        | **yes**     | `DropdownWidgetConfig.options` values; checklist = subsets                                |
| `integer`          | conditional | `minimum` + `maximum` (+ `stepSize`, default 1) grid — finite only if **both bounds set** |
| `number`           | **no**      | continuous; even bounded, a fractional step is continuous — skip + warn                   |
| `dynamicValueList` | **no**      | runtime-populated from a prior solve; no static space                                     |
| `text`             | **no**      | free string (`pattern` constrains, doesn't enumerate)                                     |
| `color`            | **no**      | continuous color space                                                                    |
| `file`             | **no**      | uploaded/URL blob                                                                         |
| `generic`          | **no**      | opaque passthrough                                                                        |

Walk with `getInputItems(schema)` (`@selvajs/schemas` traversal). For a
`valueList`/`dynamicValueList` **checklist** (`displayAs: 'checklist'`), the
value is an array — the space is the _power set_ of options, which explodes
fast; v1 treats checklists as **always-skipped** (held at their current value).
No cartesian-product helper exists in the repo today; F1 adds one.

---

## Non-determinism & policy — reuse `solveCacheLimit`

Some definitions must **not** be baked: Random components, time/date, external
data fetched _inside_ the definition. `versionId + inputs` keying with no TTL
freezes one sample forever, and a bundle bakes it in permanently (R9).

**Rule:** a definition with `solveCacheLimit === 0` (caching explicitly off) is
**not prewarmable and not bundleable** — the presolve action refuses with that
reason. This reuses the existing per-definition off-switch (no new field): an
author who knows their definition is non-deterministic already turns caching off,
and that same signal blocks baking. Wide-input-space definitions (hit-rate ≈ 0)
are naturally excluded too — they have no finite space to enumerate.

---

## Combo-explosion guardrail — count + confirm

Auto-walk multiplies: 4 dropdowns × 5 options = 625 solves. **Decision: no silent
truncation, no hard refusal — surface the count and require an explicit confirm.**

1. The enumerate step computes `count = Π |space_i|` **without solving**.
2. The action returns the count + an estimate (count × the solve-metric sink's
   median solve ms for this definition when history exists, else a coarse
   per-solve default) + the top contributing inputs.
3. The UI shows "This will run N solves (~T). Proceed?" — the operator confirms
   before any solve runs.
4. A sanity ceiling (`PRESOLVE_MAX_COMBOS`, config, default e.g. 5000) still
   hard-stops absurd spaces so a fat-fingered range can't queue a million solves;
   this is a backstop above the confirm, not a replacement for it.

---

## Architecture

### Shared engine (`@selvajs/server/compute` — new)

Two pure-ish pieces, colocated with the cache machinery they reuse:

- **`enumerateInputSpace(schema, values)`** → `{ combos: Record<string,unknown>[], count, skipped: {inputId, reason}[] }`.
  Walks `getInputItems`, builds each enumerable input's discrete value set,
  cartesian-products them. Non-enumerable inputs are held at their current/default
  value and reported in `skipped`. Count is computed before materializing combos
  (guardrail can reject without allocating the full list).
- **`runPresolve({ combos, solve, sink, signal, onProgress })`** — for each combo,
  call `solve(combo)` (which is `runSolvePipeline` with the definition/client
  already resolved), route the result to `sink`, emit `onProgress(done, total)`.
  Best-effort per combo: one combo's failure is recorded and the batch continues.

The engine is **sink-agnostic**. Two sinks:

- **`prewarmSink`** — the solve already write-throughs to L2 via the pipeline's
  `solveCache` hook, so this sink is essentially a no-op counter (the caching is a
  side effect of solving through the hooked pipeline). This is why prewarm is the
  cheap slice.
- **`bundleSink`** — collects `{ inputKey → envelope }` into the bundle structure
  (below), `algo`-stripped (M3), for serialization to a downloadable file.

### The admin route

`packages/selva/src/routes/api/definitions/[guid]/presolve/+server.ts` — content
surface (**not** `/admin`), following the canonical single-definition route shape
(`publish/+server.ts`):

- Gate: **`requireEditableDefinition(locals, guid)`** — returns `{ record, ctx,
project }`, no instance-admin bypass. Prewarming triggers many solves; it's an
  edit-level operation on one's own definition.
- Refuse if `record.solveCacheLimit === 0` (non-cacheable → non-bakeable).
- Body: `{ mode: 'count' | 'prewarm' | 'bundle', channel?, versionId? }`.
  - `mode: 'count'` → enumerate only, return `{ count, estimate, skipped,
topContributors }`. Cheap, no solves — powers the confirm dialog.
  - `mode: 'prewarm' | 'bundle'` → run the engine after the count passed the
    ceiling.
- Resolve the version + compute client exactly as `api/compute/+server.ts` does
  (share the resolution helpers), build the same `solveCache` hook, then drive
  `runPresolve`.

**Progress reporting** ([#142](https://github.com/VektorNode/selva/issues/142)).
No job/queue infra exists; all definition routes are synchronous. Two options,
decided with the combo ceiling: (a) cap combos low enough that a batch always
finishes inside the HTTP timeout and return a **synchronous aggregate response**
(matches every existing definition route), or (b) allow larger spaces and adopt
the **SSE-over-`ReadableStream`** pattern from `admin/api/system/update/+server.ts`
(the only async-progress precedent) — one `data: {done,total,combo}` event per
solved combo. Option (b) would be the first streaming action on the content
surface.

### The UI

`DefinitionEditDrawer.svelte`, **Details tab, beside the Solve cache limit field**
(its natural neighborhood — same L2 cache it feeds). Follows the cover-image
upload pattern already in the drawer: a local `$state` busy flag + direct
`fetch` to the presolve route + `toast`.

Flow: click **Prewarm cache** → `fetch(mode:'count')` → confirm dialog with count

- estimate + skipped-inputs list → on confirm, `fetch(mode:'prewarm')`, showing a
  progress bar (streamed or a single busy→done state per [#142](https://github.com/VektorNode/selva/issues/142)).
  **Generate bundle** is the same flow with `mode:'bundle'`, ending in a file
  download. Disabled with an explanatory tooltip when `solveCacheLimit === 0`.

### The bundle format

```
bundle.selva  (gzip of a JSON envelope, or a small binary container)
{
  manifest: {
    formatVersion: 1,
    definitionGuid, versionId, channel,
    computeContractVersion,        // must match viewer's to be servable
    computeServerId,               // provenance; folded into keys
    createdAt, comboCount,
    inputSpace: [{ inputId, values }],   // what was enumerated (audit + UI)
  },
  entries: { [inputKey]: <algo-stripped GrasshopperComputeResponse> }
}
```

- `inputKey` = `stableStringify(values)` **scoped by** `definitionGuid/versionId/
channel` — the memo's raw-values key is NOT definition-scoped, so the bundle
  key must fold those three discriminators in (the viewer holds all three at
  solve time: `+page.svelte:75-79`).
- Entries are `algo`-stripped (M3) so each doesn't re-embed the multi-MB `.gh`.
- `formatVersion` + `computeContractVersion` gate compatibility: a viewer on a
  newer contract ignores an incompatible bundle and live-solves.

### The offline viewer read-path

**Driver-level interception (recommended)** — extend
`createRequestResponseDriver` (`@selvajs/ui`) with an optional bundle lookup
`(values) => SolveResult | undefined`, checked **beside the M2 memo** at
`createSolveSession.svelte.ts:197-208`:

1. throttle picks the latest values →
2. **bundle lookup** (exact-match on the definition-scoped key) → hit reports the
   stored `SolveResult` with zero fetch (same `getReporter().report()` path a
   memo hit uses) →
3. miss → M2 memo → miss → `onSolve` (live `fetch('/api/compute')`).

This inherits `clearCache`/rebuild semantics and keeps the app's `onSolve`
(`library/[guid]/+page.svelte:47`) as the pure live-solve fallback — a bundle
miss just falls through. The bundle is loaded by the host page (file input or a
prewarm-published pointer) and passed to the driver.

`stableStringify` from `@selvajs/compute` is importable client-side (already a
selva dep, `sideEffects: false`) — the viewer keys with the same serializer the
bundle was built with, so keys match. (`hashSolveInput` is **not** usable
client-side — it needs a server-built dataTree — so keying is `stableStringify`
over request material on both ends, not the server's tree hash.)

---

## Build order (phased)

1. **P5.1 — enumerate engine + count/guardrail.** `enumerateInputSpace` +
   cartesian product + count + `skipped`/`topContributors`. Pure, fully
   unit-testable. No solving. Ships the `mode:'count'` route branch and the
   confirm-dialog data. **Smallest, highest-confidence slice.**
2. **P5.2 — prewarm.** `runPresolve` + the `prewarm` sink (solve through the
   hooked pipeline → L2). Route `mode:'prewarm'` + UI button + confirm + progress.
   **The cheap first product slice** — no file format, no viewer change. Transport
   (sync vs. SSE) and the combo ceiling are decided together in
   [#142](https://github.com/VektorNode/selva/issues/142).
3. **P5.3 — bundle build.** `bundleSink` + the bundle format serializer
   (`algo`-strip, manifest, gzip). Route `mode:'bundle'` → file download. UI
   "Generate bundle" button.
4. **P5.4 — offline viewer.** Bundle loader + driver-level lookup in
   `@selvajs/ui`; host wiring in the library viewer. Live-solve fallback on miss
   / incompatible contract. Distribution (loose file vs. version pointer) is
   [#141](https://github.com/VektorNode/selva/issues/141).

Each phase is independently shippable and testable; P5.1 gates the rest, P5.2 is
the MVP, P5.3+P5.4 are the download-and-run feature.

---

## Decisions & tracked questions

Resolved inline:

- **Checklists — always skip in v1.** A `displayAs: 'checklist'` value list
  enumerates to the _power set_ of its options, which explodes far faster than
  the cartesian product of single-selects. v1 treats checklists as
  non-enumerable (held at their current value, reported in `skipped`). Opt-in
  checklist enumeration with its own sub-cap can come later if asked for.
- **Estimate source.** The count×time confirm estimate uses the solve-metric
  sink's per-definition median solve time when history exists, else a coarse
  per-solve default. Cosmetic; never blocks the action.

Tracked as GitHub issues (decide when the owning phase is picked up):

- **[#141](https://github.com/VektorNode/selva/issues/141) — bundle distribution**
  (loose file re-upload vs. published version pointer). Affects P5.4 host wiring,
  not the format.
- **[#142](https://github.com/VektorNode/selva/issues/142) — transport + combo
  ceiling** (`PRESOLVE_MAX_COMBOS` low enough for a synchronous response vs.
  first-of-its-kind content-surface SSE). Pick the ceiling and transport
  together; gates P5.2.
- **[#143](https://github.com/VektorNode/selva/issues/143) — re-bake on new
  version** (auto-invalidate / offer re-prewarm when a new live version
  publishes). Product decision, P5.2+; no correctness angle (`versionId`-keying
  already prevents stale serves).
