-- Make project (org_id, slug) and (org_id, lower(name)) uniqueness ignore
-- tombstones.
--
-- The initial migration declared `unique (org_id, slug)` and
-- `projects_org_name_unique` as UNCONDITIONAL uniqueness guards. Every read in
-- SupabaseProjectStore filters `deleted_at is null`, so a soft-deleted project
-- is invisible to the store yet still occupies its (org_id, slug) and
-- (org_id, lower(name)) pairs. That makes a deleted slug/name permanently
-- unrecoverable through the store API: createProject hits 23505, getBySlug
-- returns null, updateProject can't match the tombstone.
--
-- Every other uniqueness guard in this schema (idx_orgs_live, idx_projects_org,
-- the project_members index) is already partial `where deleted_at is null`.
-- These two were the inconsistency. Swap them to partial so tombstones release
-- the slug/name and create-after-delete just works.

-- (org_id, slug)
alter table selva.projects drop constraint if exists projects_org_id_slug_key;
create unique index if not exists projects_org_slug_live
	on selva.projects (org_id, slug) where deleted_at is null;

-- (org_id, lower(name)) — same latent bug
drop index if exists selva.projects_org_name_unique;
create unique index if not exists projects_org_name_live
	on selva.projects (org_id, lower(name)) where deleted_at is null;
