-- ============================================================================
-- definitions.source_document_id
--
-- The Grasshopper document GUID from the schema Compute extracted at the last
-- upload that carried one. The plugin looks a file up by it to offer "new
-- version of …". A copied .gh keeps its GUID, so a match is a suggestion the
-- user confirms, never an identity.
--
-- Nullable: rows uploaded before this column, and files whose schema had no
-- GUID, simply don't match.
-- ============================================================================

alter table selva.definitions
	add column if not exists source_document_id uuid;

create index if not exists idx_definitions_source_document
	on selva.definitions(source_document_id)
	where source_document_id is not null and deleted_at is null;
