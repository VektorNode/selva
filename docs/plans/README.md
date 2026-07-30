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
- **visualization-standalone §5 before presolve-bundle** — §5 may relocate the whole session layer
  again (to `@selvajs/ui` or a new `@selvajs/session`) and §6 renames `createComputeThrottle` and
  changes `SolveResult`'s shape. presolve-bundle edits exactly those symbols. Settle §5 first, or
  expect to rebase.
- **visualization-standalone §3 is a public-API decision** — option 3b breaks
  `getThreeMeshesFromComputeResponse`, which the visualization-package changeset just published as
  the entry point. Decide before anything external depends on it.
- **token-plan depends on api-redesign** — PAT auth gates on the `/api/v1/` prefix; api-redesign
  Phases A/B before token-plan Phase 2.
- **verify-slider gates §B/§C audit items** (C3, C4, LB-1, B5-lb) — cheap measurement that may
  re-rank them or surface a user-facing 429 bug. Run before committing to those.

## Recommended order

0. ~~**visualization-package**~~ — **done 2026-07-30.** All five layers extracted; `@selvajs/compute`
   is pure solve/data with no `three` in any form.
1. **visualization-standalone** — decide §5 (where session goes) and §3 (envelope walk). §1/§2/§4 are
   mechanical and can land while §5 is still open; they remove 14 of the 15 `@selvajs/compute` import
   sites on their own.
2. **compute-package-cleanup** — unblocked, same tree/context as above. Split the remaining oversized
   files + API naming fixes. Low-risk now that the viewer weight is gone.
3. **verify-slider-drag** — one measurement session before spending on solve-path efficiency items.
4. **api-redesign → token-plan** — if external/machine/LLM access is the priority.
5. **plugin-compat-gate** — independent; when plugin-version drift becomes a support cost.
6. **presolve-bundle** — independent product feature; P5.1 (pure enumerate engine) is a small
   high-confidence start. Must come after visualization-standalone §5/§6 (same session symbols).
7. **data-access-efficiency-audit items** — slot cheap DB wins (2e/2f counts, 4g indexes, C3
   delete-the-size-log) opportunistically; B1–B4 scaling roadmap is post-launch.

## Tracks (can run in parallel across people)

- **Track A (refactor):** ~~visualization-package~~ → visualization-standalone →
  compute-package-cleanup. Self-contained in `@selvajs/compute`, `@selvajs/ui`,
  `@selvajs/visualization`.
- **Track B (product/efficiency):** verify-slider → api-redesign → token-plan; plus presolve-bundle,
  plugin-compat-gate, audit items independently. Anything in B that touches the **session layer**
  now waits for visualization-standalone §5/§6, not visualization-package.
