# Plans — implementation order

Plan files are named by descriptive slug (no number prefixes — the numbers used to imply an order
they didn't have). This index is the single source of truth for sequence. As of 2026-07-31.
`plans/` is internal-only (not Selva documentation — excluded from the published website) and lives
at the repo root, separate from `docs/`. Plans are grouped by kind:

- [`refactors/`](./refactors/) — structural, no user-facing behavior change (Track A).
- [`features/`](./features/) — new product surface (Track B).
- [`fixes/`](./fixes/) — defects, performance residue, and open audit items (Track B).
- [`archive/`](./archive/) — fully closed plans, kept for the reasoning.

## Status at a glance

| Plan                                                                                                                               | Status                                                                                 | Track            |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------- |
| [data-access-efficiency-audit](./fixes/data-access-efficiency-audit.md)                                                            | open items remain (P2/P3 list)                                                         | B — efficiency   |
| [api-redesign-plan](./features/api-redesign-plan.md)                                                                               | not started                                                                            | B — product      |
| [token-plan](./features/token-plan.md) (PATs)                                                                                      | not started, **blocked by api-redesign**                                               | B — product      |
| [presolve-bundle](./features/presolve-bundle.md)                                                                                   | not started (planning)                                                                 | B — product      |
| [display-pipeline-open](./fixes/display-pipeline-open.md) — full audit [archived](./archive/display-pipeline-performance-audit.md) | **all work shipped + verified 2026-07-31**; awaiting one live-Rhino check, then retire | B — residue      |
| [cloud-binary-transport](./features/cloud-binary-transport.md)                                                                     | not started, deliberately deferred ("when the traffic arrives")                        | B — product      |
| [plugin-compat-gate](./features/plugin-compat-gate.md)                                                                             | not started (planning)                                                                 | B — operator     |
| [compute-package-cleanup](./refactors/compute-package-cleanup.md)                                                                  | not started, **unblocked** (viz-package done)                                          | **A — refactor** |
| [admin-updates-yak-management](./features/admin-updates-yak-management.md)                                                         | design only, no implementation (planning)                                              | B — operator     |
| [dynamic-value-list-loop](./fixes/dynamic-value-list-loop.md)                                                                      | not started — traced 2026-07-31, GH fixture pending                                    | B — correctness  |

**Fully closed, moved to [`archive/`](./archive/)** — no residue. Kept for the _why_:

- [visualization-package](./archive/visualization-package.md) (all 8 steps) and
  [visualization-standalone](./archive/visualization-standalone.md) (§1–§4; §5/§6 absorbed by
  solve-package), both 2026-07-30. These hold the **GPU-ownership rules** —
  `CACHED_GEOMETRY_USERDATA_FLAG`, who disposes what, why `clearScene` skips cache-tagged geometry.
  Two separate leaks have now been found on that seam, so the rationale is worth keeping reachable.
- [edge-overlay-performance](./archive/edge-overlay-performance.md) (Phases 0–3, 2026-07-22; closed
  2026-07-31 by the GPU-visual check). Holds the **why behind the edge pipeline** — the per-mesh
  triangle cap (per-_mesh_, not scene-total), the worker + content-cache design, and why
  `clearEdges` exists as distinct from `removeEdges`. The verification run also found the
  `EdgesConfig` pass-through bug and repaired `pnpm example`, which the package move had broken.
  Phase 4 (Rhino-authored edges) was never residue: it is an unstarted optional fidelity track and
  gets its own plan if pursued.
- [solve-package](./archive/solve-package.md) (Phases 0–4 + 6, 2026-07-30/31; Phase 5 superseded by
  caching-simplification). `@selvajs/solve` now owns the whole "input change → solve result" chain on
  both sides of the wire. Holds the **client/server boundary rationale** — why there is no root
  barrel, and why the `@selvajs/server/compute` re-export shim was built and then deliberately
  removed (it left 14 of 24 exports borrowed, erasing the boundary the extraction existed to draw).
  Also records why L1 stays in `@selvajs/compute` and why `SolveResult.meshes` must stay opaque.
- [caching-audit-2026-07](./archive/caching-audit-2026-07.md) — every finding closed or rehomed:
  D1–D3 fixed, **F1 measured and fixed (a live GPU leak)**, F3 documented in
  [Caching.md](../docs/Caching.md), F2 absorbed by
  [caching-simplification](./archive/caching-simplification.md). Worth reading once: it found F1 by
  reading the caches **as a system**, which is the one class of bug a per-cache review cannot catch.
- [caching-simplification](./archive/caching-simplification.md) (all 4 phases, 2026-07-30) — ten
  cache names collapsed to three, the redundant L2 tier deleted (~840 lines), three env gates
  removed leaving two size knobs, and hit rates surfaced on `/admin/compute`. Holds the **reasoning
  for what was deliberately kept**: `ISolveResultCache` as the Redis seam, single-flight made
  unconditional, and `solveCacheLimit` left dormant rather than migrated away. Also records why
  merging the two definition caches was rejected — read it before reviving any of the three.

**Retired without being completed** — filed separately because it is not a success story:

- [verify-slider-drag-solve-path](./archive/verify-slider-drag-solve-path.md) (2026-07-31) — a
  measurement plan for the slider→solve path that **was never run**. Retired rather than left
  open, because an unactioned verification doc reads as a pending check when it is really an
  abandoned one. Two of its four claims closed on re-verification (single-flight was fixed in
  code; `incrementSolveCount` became audit item C11); the two that needed a live stack were folded
  into **C4** in [data-access-efficiency-audit](./fixes/data-access-efficiency-audit.md) as
  explicitly unverified caveats. **Worth reading for one thing only:** its headline number
  ("the 150ms debounce permits ~6.6 solves/sec") was itself a static-reading error — it ignored
  the trailing-edge debounce and the single-in-flight throttle that bound the real rate far
  lower — and it survived two weeks inside the very document written to warn against
  static-reading errors. Treat code-reading claims about the solve path with corresponding
  suspicion.

## Hard dependencies

- ~~**compute-package-cleanup depends on visualization-package**~~ — **satisfied.**
  visualization-package is complete, so the `/visualization` barrel is already deleted and
  compute-package-cleanup is unblocked.
- ~~**visualization-package before any further edge/display code-edits**~~ — **satisfied.** Those
  files have moved. Note the new paths: `edges.ts` → `packages/visualization/src/render/edges.ts`
  (+ `render/edges/*`), `three-initializer.ts` → `render/scene-setup/*`, `batch-parser.ts` →
  `parse/webdisplay/`. Edge **Phase 4** and display residue now target `@selvajs/visualization`.
- ~~**visualization-package before presolve-bundle / the UI phases of api-redesign**~~ —
  **satisfied.** (The session layer has since moved again, to `@selvajs/solve/client` — see the
  solve-package Phase 2 entry below for the path presolve-bundle should target.)
- ~~**visualization-standalone §3 is a public-API decision**~~ — **settled: option 3a.** The envelope
  is declared structurally in `parse/webdisplay/response-envelope.ts`; no API broke.
- ~~**visualization-standalone §5 before presolve-bundle**~~ — **superseded.** §5 resolved to option C
  (session stays put for now) and handed off to solve-package, which moves it to
  **`@selvajs/solve/client`** — not `@selvajs/ui` and not a `@selvajs/session` package (both
  rejected). The real dependency is the one below.
- ~~**solve-package Phase 2 before presolve-bundle**~~ — **satisfied 2026-07-30.** The session layer
  now lives at `@selvajs/solve/client`; the throttle is `createAsyncThrottle`; `SolveResult<TMesh>` is
  opaque. presolve-bundle edits `createRequestResponseDriver`/`createSolveSession` — rebase onto their
  new home before starting.
- ~~**solve-package Phase 3 before its Phase 5**~~ — **moot.** Phase 5 was superseded by
  caching-simplification, which collapsed the tiers rather than unifying their hash derivations.
- ~~**caching-audit F1 is best measured before solve-package Phase 2**~~ — ✅ **resolved 2026-07-30.**
  Measured and fixed: it was a live GPU leak (400 line geometries after 50 solves instead of 8),
  closed by having `clearScene` release edge-cache entries. It was the only audit item that turned
  out to be a bug rather than a refactor. No longer an ordering constraint.
- **token-plan depends on api-redesign** — PAT auth gates on the `/api/v1/` prefix; api-redesign
  Phases A/B before token-plan Phase 2.
- **verify-slider gates §B/§C audit items** (C3, C4, LB-1, B5-lb) — cheap measurement that may
  re-rank them or surface a user-facing 429 bug. Run before committing to those.

## Recommended order

### Track A — the package-boundary refactor, in order

This is the one sequence that matters right now; the rest of the list is independent of it.

0. ~~**visualization-package**~~ — **done 2026-07-30.** All five layers extracted; `@selvajs/compute`
   holds no `three` in any form.
1. ~~**visualization-standalone §1/§2/§4** (+ §3 as option 3a)~~ — **done 2026-07-30**, independently
   cross-validated. `@selvajs/visualization` no longer depends on `@selvajs/compute` at all.
2. ~~**solve-package Phase 1** — scaffold `packages/solve` + `shared/`~~ — **done 2026-07-30.**
3. ~~**solve-package Phase 2** — `client/`~~ — **done 2026-07-30.** 7 source + 5 test files moved,
   **C1** (opaque `SolveResult<TMesh>` + injected `MeshPolicy`) and **C2** (`createAsyncThrottle`)
   applied. `@selvajs/visualization` is now mesh-conversion + viewer only, and depends on nothing from
   Selva. Phase 4's ESLint guard landed here too, since `client/` arriving is what made it enforceable.
4. ~~**caching-audit F1** — measure the edge-cache growth (~1 hour).~~ — **done 2026-07-30.** It grew
   unboundedly: 400 live line geometries after 50 solves instead of 8, because `clearScene` detached
   overlays without ever decrementing a refcount, and the geometry cache had made the WeakMap's
   "source becomes unreachable" premise false. Fixed with a `releaseEdgeGeometryFor` hook. This is the
   **second** GPU-ownership leak found on the same seam — Phase 2 fixed the memo's mesh clone sharing
   `geometry.userData` by reference. Both were cross-cache interactions, not per-cache defects.
5. ~~**solve-package Phase 3** — `server/`~~ — **done 2026-07-30.** All 8 solve-core files moved; the
   8 movers had zero import edges to the 4 stayers, so the cut needed no untangling. The planned
   re-export shim **was built and then deliberately removed**: it left `@selvajs/server/compute` at 24
   exports of which 14 were borrowed, so the package's surface no longer described what it did.
   `@selvajs/server` therefore goes **major** and no longer depends on `@selvajs/solve` at all.
6. ~~**solve-package Phase 4** — client/server boundary guards~~ — **done 2026-07-30.** No root
   barrel, ESLint `no-restricted-imports` on `src/client/**`, and a bundle test over the shipped
   `dist/client.js`. `*.server.ts` naming deliberately **not** applied inside the package — it is a
   SvelteKit convention, and renaming 8 files would break their `git mv` rename records for no gain.
7. ~~**solve-package Phase 5**~~ — **superseded** by
   [caching-simplification](./archive/caching-simplification.md), which collapsed the cache tiers
   instead of unifying three hash derivations across tiers that overlapped.
8. ~~**solve-package Phase 6** — verify~~ — **done 2026-07-31.** `type-check` / `lint` (0 errors) /
   `test` green in-repo. The Parafa half is tracked in the Parafa repo: it still imports the solve
   core from `@selvajs/server/compute` and needs `@selvajs/solve` added, plus two call sites still
   using the removed `extractMeshesFromResponse` (breakage independent of this plan).
9. **compute-package-cleanup** — **now unblocked.** Same tree, low-risk once the viewer weight and
   the solve core are both gone.

### Track B — independent of the above

- **verify-slider-drag** — one measurement session before spending on solve-path efficiency items.
- **dynamic-value-list-loop** — session-level reconciler + E2E tests; touches `@selvajs/solve/client`,
  which is now its landed home. GH fixture user-supplied.
- **api-redesign → token-plan** — if external/machine/LLM access is the priority.
- **plugin-compat-gate** — when plugin-version drift becomes a support cost.
- **admin-updates-yak-management** — Track A (scheduled updates + rollback UX) has no
  dependencies and can ship first; Track B (Yak install API) needs **plugin-compat-gate**
  implemented first (extends its `PLUGIN_CAPABILITIES` table) and a contract from the
  Rhino.Compute repo (out of scope here).
- **presolve-bundle** — product feature; P5.1 (pure enumerate engine) is a small high-confidence
  start. Its Phase 2 blocker is cleared; rebase its session edits onto `@selvajs/solve/client`.
- **data-access-efficiency-audit items** — slot cheap DB wins (2e/2f counts, 4g indexes, C3
  delete-the-size-log) opportunistically; B1–B4 scaling roadmap is post-launch.
- **caching-audit F2/F3** — F2 was absorbed by caching-simplification; F3 is an operator-doc note.

## Tracks (can run in parallel across people)

- **Track A (refactor):** ~~visualization-package~~ → ~~visualization-standalone~~ →
  ~~solve-package~~ → **compute-package-cleanup** (the only step left). The completed steps touched
  `@selvajs/visualization`, `@selvajs/server`, `@selvajs/ui` and the new `@selvajs/solve`.
  **Not parallelizable within itself** — each phase moved files the next one edits.
- **Track B (product/efficiency):** verify-slider → api-redesign → token-plan; plus plugin-compat-gate
  and audit items independently. Anything in B that touches the **session layer** should now target
  `@selvajs/solve/client` — that is where `createSolveSession`, the throttle and `SolveResult` live.
