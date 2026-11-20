-- ============================================================================
-- The values saved in each definition version's file
--
-- `saved_values` maps input ids to the values the .gh was saved with, as
-- Rhino.Compute read them. A page renders them as the form's defaults from
-- here, so it never waits on Compute for them. Read one row at a time, like
-- `schema`; the list projection leaves it out.
--
-- Rows written before this stay null; the app reads their values from Compute
-- once and writes them here.
-- ============================================================================

alter table selva.definition_versions
	add column if not exists saved_values jsonb;
