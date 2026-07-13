-- ============================================================================
-- Per-definition durable solve-cache quota (caching Phase 3 / R9)
-- ============================================================================
--
-- `solve_cache_limit` is the definition's L2 solve-cache policy, one number:
--   NULL → inherit the global default (SOLVE_CACHE_DEFAULT_MAX_ENTRIES)
--   0    → caching off for this definition (non-determinism / wide-input escape hatch)
--   N    → keep at most N cached solves for this definition
--
-- Nullable, no default: an absent value MEANS inherit, so existing rows need no
-- backfill — they simply inherit the global default until an author sets a value.

alter table selva.definitions
	add column if not exists solve_cache_limit integer
	check (solve_cache_limit is null or solve_cache_limit >= 0);
