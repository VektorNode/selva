-- ============================================================================
-- `solve_metrics.failure_kind` names its source instead of listing kinds
--
-- No CHECK constraint holds the column to a set, so a kind added to
-- `SolveFailureKind` lands without a migration; a list written here goes stale.
-- ============================================================================

comment on column selva.solve_metrics.failure_kind is
	'Why the solve returned no result, or ''ok'' when it did: a SolveFailureKind from @selvajs/platform.';
