# Plans — implementation order

Plan files are named by descriptive slug (no number prefixes — the numbers used to imply an order
they didn't have). This index is the single source of truth for sequence. As of 2026-07-22.
`docs/plans/**` is internal-only (excluded from the published website).

## Status at a glance

| Plan                                                                                                                         | Status                                            | Track            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------- |
| [data-access-efficiency-audit](./data-access-efficiency-audit.md)                                                            | open items remain (P2/P3 list)                    | B — efficiency   |
| [api-redesign-plan](./api-redesign-plan.md)                                                                                  | not started                                       | B — product      |
| [token-plan](./token-plan.md) (PATs)                                                                                         | not started, **blocked by api-redesign**          | B — product      |
| [presolve-bundle](./presolve-bundle.md)                                                                                      | not started (planning)                            | B — product      |
| [edge-overlay-open](./edge-overlay-open.md) — full plan [archived](./archive/edge-overlay-performance.md)                    | Phases 0–3 shipped                                | B — residue      |
| [display-pipeline-open](./display-pipeline-open.md) — full audit [archived](./archive/display-pipeline-performance-audit.md) | most shipped; P1-C#/P3/fat-branch open            | B — residue      |
| [plugin-compat-gate](./plugin-compat-gate.md)                                                                                | not started (planning)                            | B — operator     |
| [visualization-package](./visualization-package.md)                                                                          | not started                                       | **A — refactor** |
| [compute-package-cleanup](./compute-package-cleanup.md)                                                                      | not started, **depends on visualization-package** | **A — refactor** |
| [verify-slider-drag-solve-path](./verify-slider-drag-solve-path.md)                                                          | not started (measurement)                         | B — gate         |

## Hard dependencies

- **compute-package-cleanup depends on visualization-package** — its step 1 ("delete the
  `/visualization` barrel") is done as part of visualization-package, and both edit the same
  `@selvajs/compute` src tree. Never parallel; visualization-package first.
- **visualization-package before any further edge/display code-edits** — the edge-overlay and
  display-pipeline files (`edges.ts`, `three-initializer.ts`, `batch-parser.ts`, webdisplay/…) get
  relocated by it. Their open residue is safe (visual-verify = no code; P1-C#/P3 = C#/cloud transport,
  not the moved TS). But edge **Phase 4** or any new work in those files should land **after** the
  move, or rebase across it.
- **visualization-package before presolve-bundle, and before the UI phases of api-redesign** —
  presolve edits `createRequestResponseDriver`/`createSolveSession` and api-redesign edits ~15 UI
  fetch sites; visualization-package relocates the session layer to `@selvajs/visualization`. Move
  first, then edit.
- **token-plan depends on api-redesign** — PAT auth gates on the `/api/v1/` prefix; api-redesign
  Phases A/B before token-plan Phase 2.
- **verify-slider gates §B/§C audit items** (C3, C4, LB-1, B5-lb) — cheap measurement that may
  re-rank them or surface a user-facing 429 bug. Run before committing to those.

## Recommended order

1. **visualization-package** — extract `@selvajs/visualization`. Do first: the compute + viewer tree
   is currently clean (0 dirty files), it unblocks compute-package-cleanup, and de-risks every later
   parse/render/session edit.
2. **compute-package-cleanup** — immediately after. Same tree, same context. Split the 5 oversized
   files + API naming fixes. Mechanical, low-risk once the viewer weight is gone.
3. **verify-slider-drag** — one measurement session before spending on solve-path efficiency items.
4. **api-redesign → token-plan** — if external/machine/LLM access is the priority.
5. **plugin-compat-gate** — independent; when plugin-version drift becomes a support cost.
6. **presolve-bundle** — independent product feature; P5.1 (pure enumerate engine) is a small
   high-confidence start. Must come after visualization-package (touches the session layer).
7. **data-access-efficiency-audit items** — slot cheap DB wins (2e/2f counts, 4g indexes, C3
   delete-the-size-log) opportunistically; B1–B4 scaling roadmap is post-launch.

## Tracks (can run in parallel across people)

- **Track A (refactor):** visualization-package → compute-package-cleanup. Self-contained in
  `@selvajs/compute`, `@selvajs/ui`, new `@selvajs/visualization`. Do this now.
- **Track B (product/efficiency):** verify-slider → api-redesign → token-plan; plus presolve-bundle,
  plugin-compat-gate, audit items independently. Anything in B that touches the session layer or
  `@selvajs/ui` compute code waits for visualization-package.
