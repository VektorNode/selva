# Plans — implementation order

Plan files are named by descriptive slug (no number prefixes — the numbers used to imply an order
they didn't have). This index is the single source of truth for sequence. As of 2026-07-22.
`docs/plans/**` is internal-only (excluded from the published website).

## Status at a glance

| Plan                                                                                                                         | Status                                              | Track            |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------- |
| [data-access-efficiency-audit](./data-access-efficiency-audit.md)                                                            | open items remain (P2/P3 list)                      | B — efficiency   |
| [api-redesign-plan](./api-redesign-plan.md)                                                                                  | not started                                         | B — product      |
| [token-plan](./token-plan.md) (PATs)                                                                                         | not started, **blocked by api-redesign**            | B — product      |
| [presolve-bundle](./presolve-bundle.md)                                                                                      | not started (planning)                              | B — product      |
| [edge-overlay-open](./edge-overlay-open.md) — full plan [archived](./archive/edge-overlay-performance.md)                    | Phases 0–3 shipped                                  | B — residue      |
| [display-pipeline-open](./display-pipeline-open.md) — full audit [archived](./archive/display-pipeline-performance-audit.md) | most shipped; P1-C#/P3/fat-branch open              | B — residue      |
| [plugin-compat-gate](./plugin-compat-gate.md)                                                                                | not started (planning)                              | B — operator     |
| [visualization-package](./visualization-package.md)                                                                          | **COMPLETE** (2026-07-30) — all 8 steps             | **A — refactor** |
| [visualization-standalone](./visualization-standalone.md)                                                                    | **§1–§4 LANDED**; §5/§6 absorbed by solve-package   | **A — refactor** |
| [solve-package](./solve-package.md)                                                                                          | Phases 0–1 done; Phases 2–6 open                    | **A — refactor** |
| [caching-audit-2026-07](./caching-audit-2026-07.md)                                                                          | findings recorded; docs fixed, F1/F2/F3 open        | B — correctness  |
| [compute-package-cleanup](./compute-package-cleanup.md)                                                                      | not started, **unblocked** (viz-package done)       | **A — refactor** |
| [verify-slider-drag-solve-path](./verify-slider-drag-solve-path.md)                                                          | not started (measurement)                           | B — gate         |
| [drawing-layout-defects](./drawing-layout-defects.md)                                                                        | not started — **register, 14 confirmed + 19 leads** | B — correctness  |

## Hard dependencies

- ~~**compute-package-cleanup depends on visualization-package**~~ — **satisfied.**
  visualization-package is complete, so the `/visualization` barrel is already deleted and
  compute-package-cleanup is unblocked.
- ~~**visualization-package before any further edge/display code-edits**~~ — **satisfied.** Those
  files have moved. Note the new paths: `edges.ts` → `packages/visualization/src/render/edges.ts`
  (+ `render/edges/*`), `three-initializer.ts` → `render/scene-setup/*`, `batch-parser.ts` →
  `parse/webdisplay/`. Edge **Phase 4** and display residue now target `@selvajs/visualization`.
- ~~**visualization-package before presolve-bundle / the UI phases of api-redesign**~~ —
  **satisfied.** The session layer now lives at `@selvajs/visualization/session`; presolve edits
  `createRequestResponseDriver`/`createSolveSession` there.
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
- **caching-audit F1 is best measured before solve-package Phase 2** — it is the only open item that
  might be a live bug rather than a refactor, and Phase 2 touches the same GPU-ownership seam (C1).
  ~1 hour; not a blocker, but cheaper to resolve outside a large refactor than inside one.
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
4. **caching-audit F1** — measure the edge-cache growth (~1 hour). Independent; still open. Note Phase
   2 already fixed a _different_ GPU-ownership leak on the same seam (the memo's mesh clone shared
   `geometry.userData` by reference, so cloned geometries kept the geometry-cache flag and nothing ever
   disposed them).
5. **solve-package Phase 3** — `server/`: move the 8 solve-core files, keeping
   `@selvajs/server/compute`'s public surface intact via re-export shims (14 importers, two repos).
6. **solve-package Phase 4** — the client/server boundary guards: no root barrel, ESLint
   `no-restricted-imports`, one bundle test, `*.server.ts` naming.
7. **solve-package Phase 5** — unify M2 + L2 input hashing, now local to one package. Informed by
   [caching-audit](./caching-audit-2026-07.md) §F2. Unify the _derivation_, not the digest strength.
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
