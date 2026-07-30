# Pre-solved bundle + prewarm (F1) — feature spec

> **Status: PLANNING (2026-07-13).** Design only — no implementation yet. Was the
> caching plan's "F1 / Phase 5", split out because it's a **product feature**, not
> transparent caching: it adds author-facing surface (admin action, UI, file
> format, offline read-path). Caching made the same solves cheaper invisibly; this
> lets an author _pre-compute_ a definition's discrete input space and ship the
> results.
>
> ⚠️ **The foundation this was written against no longer exists (2026-07-30).**
> [caching-simplification](./archive/caching-simplification.md) deleted the durable
> L2 solve cache and its machinery — `solve-cache-key.ts`,
> `solve-cache-envelope.ts`, `memory-solve-cache.ts`, and the pipeline's
> `solveCache` write-through hook are all gone. The L2 backend was redundant with
> the scheduler's own in-process cache (same heap, same restart boundary, consulted
> second), so it was removed rather than kept for a feature that hadn't been built.
>
> What that changes, concretely:
>
> - **The prewarm sink is no longer free.** §Why it's feasible below claims the
>   write-through hook makes it zero-cost. That hook is gone; prewarm now needs a
>   real storage decision first.
> - **Key derivation and the gzipped envelope format must be rebuilt** if a bundle
>   still wants them. The design intent behind both (a wide collision-defended key
>   folding `COMPUTE_CONTRACT_VERSION` + server identity; opaque pre-gzipped bytes)
>   is still sound and worth reading here as a spec — it just has no implementation
>   to lean on.
> - **`ISolveResultCache` in `@selvajs/platform` survives** and is the intended
>   seam for any shared/persistent solve store. That is where a prewarm sink should
>   mount, with a real backend behind it.
> - **`solveCacheLimit` on the definition record also survives** (a persisted
>   column in both stores) and is dormant until such a backend exists.
>
> Treat the sections below as a product spec with a stale storage layer. The
> author-facing half — enumerating the input space, the admin action, the bundle
> file format, the offline read-path — is unaffected.
>
> (The former `docs/plans/CACHING.md` tracker was deleted 2026-07-13 once its work
> was implemented and validated; its two deferred package/routing seams are issues
> #144 and #145.)

---

## The ask

Pre-solve a definition across a set of input combinations, then either:

1. **Prewarm** — seed the durable L2 solve cache so live requests for those combos
   become instant cache hits (no file, no viewer change); or
2. **Bundle** — package the results as a downloadable file a user can run
   **without compute**: the viewer serves any matching combo offline, falling back
   to a live solve on a miss.

Same engine (enumerate input space → solve each combo → write to a sink); they
differ only in the sink (L2 cache vs. file).

---

## Why it's feasible

`GrasshopperComputeResponse` is self-contained and replayable — the viewer's
`GrasshopperResponseProcessor` reads `values`/geometry off the response, never
re-running the definition. A stored response _is_ a complete solve. The caching
work already built the two hard parts:

- **Keying** — a stable, collision-defended input key folding
  `COMPUTE_CONTRACT_VERSION` + compute-server identity, so a bundle can't serve a
  result from an incompatible Rhino/plugin. ⚠️ The implementation
  (`solve-cache-key.ts`) was deleted with the L2 cache; the requirement stands and
  needs rebuilding.
- **Serialization + envelope** — a stored response is a complete solve, and
  storing it pre-gzipped keeps a hit near-CPU-free. ⚠️ `solve-cache-envelope.ts`
  and the pipeline's L2 write-through hook are also gone, so the earlier claim that
  "the prewarm sink is therefore free" **no longer holds**: prewarm now needs a
  storage backend behind `ISolveResultCache` before any of this is zero-cost.

---

## Hard constraint

Grasshopper input spaces are **continuous and combinatorial**; a bundle can only
cover **discrete, enumerable** inputs. This is **exact-match lookup with graceful
live-solve fallback**, never a general offline solver. A free-float slider can't
be baked; a definition dominated by them can't be meaningfully bundled at all (and
shouldn't be — see non-determinism).

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

Walk with `getInputItems(schema)` (`@selvajs/schemas`). A `valueList`/
`dynamicValueList` **checklist** (`displayAs: 'checklist'`) enumerates to the
_power set_ of options, which explodes fast — v1 treats checklists as
**always-skipped** (held at their current value). No cartesian-product helper
exists in the repo today; F1 adds one.

---

## Non-determinism policy — reuse `solveCacheLimit`

Some definitions must **not** be baked: Random components, time/date, external
data fetched _inside_ the definition. `versionId + inputs` keying with no TTL
freezes one sample forever, permanently (R9).

**Rule:** a definition with `solveCacheLimit === 0` (caching explicitly off) is
**not prewarmable and not bundleable** — the presolve action refuses with that
reason. Reuses the existing per-definition off-switch (no new field): an author
who knows their definition is non-deterministic already turns caching off, and
that same signal blocks baking. Wide-input-space definitions (hit-rate ≈ 0) are
naturally excluded too — no finite space to enumerate.

---

## Combo-explosion guardrail — count + confirm

Auto-walk multiplies: 4 dropdowns × 5 options = 625 solves. **Decision: no silent
truncation, no hard refusal — surface the count, require explicit confirm.**

1. Enumerate computes `count = Π |space_i|` **without solving**.
2. The action returns count + an estimate (count × the solve-metric sink's median
   solve ms for this definition when history exists, else a coarse default) + the
   top contributing inputs.
3. UI shows "This will run N solves (~T). Proceed?" — operator confirms before any
   solve runs.
4. A sanity ceiling (`PRESOLVE_MAX_COMBOS`, config, default e.g. 5000) still
   hard-stops absurd spaces — a backstop above the confirm, not a replacement.

---

## Architecture

### Shared engine (`@selvajs/server/compute` — new)

Two pure-ish pieces, colocated with the cache machinery they reuse:

- **`enumerateInputSpace(schema, values)`** → `{ combos, count, skipped:
{inputId, reason}[] }`. Walks `getInputItems`, builds each enumerable input's
  discrete value set, cartesian-products them. Non-enumerable inputs are held at
  their current/default value and reported in `skipped`. Count is computed before
  materializing combos (guardrail rejects without allocating the full list).
- **`runPresolve({ combos, solve, sink, signal, onProgress })`** — per combo, call
  `solve(combo)` (`runSolvePipeline` with definition/client already resolved),
  route the result to `sink`, emit `onProgress(done, total)`. Best-effort: one
  combo's failure is recorded and the batch continues.

Sink-agnostic. Two sinks:

- **`prewarmSink`** — the solve already write-throughs to L2 via the pipeline's
  `solveCache` hook, so this sink is essentially a no-op counter. This is why
  prewarm is the cheap slice.
- **`bundleSink`** — collects `{ inputKey → envelope }` into the bundle structure
  (below), `algo`-stripped (M3), for serialization to a file.

### The admin route

`packages/selva/src/routes/api/definitions/[guid]/presolve/+server.ts` — content
surface (**not** `/admin`), following the canonical single-definition route shape
(`publish/+server.ts`):

- Gate: **`requireEditableDefinition(locals, guid)`** → `{ record, ctx, project }`,
  no instance-admin bypass. Prewarming triggers many solves; it's an edit-level
  operation on one's own definition.
- Refuse if `record.solveCacheLimit === 0` (non-cacheable → non-bakeable).
- Body: `{ mode: 'count' | 'prewarm' | 'bundle', channel?, versionId? }`.
  - `mode: 'count'` → enumerate only, return `{ count, estimate, skipped,
topContributors }`. Cheap, no solves — powers the confirm dialog.
  - `mode: 'prewarm' | 'bundle'` → run the engine once the count passed the ceiling.
- Resolve version + compute client exactly as `api/compute/+server.ts` does (share
  the resolution helpers), build the same `solveCache` hook, drive `runPresolve`.

**Progress reporting** ([#142](https://github.com/VektorNode/selva/issues/142)) —
no job/queue infra exists; all definition routes are synchronous. Two options,
decided with the combo ceiling: (a) cap combos low enough that a batch finishes
inside the HTTP timeout → **synchronous aggregate response** (matches every
existing route); or (b) allow larger spaces → **SSE-over-`ReadableStream`** from
`admin/api/system/update/+server.ts` (the only async-progress precedent), one
`data: {done,total,combo}` event per combo. Option (b) would be the first
streaming action on the content surface.

### The UI

`DefinitionEditDrawer.svelte`, **Details tab, beside the Solve cache limit field**
(same L2 cache it feeds). Follows the drawer's cover-image upload pattern: a local
`$state` busy flag + direct `fetch` to the presolve route + `toast`.

Flow: **Prewarm cache** → `fetch(mode:'count')` → confirm dialog (count, estimate,
skipped-inputs) → on confirm, `fetch(mode:'prewarm')` with a progress bar (streamed
or single busy→done per [#142](https://github.com/VektorNode/selva/issues/142)).
**Generate bundle** is the same flow with `mode:'bundle'`, ending in a file
download. Both disabled with a tooltip when `solveCacheLimit === 0`.

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
channel` — the memo's raw-values key is NOT definition-scoped, so the bundle key
  folds those three discriminators in (the viewer holds all three at solve time:
  `+page.svelte:75-79`).
- Entries are `algo`-stripped (M3) so each doesn't re-embed the multi-MB `.gh`.
- `formatVersion` + `computeContractVersion` gate compatibility: a viewer on a
  newer contract ignores an incompatible bundle and live-solves.

### The offline viewer read-path

**Driver-level interception (recommended)** — extend `createRequestResponseDriver`
(`@selvajs/ui`) with an optional bundle lookup `(values) => SolveResult |
undefined`, checked **beside the M2 memo** at `createSolveSession.svelte.ts:197-208`:

1. throttle picks the latest values →
2. **bundle lookup** (exact-match on the definition-scoped key) → hit reports the
   stored `SolveResult` with zero fetch (same `getReporter().report()` path a memo
   hit uses) →
3. miss → M2 memo → miss → `onSolve` (live `fetch('/api/compute')`).

Inherits `clearCache`/rebuild semantics and keeps the app's `onSolve`
(`library/[guid]/+page.svelte:47`) as the pure live-solve fallback — a bundle miss
just falls through. The bundle is loaded by the host page (file input or a
prewarm-published pointer) and passed to the driver.

`stableStringify` (`@selvajs/compute`) is importable client-side (already a selva
dep, `sideEffects: false`), so the viewer keys with the same serializer the bundle
was built with. (`hashSolveInput` is **not** client-side usable — it needs a
server-built dataTree — so both ends key on `stableStringify` over request
material, not the server's tree hash.)

---

## Build order (phased)

Each phase is independently shippable and testable; P5.1 gates the rest, P5.2 is
the MVP, P5.3+P5.4 are the download-and-run feature.

1. **P5.1 — enumerate engine + count/guardrail.** `enumerateInputSpace` +
   cartesian product + count + `skipped`/`topContributors`. Pure, fully
   unit-testable, no solving. Ships the `mode:'count'` route branch and the
   confirm-dialog data. **Smallest, highest-confidence slice.**
2. **P5.2 — prewarm (MVP).** `runPresolve` + `prewarmSink` (solve through the
   hooked pipeline → L2). Route `mode:'prewarm'` + UI button + confirm + progress.
   No file format, no viewer change. Transport (sync vs. SSE) + combo ceiling
   decided together in [#142](https://github.com/VektorNode/selva/issues/142).
3. **P5.3 — bundle build.** `bundleSink` + format serializer (`algo`-strip,
   manifest, gzip). Route `mode:'bundle'` → file download. UI "Generate bundle".
4. **P5.4 — offline viewer.** Bundle loader + driver-level lookup in `@selvajs/ui`;
   host wiring in the library viewer. Live-solve fallback on miss / incompatible
   contract. Distribution (loose file vs. version pointer) is
   [#141](https://github.com/VektorNode/selva/issues/141).

---

## Decisions & tracked questions

**Resolved inline:**

- **Checklists — always skip in v1.** `displayAs: 'checklist'` enumerates to the
  power set of options, exploding faster than a single-select cartesian product.
  Held at current value, reported in `skipped`. Opt-in enumeration with its own
  sub-cap can come later.
- **Estimate source.** Count×time estimate uses the solve-metric sink's
  per-definition median solve time when history exists, else a coarse default.
  Cosmetic; never blocks the action.

**Tracked as GitHub issues** (decide when the owning phase is picked up):

- **[#141](https://github.com/VektorNode/selva/issues/141) — bundle distribution**
  (loose file re-upload vs. published version pointer). Affects P5.4 host wiring,
  not the format.
- **[#142](https://github.com/VektorNode/selva/issues/142) — transport + combo
  ceiling** (`PRESOLVE_MAX_COMBOS` low enough for sync vs. content-surface SSE).
  Decide together; gates P5.2.
- **[#143](https://github.com/VektorNode/selva/issues/143) — re-bake on new
  version** (auto-invalidate / offer re-prewarm when a new live version publishes).
  Product decision, P5.2+; no correctness angle (`versionId`-keying already
  prevents stale serves).
