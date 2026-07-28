-- ============================================================================
-- Expose the cached schema's format version as a queryable column (ADR 0005).
--
-- The stored `schema` blob is a disposable cache of the compute-extracted UI
-- schema; its embedded `schemaVersion` says which schema format it was written
-- in. A GENERATED column keeps that version queryable for ops ("how many
-- versions are stale?") with zero write-path involvement — it can never drift
-- from the blob, and rows whose schema is NULL (pre-caching uploads) yield
-- NULL. The web render path re-extracts from compute on version mismatch; it
-- reads the version from the blob itself, not from this column.
-- ============================================================================

alter table selva.definition_versions
	add column if not exists schema_version text
		generated always as (schema ->> 'schemaVersion') stored;

comment on column selva.definition_versions.schema_version is
	'Schema format version of the cached `schema` blob (generated from schema->>''schemaVersion''). NULL when no schema is cached. Ops/diagnostics only — the app reads the version from the blob.';
