-- ============================================================================
-- Cache the compute-extracted UI schema on each definition version.
--
-- The render path used to re-fetch the schema from Rhino.Compute on every load;
-- it is now extracted + validated once at upload and stored here.
--
-- `change_note` is added in the same migration: it is referenced by
-- SupabaseDefinitionStore (versionToRow / rowToVersion) but was never created
-- by 0001_initial.sql — this closes that drift.
-- ============================================================================

alter table selva.definition_versions
	add column if not exists change_note text,
	add column if not exists schema jsonb,
	add column if not exists schema_extracted_at timestamptz;
