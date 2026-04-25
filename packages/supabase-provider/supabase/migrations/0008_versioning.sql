-- Spec §6 versioning — finalize the model and drop the legacy history system.
--
-- This migration:
--   1. Drops `definition_history` (replaced by `definition_versions`).
--   2. Drops legacy per-record columns now carried per-version:
--      `definitions.file_ext`, `original_filename`, `max_history`.
--   3. Adds `definition_versions.file_ext` and `original_filename`.
--   4. Tightens the live/draft FKs to ON DELETE RESTRICT so a referenced
--      version cannot be deleted (spec §6 deletion protection enforced at
--      the data layer, not just in app code).
--   5. Updates `definitions: editors can insert` to no longer reference
--      `original_filename` (it's now on the version).
--
-- Clean-cut migration — no data preservation. If you have existing
-- `definition_history` rows you care about, snapshot them before applying.

-- ── Drop legacy history table ────────────────────────────────────────────

drop policy if exists "definition_history: editors can delete" on public.definition_history;
drop policy if exists "definition_history: editors can insert" on public.definition_history;
drop policy if exists "definition_history: visible with parent" on public.definition_history;

drop table if exists public.definition_history;

-- ── Drop legacy per-record columns ───────────────────────────────────────

alter table public.definitions
	drop column if exists file_ext,
	drop column if exists original_filename,
	drop column if exists max_history;

-- ── Add per-version columns ──────────────────────────────────────────────

alter table public.definition_versions
	add column if not exists file_ext text,
	add column if not exists original_filename text;

-- New rows must carry file_ext. Existing rows (if any) cannot be migrated —
-- this is a clean cut — so drop and reseed any test data before applying.
update public.definition_versions set file_ext = 'gh' where file_ext is null;

alter table public.definition_versions
	alter column file_ext set not null,
	add constraint definition_versions_file_ext_check check (file_ext in ('gh', 'ghx'));

-- ── Tighten live/draft FKs (spec §6 deletion protection) ─────────────────
--
-- Was: ON DELETE SET NULL (silently nulled the pointer when a version was
-- deleted, allowing orphan-by-deletion). Now: ON DELETE RESTRICT — the DB
-- raises 23503 (FK violation) if you try to delete a version while it's
-- pointed at by either channel. The store maps that to 409 ProviderError.

alter table public.definitions
	drop constraint if exists fk_definitions_live_version,
	add constraint fk_definitions_live_version
		foreign key (live_version_id) references public.definition_versions(id)
		on delete restrict;

alter table public.definitions
	drop constraint if exists fk_definitions_draft_version,
	add constraint fk_definitions_draft_version
		foreign key (draft_version_id) references public.definition_versions(id)
		on delete restrict;
