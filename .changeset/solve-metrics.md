---
'@selvajs/platform': minor
'@selvajs/supabase-provider': minor
'@selvajs/selva': minor
---

Capture per-solve timing and outcome telemetry.

- **platform**: new pluggable `ISolveMetricSink` provider (`SelvaConfig.solveMetrics`, defaults to `NoopSolveMetricSink`). A `SolveMetric` records the solve's wall-clock `durationMs`, `ok`, a `failureKind` (`timeout` | `client_abort` | `rate_limited` | `share_cap` | `too_large` | `compute_error` | `ok`), Grasshopper `errorCount`/`warningCount`, and attribution: `definitionId` + `versionId` (so timings compare across definition versions), `orgId`, and `channel`. Adds the `runSolveMetricSinkConformance` testing suite.
- **supabase-provider**: `SupabaseSolveMetricSink` persists every solve to the new `selva.solve_metrics` table (with the triggering user in `actor_id`). Exposed off `SupabaseDataProvider` so it wires automatically when the Supabase data provider is selected. Includes the migration and a conformance test.
- **selva**: the compute route now records one metric per solve attempt — including attempts rejected before the solve runs (rate limit, share-link cap) — and distinguishes a genuine solve timeout from a client disconnect. A successful solve of a local definition also bumps that definition's `solveCount` (the "N runs" stat shown on definition cards/lists), which was previously never incremented.
