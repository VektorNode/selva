-- ============================================================================
-- What each definition version holds beyond its form
--
-- `inventory` is the plugin's DocumentInventory: plugins, components, values set
-- on the canvas, script fingerprints (never source) and wiring. It is read one
-- row at a time, like `schema`. `inventory_summary` is the small part the
-- version list shows (plugins missing on the server, obsolete components), so
-- the list projection never pulls the inventory itself.
--
-- Rows written before this stay null; the app reads them as "not available".
-- ============================================================================

alter table selva.definition_versions
	add column if not exists inventory jsonb,
	add column if not exists inventory_summary jsonb;
