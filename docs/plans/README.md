# Plans — implementation order

Plan files are named by descriptive slug (no number prefixes — the numbers used to imply an order
they didn't have). This index is the single source of truth for sequence. As of 2026-07-22.
`docs/plans/**` is internal-only (excluded from the published website).

## Status at a glance

| Plan                                                                                                                         | Status                                               | Track            |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------- |
| [data-access-efficiency-audit](./data-access-efficiency-audit.md)                                                            | open items remain (P2/P3 list)                       | B — efficiency   |
| [api-redesign-plan](./api-redesign-plan.md)                                                                                  | not started                                          | B — product      |
| [token-plan](./token-plan.md) (PATs)                                                                                         | not started, **blocked by api-redesign**             | B — product      |
| [presolve-bundle](./presolve-bundle.md)                                                                                      | not started (planning)                               | B — product      |
| [edge-overlay-open](./edge-overlay-open.md) — full plan [archived](./archive/edge-overlay-performance.md)                    | Phases 0–3 shipped                                   | B — residue      |
| [display-pipeline-open](./display-pipeline-open.md) — full audit [archived](./archive/display-pipeline-performance-audit.md) | most shipped; P1-C#/P3/fat-branch open               | B — residue      |
| [plugin-compat-gate](./plugin-compat-gate.md)                                                                                | not started (planning)                               | B — operator     |
| [solve-package](./solve-package.md)                                                                                          | Phases 0–4 done; Phase 5 (hashing) + 6 (Parafa) open | **A — refactor** |
| [caching-simplification](./caching-simplification.md)                                                                        | proposed — supersedes solve-package Phase 5          | B — correctness  |
| [compute-package-cleanup](./compute-package-cleanup.md)                                                                      | not started, **unblocked** (viz-package done)        | **A — refactor** |
| [verify-slider-drag-solve-path](./verify-slider-drag-solve-path.md)                                                          | not started (measurement)                            | B — gate         |
| [drawing-layout-defects](./drawing-layout-defects.md)                                                                        | not started — **register, 14 confirmed + 19 leads**  | B — correctness  |

**Fully closed, moved to [`archive/`](./archive/)** — no residue, unlike edge-overlay and
display-pipeline. Kept for the _why_:

- [visualization-package](./archive/visualization-package.md) (all 8 steps) and
  [visualization-standalone](./archive/visualization-standalone.md) (§1–§4; §5/§6 absorbed by
  solve-package), both 2026-07-30. These hold the **GPU-ownership rules** —
  `CACHED_GEOMETRY_USERDATA_FLAG`, who disposes what, why `clearScene` skips cache-tagged geometry.
  Two separate leaks have now been found on that seam, so the rationale is worth keeping reachable.
- [caching-audit-2026-07](./archive/caching-audit-2026-07.md) — every finding closed or rehomed:
  D1–D3 fixed, **F1 measured and fixed (a live GPU leak)**, F3 documented in
  [Caching.md](../Caching.md), F2 absorbed by [caching-simplification](./caching-simplification.md).
  Worth reading once: it found F1 by reading the caches **as a system**, which is the one class of
  bug a per-cache review cannot catch.

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
- **solve-package Phase 3 before its Phase 5** — the hash unification needs both halves in one
  package. Doing it earlier means merging three hashes across three packages, then relocating two of
  them: the same merge twice.
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
5. **solve-package Phase 3** — `server/`: move the 8 solve-core files, keeping
   `@selvajs/server/compute`'s public surface intact via re-export shims (14 importers, two repos).
6. **solve-package Phase 4** — the client/server boundary guards: no root barrel, ESLint
   `no-restricted-imports`, one bundle test, `*.server.ts` naming.
7. **solve-package Phase 5** — unify M2 + L2 input hashing, now local to one package. Informed by
   [caching-audit](./archive/caching-audit-2026-07.md) §F2. Unify the _derivation_, not the digest strength.
8. **solve-package Phase 6** — verify: `build`/`check`/`test`, then **build Parafa against the local
   packages** (the only real test of the shims), then changesets.
9. **compute-package-cleanup** — after Track A settles. Same tree, low-risk once the viewer weight and
   the solve core are both gone.

### Track B — independent of the above

- **verify-slider-drag** — one measurement session before spending on solve-path efficiency items.
- **api-redesign → token-plan** — if external/machine/LLM access is the priority.
- **plugin-compat-gate** — when plugin-version drift becomes a support cost.
- **presolve-bundle** — product feature; P5.1 (pure enumerate engine) is a small high-confidence
  start. Its Phase 2 blocker is cleared; rebase its session edits onto `@selvajs/solve/client`.
- **data-access-efficiency-audit items** — slot cheap DB wins (2e/2f counts, 4g indexes, C3
  delete-the-size-log) opportunistically; B1–B4 scaling roadmap is post-launch.
- **caching-audit F2/F3** — F2 folds into solve-package Phase 5; F3 is an operator-doc note.

## Tracks (can run in parallel across people)

- **Track A (refactor):** ~~visualization-package~~ → ~~visualization-standalone~~ →
  **solve-package** (~~Phase 2~~ → Phases 3–6) → compute-package-cleanup. Touches `@selvajs/visualization`,
  `@selvajs/server`, `@selvajs/ui`, new `@selvajs/solve`. **Not parallelizable within itself** — each
  phase moves files the next one edits.
- **Track B (product/efficiency):** verify-slider → api-redesign → token-plan; plus plugin-compat-gate
  and audit items independently. Anything in B that touches the **session layer** should now target
  `@selvajs/solve/client` — that is where `createSolveSession`, the throttle and `SolveResult` live.
