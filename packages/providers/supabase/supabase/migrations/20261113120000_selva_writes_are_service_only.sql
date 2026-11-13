-- ============================================================================
-- Signed-in users read through RLS; only the app writes
--
-- The anon key is publishable, so a session JWT reaches PostgREST without going
-- through Selva. Write policies had to restate every app rule in SQL and kept
-- disagreeing with it. Too wide: a version row naming another tenant's file, a
-- project moved into another org, a member added without an invite. Too narrow:
-- a write filtered to zero rows and reported as done. Some rules cannot be
-- stated here at all: feature flags and the compute URL guard live in the app's
-- env, and a direct write never emits its audit event.
--
-- So `anon` and `authenticated` keep SELECT, which RLS still scopes, and lose
-- every write. The stores write with the service role after the app's checks,
-- the way storage objects always have.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables: read-only for sessions
-- ----------------------------------------------------------------------------

-- Revoking a table privilege also revokes the column grants under it.
revoke insert, update, delete, truncate, references, trigger
on all tables in schema selva from anon, authenticated;

revoke all on all sequences in schema selva from anon, authenticated;

-- A table added later starts closed and grants SELECT itself, next to its policy.
alter default privileges in schema selva revoke all on tables from anon, authenticated;
alter default privileges in schema selva revoke all on sequences from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. The write policies have nothing left to decide
-- ----------------------------------------------------------------------------

drop policy if exists "orgs: authenticated can create their own" on selva.orgs;
drop policy if exists "orgs: owners and instance admins can update" on selva.orgs;
drop policy if exists "orgs: owners and instance admins can delete" on selva.orgs;

drop policy if exists "org_members: admins can insert" on selva.org_members;
drop policy if exists "org_members: admins can update" on selva.org_members;
drop policy if exists "org_members: admins can delete" on selva.org_members;

drop policy if exists "projects: manage_projects can create" on selva.projects;
drop policy if exists "projects: owners can update" on selva.projects;
drop policy if exists "projects: owners can delete" on selva.projects;

drop policy if exists "project_members: managers can insert" on selva.project_members;
drop policy if exists "project_members: managers can update" on selva.project_members;
drop policy if exists "project_members: managers can delete" on selva.project_members;
drop policy if exists "project_members: seeding an owner row" on selva.project_members;
drop policy if exists "project_members: reactivating a seeded owner row" on selva.project_members;

drop policy if exists "definitions: editors can insert" on selva.definitions;
drop policy if exists "definitions: editors can update" on selva.definitions;
drop policy if exists "definitions: editors can delete" on selva.definitions;

drop policy if exists "definition_versions: editors can insert" on selva.definition_versions;
drop policy if exists "definition_versions: editors can update" on selva.definition_versions;
drop policy if exists "definition_versions: editors can delete" on selva.definition_versions;

drop policy if exists "share_links: editors can insert" on selva.share_links;
drop policy if exists "share_links: editors can revoke" on selva.share_links;

drop policy if exists "invites: manage_org_members can insert" on selva.invites;
drop policy if exists "invites: manage_org_members can update" on selva.invites;
drop policy if exists "invites: manage_org_members can delete" on selva.invites;

drop policy if exists "api_tokens: members mint their own" on selva.api_tokens;
drop policy if exists "api_tokens: owner or org leadership can revoke" on selva.api_tokens;
drop policy if exists "api_tokens: removed with their org" on selva.api_tokens;

drop policy if exists "user_profiles: users can update own" on selva.user_profiles;

-- These four were FOR ALL. Each table keeps its own SELECT policy.
drop policy if exists "compute_servers: scoped write" on selva.compute_servers;
drop policy if exists "compute_server_shares: admin write" on selva.compute_server_shares;
drop policy if exists "compute_server_org_defaults: manage_org_compute can write"
on selva.compute_server_org_defaults;
drop policy if exists "compute_server_platform_default: admin write"
on selva.compute_server_platform_default;

-- ----------------------------------------------------------------------------
-- 3. Functions that write
-- ----------------------------------------------------------------------------

-- `increment_run_count` and `reserve_next_version_number` are definer functions
-- with no caller check: any session could burn another tenant's version numbers.
revoke execute on function
	selva.save_platform_compute_servers(jsonb, jsonb, uuid),
	selva.save_org_compute_servers(uuid, jsonb, boolean, uuid),
	selva.increment_run_count(uuid),
	selva.reserve_next_version_number(uuid)
from authenticated;

-- The service role has no `auth.uid()`, so the remover is passed in: without it
-- the rows kept whoever last edited them as `updated_by`. The app decides who
-- may remove whom; the session-only permission check goes.
drop function if exists selva.remove_org_member(uuid, uuid);
create function selva.remove_org_member(o uuid, u uuid, actor uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
	perform 1
	from selva.org_members
	where org_id = o and user_id = u and deleted_at is null
	for update;
	if not found then
		raise exception 'Org member not found' using errcode = 'P0002';
	end if;

	update selva.project_members m
	set deleted_at = now(), updated_at = now(), updated_by = coalesce(actor, m.updated_by)
	from selva.projects p
	where p.id = m.project_id and p.org_id = o and m.user_id = u and m.deleted_at is null;

	update selva.org_members m
	set deleted_at = now(), updated_at = now(), updated_by = coalesce(actor, m.updated_by)
	where m.org_id = o and m.user_id = u and m.deleted_at is null;
end;
$$;

revoke all on function selva.remove_org_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function selva.remove_org_member(uuid, uuid, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 4. Invariants that hold whoever writes
-- ----------------------------------------------------------------------------

-- The app reads and deletes the blob a version row names, with the service
-- role. The key must be the row's own. A trigger, not a CHECK: a NOT VALID
-- CHECK still runs on every later update of a legacy row, including the
-- `uploaded_by` SET NULL when its uploader is deleted, which would then fail.
-- `update of` fires only when a statement sets one of these columns.
create or replace function selva.version_file_key_is_own()
returns trigger
language plpgsql
as $$
begin
	if new.file_key is distinct from 'definitions/' || new.definition_guid::text
		|| '/versions/v' || new.version_number::text || '.' || new.file_ext then
		raise exception 'A version row must name its own file' using errcode = '23514';
	end if;
	return new;
end;
$$;

revoke all on function selva.version_file_key_is_own() from public, anon, authenticated;
grant execute on function selva.version_file_key_is_own() to service_role;

drop trigger if exists trg_definition_versions_file_key_is_own on selva.definition_versions;
create trigger trg_definition_versions_file_key_is_own
	before insert or update of file_key, definition_guid, version_number, file_ext
	on selva.definition_versions
	for each row execute function selva.version_file_key_is_own();

-- A project's definitions, members and compute resolution all follow its org.
create or replace function selva.keep_project_org()
returns trigger
language plpgsql
as $$
begin
	if new.org_id is distinct from old.org_id then
		raise exception 'A project cannot move to another org' using errcode = '23514';
	end if;
	return new;
end;
$$;

revoke all on function selva.keep_project_org() from public, anon, authenticated;
grant execute on function selva.keep_project_org() to service_role;

drop trigger if exists trg_projects_keep_org on selva.projects;
create trigger trg_projects_keep_org
	before update of org_id on selva.projects
	for each row execute function selva.keep_project_org();

-- A deleted org's slug is free again, as it already is for projects and in the
-- local provider. The index keeps the constraint's name: the app maps that name
-- to its conflict message.
alter table selva.orgs drop constraint if exists orgs_slug_key;
drop index if exists selva.orgs_slug_key;
create unique index orgs_slug_key on selva.orgs (slug) where deleted_at is null;

-- The app tells a slug clash from a name clash by these names, and retries the
-- slug with a suffix. The partial indexes that replaced the constraints took
-- new names, so neither was recognised: no retry, and the raw message in a 409.
alter index if exists selva.projects_org_slug_live rename to projects_org_id_slug_key;
alter index if exists selva.projects_org_name_live rename to projects_org_name_unique;
