-- ============================================================================
-- solve_metrics
-- Per-solve timing telemetry. One row per solve attempt, written by
-- `SupabaseSolveMetricSink` from the compute route AFTER each solve resolves
-- or rejects. `duration_ms` is wall time around the Rhino.Compute solve call
-- only — it excludes definition loading, auth, schema work, and serialization.
--
-- Append-only from the application's point of view: the sink inserts, nothing
-- updates or deletes. Failed/timed-out solves are recorded with ok = false.
-- ============================================================================

create table if not exists selva.solve_metrics (
	id uuid primary key default gen_random_uuid(),
	-- The user who triggered the solve, or 'system' for share-link / server flows.
	actor_id text not null,
	definition_url text not null,
	-- Local definition + the exact version solved; null for remote-URL solves.
	-- Plain ids (not FKs) so a deleted definition does not cascade away its history.
	definition_id uuid,
	version_id uuid,
	channel text not null,
	org_id uuid,
	duration_ms double precision not null,
	ok boolean not null,
	-- Why the solve did not return a result; 'ok' when it did. Mirrors
	-- SolveFailureKind: ok | timeout | client_abort | rate_limited | share_cap |
	-- too_large | compute_error.
	failure_kind text not null default 'ok',
	-- Grasshopper runtime error/warning counts from the solve response. A solve
	-- can be ok yet still report component errors (error_count > 0).
	error_count integer not null default 0,
	warning_count integer not null default 0,
	occurred_at timestamptz not null default now()
);

create index if not exists solve_metrics_occurred_at_idx
	on selva.solve_metrics (occurred_at desc);

create index if not exists solve_metrics_org_occurred_at_idx
	on selva.solve_metrics (org_id, occurred_at desc);

create index if not exists solve_metrics_definition_occurred_at_idx
	on selva.solve_metrics (definition_url, occurred_at desc);

-- Per-version timing comparisons ("is this version slower than the last?").
create index if not exists solve_metrics_version_occurred_at_idx
	on selva.solve_metrics (version_id, occurred_at desc);

-- Filter failures fast for error-rate dashboards.
create index if not exists solve_metrics_failure_kind_idx
	on selva.solve_metrics (failure_kind, occurred_at desc);

-- RLS: writes always go through service-role (the sink uses the service
-- client). Authenticated users have NO read access today — an operator-facing
-- metrics UI would land later with its own instance_admin-only policy.
alter table selva.solve_metrics enable row level security;
