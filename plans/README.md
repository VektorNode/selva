# Plans — what's open, what's done

Plan files are named by descriptive slug. **Status lives on the issue tracker, not here** — this
index just maps each plan to the issue that tracks it. See [CONVENTIONS.md](./CONVENTIONS.md).

Everything below was verified against the source tree on 2026-08-16, not taken from the plans' own
headers, several of which were badly wrong in both directions.

`plans/` is internal-only (not Selva documentation — excluded from the published website) and lives
at the repo root, separate from `docs/`.

- [`features/`](./features/) — new product surface.
- [`fixes/`](./fixes/) — defects, performance residue, and open audit items.
- [`archive/`](./archive/) — closed plans, kept for the reasoning.

## What to pick up

**Go to [the board](https://github.com/orgs/VektorNode/projects/2), not this file.** Issues own
status, assignment and priority; plans own the reasoning. See [CONVENTIONS.md](./CONVENTIONS.md)
for why, and read it before adding a plan.

Sorted by Priority then Effort, the board's top rows are the work worth starting. As of
2026-08-16 that is #195 (org-admin privilege escalation) and #202 (the pm2 staging test) — both
High priority, low effort.

Each plan below links to its tracking issue at the top of the file.

| Plan                                                                            | Tracked in                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [selva-app-security-audit](./fixes/selva-app-security-audit.md)                 | [#194](https://github.com/VektorNode/selva/issues/194) (6 sub-issues)                                                                                                                                                       |
| [api-v1-residuals](./fixes/api-v1-residuals.md)                                 | [#201](https://github.com/VektorNode/selva/issues/201)                                                                                                                                                                      |
| [host-prerequisites-and-pm2-audit](./fixes/host-prerequisites-and-pm2-audit.md) | [#202](https://github.com/VektorNode/selva/issues/202)                                                                                                                                                                      |
| [data-access-efficiency-audit](./fixes/data-access-efficiency-audit.md)         | [#203](https://github.com/VektorNode/selva/issues/203) (cheap wins only)                                                                                                                                                    |
| [dynamic-value-list-loop](./fixes/dynamic-value-list-loop.md)                   | [#208](https://github.com/VektorNode/selva/issues/208) (5 phases)                                                                                                                                                           |
| [token-plan](./features/token-plan.md)                                          | [#97](https://github.com/VektorNode/selva/issues/97) + [#214](https://github.com/VektorNode/selva/issues/214)/[#215](https://github.com/VektorNode/selva/issues/215)/[#216](https://github.com/VektorNode/selva/issues/216) |
| [admin-updates-yak-management](./features/admin-updates-yak-management.md)      | [#217](https://github.com/VektorNode/selva/issues/217) — Track A only                                                                                                                                                       |
| [plugin-compat-gate](./features/plugin-compat-gate.md)                          | [#218](https://github.com/VektorNode/selva/issues/218)                                                                                                                                                                      |
| [presolve-bundle](./features/presolve-bundle.md)                                | **unfiled** — parked on a storage decision                                                                                                                                                                                  |
| [cloud-binary-transport](./features/cloud-binary-transport.md)                  | **unfiled** — deliberately deferred                                                                                                                                                                                         |

The last two have no issue on purpose: an issue for work nobody can start is noise. They stay as
design documents until something unblocks them.

## Closed since the last index

Three plans were marked "not started" here while being substantially or entirely finished, and two
more were listed at paths that no longer exist. All are now accounted for:

- **[api-redesign-plan](./archive/api-redesign-plan.md)** — Phases A–E all shipped. `/api/v1/*` is
  the single versioned surface for browser and tokens, with an OpenAPI spec and a conformance test.
  Four residuals extracted to [api-v1-residuals](./fixes/api-v1-residuals.md).
- **[solve-result-host-seam](./archive/solve-result-host-seam.md)** — shipped and released. The
  host reads the result via a `getLastResult` getter on `onReady`; the `onSolveResult` callback
  alternative was rejected.
- **[compute-package-cleanup](./archive/compute-package-cleanup.md)** — all 8 steps done
  (2026-07-31), but **two pre-publish checks it deliberately left open still appear unclosed**:
  grep parafa and parapet for the five removed symbols (`processInputs` and `getValues` are the
  weakest-evidence cuts, and neither repo is in this monorepo's CI), and diff the published
  `3.1.1` tarball rather than a local build. Both are cross-repo and unverifiable from here — close
  them explicitly or they will read as done forever. Minor residue: `examples/simple_example.ts`
  still imports `../src/grasshopper` rather than the package name, and the changeset the plan
  points at was consumed by a release — the removed-symbol record is now in
  `packages/compute/CHANGELOG.md`.
- **solve-fn-raw-response** and **solve-engine-facade** — both **deleted from `features/`, not
  archived**, in commit `b9c9d6a6`, while still listed in this index. The first shipped in
  `@selvajs/solve@0.2.0-beta.4` (`64c954ef`); the second was an unstarted proposal, so its deletion
  discarded a design rather than a record. Recoverable from git history if either is wanted back.
  Separately, the `plans/refactors/` directory is gone — it only ever held compute-package-cleanup.

Earlier closures, kept for the _why_ — these hold reasoning that is still load-bearing:

- [visualization-package](./archive/visualization-package.md) and
  [visualization-standalone](./archive/visualization-standalone.md) — the **GPU-ownership rules**:
  `CACHED_GEOMETRY_USERDATA_FLAG`, who disposes what, why `clearScene` skips cache-tagged geometry.
  Two separate leaks have been found on that seam.
- [solve-package](./archive/solve-package.md) — the **client/server boundary rationale**: why there
  is no root barrel, and why the `@selvajs/server/compute` re-export shim was built and then
  deliberately removed (it left 14 of 24 exports borrowed, erasing the boundary the extraction
  existed to draw).
- [caching-simplification](./archive/caching-simplification.md) — ten cache names collapsed to
  three, the redundant L2 tier deleted (~840 lines). Records **what was deliberately kept** and why
  merging the two definition caches was rejected. Read before reviving any of them.
- [caching-audit-2026-07](./archive/caching-audit-2026-07.md) — found a live GPU leak (F1) by
  reading the caches **as a system**, which is the one class of bug a per-cache review cannot catch.
  **Its F2 is still marked open in its own header**, cross-referenced as solve-package Phase 5 —
  which was then superseded by caching-simplification, which collapsed the tiers instead of
  unifying their hash derivations. Nobody closed F2 against that; it is probably moot, but it is
  the one loose thread in an otherwise closed plan.
- [display-pipeline-open](./archive/display-pipeline-open.md) (+ its
  [full audit](./archive/display-pipeline-performance-audit.md)) and
  [edge-overlay-performance](./archive/edge-overlay-performance.md) — the **why behind the edge
  pipeline**: the per-_mesh_ triangle cap, the worker + content-cache design, why `clearEdges` is
  distinct from `removeEdges`. Edge Phase 4 (Rhino-authored edges) was never residue — it's an
  unstarted optional fidelity track and gets its own plan if pursued.
- [compute-monorepo-import](./archive/compute-monorepo-import.md).

**Retired without being completed**, filed separately because it is not a success story:

- [verify-slider-drag-solve-path](./archive/verify-slider-drag-solve-path.md) — a measurement plan
  that **was never run**. Its two live-stack claims folded into **C4** in
  [data-access-efficiency-audit](./fixes/data-access-efficiency-audit.md) as explicitly unverified.
  **Worth reading for one thing:** its headline number ("the 150ms debounce permits ~6.6
  solves/sec") was itself a static-reading error — it ignored the trailing-edge debounce and the
  single-in-flight throttle — and it survived two weeks inside the very document written to warn
  against static-reading errors. Treat code-reading claims about the solve path with corresponding
  suspicion.

## Why the statuses were wrong

Worth knowing, because it will happen again. Every error ran in the same direction as the reader's
attention: **plans that got worked on stopped being updated**, while plans nobody touched kept
accurate headers. The security audit and the value-list plan described themselves perfectly; the
two plans that shipped still said "not started".

A second failure mode is subtler and hit three plans: **adjacent work moved the ground without
closing the item.** api-redesign renamed the routes that data-access-efficiency cites, so its
findings read as fixed when only the paths changed. plugin-compat-gate's headline example
(curves vanishing silently) got fixed incidentally, undercutting the argument while leaving the
problem real at three other sites. C3's "cheapest win" was not fixed — it relocated.

So: **verify against the tree before trusting a status line here, including this one.** Re-verify
whenever a plan's citations start failing to resolve; that is the earliest signal that a plan has
drifted from the code rather than the code from the plan.
