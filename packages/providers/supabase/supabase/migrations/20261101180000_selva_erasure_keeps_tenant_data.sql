-- ============================================================================
-- Erasing a user removes the person, not the tenant data they created
--
-- `owner_id` and `uploaded_by` record who created a row. Cascading on them took
-- whole orgs with a founder long gone, and a live version's restrict FK refused
-- to erase its uploader. Authority comes from membership rows, which still
-- cascade, so these columns go null and the stores read that as the erased actor.
-- ============================================================================

alter table selva.orgs alter column owner_id drop not null;
alter table selva.orgs drop constraint if exists orgs_owner_id_fkey;
alter table selva.orgs add constraint orgs_owner_id_fkey
	foreign key (owner_id) references auth.users(id) on delete set null;

alter table selva.projects alter column owner_id drop not null;
alter table selva.projects drop constraint if exists projects_owner_id_fkey;
alter table selva.projects add constraint projects_owner_id_fkey
	foreign key (owner_id) references auth.users(id) on delete set null;

alter table selva.definitions alter column owner_id drop not null;
alter table selva.definitions drop constraint if exists definitions_owner_id_fkey;
alter table selva.definitions add constraint definitions_owner_id_fkey
	foreign key (owner_id) references auth.users(id) on delete set null;

alter table selva.definition_versions alter column uploaded_by drop not null;
alter table selva.definition_versions drop constraint if exists definition_versions_uploaded_by_fkey;
alter table selva.definition_versions add constraint definition_versions_uploaded_by_fkey
	foreign key (uploaded_by) references auth.users(id) on delete set null;
