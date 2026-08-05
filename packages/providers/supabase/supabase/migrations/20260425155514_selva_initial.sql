-- ============================================================================
-- 0. Dedicated `selva` schema
-- All engine objects live here, never in `public`, so a consuming app that
-- shares the database keeps `public` entirely for its own tables. Cross-schema
-- refs from the app (FKs into selva.orgs, calls to selva.is_org_member) are
-- supported. The provider's data client targets it (db: { schema: 'selva' }).
--
-- PostgREST must expose `selva` to serve it over REST. We do that HERE, from the
-- migration, rather than from config.toml's static `[api] schemas`: that config
-- is read at stack boot, before migrations run, so naming a not-yet-created
-- schema there fails the health check and aborts `supabase start`. Setting it on
-- the `authenticator` role after the schema exists, then signalling a reload,
-- avoids the bootstrap race and works identically on hosted projects.
-- ============================================================================
create schema if not exists selva;
grant usage on schema selva to anon, authenticated, service_role;
alter default privileges in schema selva grant all on tables to anon, authenticated, service_role;
alter default privileges in schema selva grant all on functions to anon, authenticated, service_role;
alter default privileges in schema selva grant all on sequences to anon, authenticated, service_role;

-- Expose `selva` over PostgREST (additive to whatever is already exposed).
do $$
declare
	current_schemas text;
begin
	select coalesce(
		(select setting from pg_db_role_setting s
		 join pg_roles r on r.oid = s.setrole
		 cross join lateral unnest(s.setconfig) as setting
		 where r.rolname = 'authenticator' and setting like 'pgrst.db_schemas=%'),
		'pgrst.db_schemas=public, graphql_public'
	) into current_schemas;

	if current_schemas not like '%selva%' then
		execute format(
			'alter role authenticator set pgrst.db_schemas = %L',
			replace(current_schemas, 'pgrst.db_schemas=', '') || ', selva'
		);
	end if;
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';


-- ============================================================================
-- Selva — initial schema (consolidated bootstrap).
--
-- This is the only migration in the repository. It produces the same
-- end-state that 0001–0010 produced incrementally, with the dropped /
-- replaced columns and policies omitted entirely. Apply once on a fresh
-- DB; future schema changes go in numbered files (0002_…, 0003_…).
--
-- Layered top-to-bottom so dependencies always resolve:
--   1. set_updated_at trigger function
--   2. user_profiles + auto-seed trigger + RLS
--   3. orgs, org_members, projects, project_members tables + indexes
--   4. updated_at triggers + name uniqueness index
--   5. RLS helper functions (depend on all of the above)
--   6. Org/project RLS policies
--   7. definitions + definition_versions + RPC + RLS
--   8. invites + RPC + RLS
--   9. compute_servers + per-org/instance defaults + RLS
--   10. share_links (spec §7) + atomic-increment RPC + RLS
--   11. Storage bucket policies (selva-public, selva-private)
--   12. audit_events (spec §9 domain-event sink)
-- ============================================================================


-- ============================================================================
-- 1. set_updated_at trigger function
-- Maintains updated_at on every UPDATE without adapter involvement.
-- ============================================================================

create or replace function selva.set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;


-- ============================================================================
-- 2. user_profiles
-- Selva-specific extension of auth.users (display name, platform perms,
-- starred definitions, recent runs). Auto-seeded by trigger on signup.
-- ============================================================================

create table if not exists selva.user_profiles (
	user_id uuid primary key references auth.users(id) on delete cascade,
	display_name text,
	platform_permissions text[] not null default '{}',
	starred_definitions uuid[] not null default '{}',
	recent_runs jsonb not null default '[]',
	created_at timestamptz not null default now(),
	last_login_at timestamptz
);

create or replace function selva.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into selva.user_profiles (user_id)
	values (new.id)
	on conflict (user_id) do nothing;
	return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
	after insert on auth.users
	for each row execute function selva.handle_new_auth_user();

alter table selva.user_profiles enable row level security;

create policy "user_profiles: any authenticated can read"
on selva.user_profiles for select
to authenticated
using (true);

create policy "user_profiles: users can update own"
on selva.user_profiles for update
to authenticated
using (user_id = auth.uid())
with check (
	user_id = auth.uid()
	-- Users cannot escalate their own platform permissions; only service-role
	-- writes (which bypass RLS) may change that column.
	and platform_permissions is not distinct from (
		select platform_permissions from selva.user_profiles where user_id = auth.uid()
	)
);


-- ============================================================================
-- 3. orgs, org_members, projects, project_members
-- Tenant-owned hierarchy. All carry created_by/updated_by/deleted_at;
-- reads filter deleted_at IS NULL.
-- ============================================================================

create table if not exists selva.orgs (
	id uuid primary key,
	name text not null,
	slug text not null unique,
	owner_id uuid not null references auth.users(id) on delete cascade,
	created_by uuid references auth.users(id) on delete set null,
	updated_by uuid references auth.users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	deleted_at timestamptz
);
create index if not exists idx_orgs_live on selva.orgs(id) where deleted_at is null;

create table if not exists selva.org_members (
	org_id uuid not null references selva.orgs(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	role text not null check (role in ('owner', 'admin', 'member')),
	permissions text[] not null default '{}',
	joined_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	updated_by uuid references auth.users(id) on delete set null,
	deleted_at timestamptz,
	primary key (org_id, user_id)
);
create index if not exists idx_org_members_user
	on selva.org_members(user_id) where deleted_at is null;

create table if not exists selva.projects (
	id uuid primary key,
	org_id uuid not null references selva.orgs(id) on delete cascade,
	name text not null,
	slug text not null,
	description text,
	visibility text not null check (visibility in ('public', 'org', 'private')),
	auto_join_on_upload boolean not null default false,
	owner_id uuid not null references auth.users(id) on delete cascade,
	created_by uuid references auth.users(id) on delete set null,
	updated_by uuid references auth.users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	deleted_at timestamptz,
	unique (org_id, slug),
	-- Spec §4: commons mode requires visibility=selva.
	constraint projects_commons_requires_public check (
		auto_join_on_upload = false or visibility = 'public'
	)
);
create index if not exists idx_projects_org
	on selva.projects(org_id) where deleted_at is null;
-- Case-insensitive unique name per org (defense beyond slug uniqueness).
create unique index if not exists projects_org_name_unique
	on selva.projects (org_id, lower(name));

create table if not exists selva.project_members (
	project_id uuid not null references selva.projects(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	role text not null check (role in ('owner', 'editor', 'viewer')),
	joined_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	updated_by uuid references auth.users(id) on delete set null,
	deleted_at timestamptz,
	primary key (project_id, user_id)
);
create index if not exists idx_project_members_user
	on selva.project_members(user_id) where deleted_at is null;


-- ============================================================================
-- 4. updated_at triggers
-- ============================================================================

create trigger trg_orgs_updated_at before update on selva.orgs
	for each row execute function selva.set_updated_at();
create trigger trg_projects_updated_at before update on selva.projects
	for each row execute function selva.set_updated_at();
create trigger trg_org_members_updated_at before update on selva.org_members
	for each row execute function selva.set_updated_at();
create trigger trg_project_members_updated_at before update on selva.project_members
	for each row execute function selva.set_updated_at();


-- ============================================================================
-- 5. RLS helper functions
-- All SECURITY DEFINER so they bypass RLS on the tables they read (avoids
-- recursion). All filter deleted_at IS NULL.
-- ============================================================================

create or replace function selva.is_instance_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.user_profiles
		where user_id = auth.uid() and 'instance_admin' = any(platform_permissions)
	);
$$;

create or replace function selva.is_org_member(o uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
	);
$$;

create or replace function selva.is_org_admin(o uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and role in ('owner', 'admin')
	);
$$;

create or replace function selva.is_org_owner(o uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and role = 'owner'
	);
$$;

create or replace function selva.has_org_permission(o uuid, perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
	select selva.is_instance_admin() or exists (
		select 1 from selva.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and perm = any(permissions)
	);
$$;

create or replace function selva.is_project_member(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from selva.project_members
		where project_id = p and user_id = auth.uid() and deleted_at is null
	);
$$;

-- Spec §5 canView: private → member, org → org member, public → everyone.
create or replace function selva.visible_project(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select selva.is_instance_admin() or exists (
		select 1
		from selva.projects
		where id = p
		and deleted_at is null
		and (
			visibility = 'public'
			or (visibility = 'org' and selva.is_org_member(org_id))
			or selva.is_project_member(id)
		)
	);
$$;


-- ============================================================================
-- 6. Org / project RLS policies
-- ============================================================================

alter table selva.orgs enable row level security;

-- RLS gates "may this principal touch this row?", not "is the row in a state
-- worth showing?". Soft-delete filtering (`deleted_at is null`) belongs at the
-- query layer — every store already issues `.is('deleted_at', null)` on
-- user-facing reads. Putting the lifecycle check in the USING clause breaks
-- the soft-delete write itself: `UPDATE ... SET deleted_at = now() RETURNING`
-- triggers a PostgREST re-read against the SELECT policy, which then filters
-- out the just-tombstoned row and surfaces as "new row violates RLS". Same
-- trap for `revoked_at` on share_links below.
create policy "orgs: members and instance admins can read"
on selva.orgs for select
to authenticated
using (selva.is_instance_admin() or selva.is_org_member(id));

create policy "orgs: authenticated can create their own"
on selva.orgs for insert
to authenticated
with check (selva.is_instance_admin() or owner_id = auth.uid());

create policy "orgs: owners and instance admins can update"
on selva.orgs for update
to authenticated
using (selva.is_instance_admin() or selva.is_org_owner(id))
with check (selva.is_instance_admin() or selva.is_org_owner(id));

create policy "orgs: owners and instance admins can delete"
on selva.orgs for delete
to authenticated
using (selva.is_instance_admin() or selva.is_org_owner(id));

alter table selva.org_members enable row level security;

create policy "org_members: org members can read roster"
on selva.org_members for select
to authenticated
using (selva.is_instance_admin() or selva.is_org_member(org_id));

create policy "org_members: admins can insert"
on selva.org_members for insert
to authenticated
with check (selva.is_instance_admin() or selva.is_org_admin(org_id));

create policy "org_members: admins can update"
on selva.org_members for update
to authenticated
using (selva.is_instance_admin() or selva.is_org_admin(org_id))
with check (selva.is_instance_admin() or selva.is_org_admin(org_id));

create policy "org_members: admins can delete"
on selva.org_members for delete
to authenticated
using (selva.is_instance_admin() or selva.is_org_admin(org_id));

alter table selva.projects enable row level security;

create policy "projects: visible to members"
on selva.projects for select
to authenticated
using (selva.visible_project(id));

create policy "projects: manage_projects can create"
on selva.projects for insert
to authenticated
with check (selva.has_org_permission(org_id, 'manage_projects'));

-- Project settings (name, slug, description, visibility, flags) are owner-only.
create policy "projects: owners can update"
on selva.projects for update
to authenticated
using (selva.is_instance_admin() or owner_id = auth.uid())
with check (selva.is_instance_admin() or owner_id = auth.uid());

create policy "projects: owners can delete"
on selva.projects for delete
to authenticated
using (selva.is_instance_admin() or owner_id = auth.uid());

alter table selva.project_members enable row level security;

create policy "project_members: visible to project members"
on selva.project_members for select
to authenticated
using (selva.is_instance_admin() or selva.visible_project(project_id));

-- canManage (§5) collapses to owner-only; org admins no longer silently
-- manage project members.
create policy "project_members: managers can insert"
on selva.project_members for insert
to authenticated
with check (
	selva.is_instance_admin()
	or exists (
		select 1 from selva.projects p
		where p.id = project_id and p.deleted_at is null and p.owner_id = auth.uid()
	)
);

create policy "project_members: managers can update"
on selva.project_members for update
to authenticated
using (
	selva.is_instance_admin()
	or exists (
		select 1 from selva.projects p
		where p.id = project_id and p.deleted_at is null and p.owner_id = auth.uid()
	)
)
with check (
	selva.is_instance_admin()
	or exists (
		select 1 from selva.projects p
		where p.id = project_id and p.deleted_at is null and p.owner_id = auth.uid()
	)
);

create policy "project_members: managers can delete"
on selva.project_members for delete
to authenticated
using (
	selva.is_instance_admin()
	or exists (
		select 1 from selva.projects p
		where p.id = project_id and p.deleted_at is null and p.owner_id = auth.uid()
	)
);


-- ============================================================================
-- 7. definitions + definition_versions (spec §6)
--
-- Versioning model: each upload creates an immutable definition_versions row.
-- definitions.live_version_id / draft_version_id point at versions; both are
-- ON DELETE RESTRICT so a referenced version cannot be deleted (deletion
-- protection enforced at the DB layer).
--
-- Per-version columns (file_ext, original_filename) live on definition_versions,
-- not on definitions — different versions can carry different uploaded shapes.
-- ============================================================================

create table if not exists selva.definitions (
	guid uuid primary key,
	project_id uuid not null references selva.projects(id) on delete cascade,
	owner_id uuid not null references auth.users(id) on delete cascade,
	created_by uuid references auth.users(id) on delete set null,
	updated_by uuid references auth.users(id) on delete set null,
	-- FKs to definition_versions added below once that table exists.
	live_version_id uuid,
	draft_version_id uuid,
	compute_server_id uuid,
	display_name text not null,
	description text,
	category text,
	tags text[] not null default '{}',
	cover_image text,
	status text not null check (status in ('pending', 'draft', 'review', 'published', 'archived')),
	run_count bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	deleted_at timestamptz
);

create index if not exists idx_definitions_project
	on selva.definitions(project_id) where deleted_at is null;
create index if not exists idx_definitions_status
	on selva.definitions(status) where deleted_at is null;
create index if not exists idx_definitions_pending_updated
	on selva.definitions(updated_at)
	where status = 'pending' and deleted_at is null;

create trigger trg_definitions_updated_at before update on selva.definitions
	for each row execute function selva.set_updated_at();

create table if not exists selva.definition_versions (
	id uuid primary key,
	definition_guid uuid not null references selva.definitions(guid) on delete cascade,
	version_number integer not null check (version_number >= 1),
	file_ext text not null check (file_ext in ('gh', 'ghx')),
	file_key text not null,
	original_filename text,
	uploaded_by uuid not null references auth.users(id) on delete cascade,
	uploaded_at timestamptz not null default now(),
	unique (definition_guid, version_number)
);

create index if not exists idx_definition_versions_def
	on selva.definition_versions(definition_guid, version_number desc);

-- Spec §6 deletion protection: cannot delete a version while it's serving
-- either channel. Postgres raises 23503; the store maps that to 409.
alter table selva.definitions
	add constraint fk_definitions_live_version
	foreign key (live_version_id) references selva.definition_versions(id)
	on delete restrict;

alter table selva.definitions
	add constraint fk_definitions_draft_version
	foreign key (draft_version_id) references selva.definition_versions(id)
	on delete restrict;

-- Atomic run-count increment. Called after each successful solve. No-op on
-- missing or soft-deleted rows.
create or replace function selva.increment_run_count(g uuid)
returns void
language sql security definer set search_path = public
as $$
	update selva.definitions
	set run_count = run_count + 1
	where guid = g and deleted_at is null;
$$;
grant execute on function selva.increment_run_count(uuid) to authenticated, service_role;

alter table selva.definitions enable row level security;

create policy "definitions: visible via project"
on selva.definitions for select
to authenticated
using (selva.visible_project(project_id));

create policy "definitions: editors can insert"
on selva.definitions for insert
to authenticated
with check (
	selva.is_instance_admin()
	-- Container mode: project editor/owner required.
	or exists (
		select 1 from selva.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	-- Commons mode: any authenticated user may create on a public + commons
	-- project; they become its owner_id.
	or exists (
		select 1 from selva.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.visibility = 'public'
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
);

create policy "definitions: editors can update"
on selva.definitions for update
to authenticated
using (
	selva.is_instance_admin()
	or exists (
		select 1 from selva.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1 from selva.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
)
with check (
	selva.is_instance_admin()
	or exists (
		select 1 from selva.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1 from selva.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
);

create policy "definitions: editors can delete"
on selva.definitions for delete
to authenticated
using (
	selva.is_instance_admin()
	or exists (
		select 1 from selva.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1 from selva.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
);

alter table selva.definition_versions enable row level security;

-- Versions inherit visibility from the parent definition (which inherits
-- from the parent project). Versions are immutable — no UPDATE policy.
create policy "definition_versions: visible via parent"
on selva.definition_versions for select
to authenticated
using (
	exists (
		select 1 from selva.definitions d
		where d.guid = definition_versions.definition_guid
		and d.deleted_at is null
		and selva.visible_project(d.project_id)
	)
);

create policy "definition_versions: editors can insert"
on selva.definition_versions for insert
to authenticated
with check (
	selva.is_instance_admin()
	or exists (
		select 1
		from selva.definitions d
		join selva.project_members m on m.project_id = d.project_id
		where d.guid = definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1
		from selva.definitions d
		join selva.projects p on p.id = d.project_id
		where d.guid = definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
		and definition_versions.uploaded_by = auth.uid()
	)
);

-- Without an explicit DELETE policy, RLS silently affects 0 rows on every
-- `delete from definition_versions` — `SupabaseDefinitionStore.deleteVersion`
-- returns success without removing anything, and the FK ON DELETE RESTRICT on
-- `definitions.live_version_id` / `draft_version_id` never gets a chance to
-- raise the 23503 the store maps to a 409. Same authority as INSERT.
create policy "definition_versions: editors can delete"
on selva.definition_versions for delete
to authenticated
using (
	selva.is_instance_admin()
	or exists (
		select 1
		from selva.definitions d
		join selva.project_members m on m.project_id = d.project_id
		where d.guid = definition_versions.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1
		from selva.definitions d
		join selva.projects p on p.id = d.project_id
		where d.guid = definition_versions.definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
	)
);

-- Without an explicit UPDATE policy, RLS silently affects 0 rows on every
-- `update definition_versions` — `SupabaseDefinitionStore.setVersionSchema`
-- (which caches the compute-extracted UI schema, migration 0002) returns
-- success without persisting anything for a user-scoped caller. Same authority
-- as INSERT/DELETE: project owner/editor, or instance admin.
create policy "definition_versions: editors can update"
on selva.definition_versions for update
to authenticated
using (
	selva.is_instance_admin()
	or exists (
		select 1
		from selva.definitions d
		join selva.project_members m on m.project_id = d.project_id
		where d.guid = definition_versions.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
)
with check (
	selva.is_instance_admin()
	or exists (
		select 1
		from selva.definitions d
		join selva.project_members m on m.project_id = d.project_id
		where d.guid = definition_versions.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
);


-- ============================================================================
-- 8. invites
-- ============================================================================

-- `org_id ... on delete cascade` only fires when the org is HARD-deleted.
-- The standard `deleteOrg` path is a soft-delete (UPDATE deleted_at), so the
-- SupabaseOrgStore.deleteOrg cascade explicitly DELETEs invites for the org;
-- see SupabaseOrgStore.ts. Same pattern for compute_servers below.
-- Invite tokens are HMAC-hashed at the route layer (the selva app's
-- `lib/server/invites/token.server.ts`) before reaching the store — the raw
-- token is shown to the admin once and never persisted. A DB-only leak
-- therefore can't be replayed without the instance's SELVA_HMAC_KEY.
-- Mirrors the share-link design (`share_links.token_hash`).
create table if not exists selva.invites (
	id uuid primary key,
	token_hash text not null unique,
	email text not null,
	org_id uuid not null references selva.orgs(id) on delete cascade,
	org_role text not null check (org_role in ('owner', 'admin', 'member')),
	org_permissions text[] not null default '{}',
	invited_by uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now(),
	expires_at timestamptz not null,
	accepted_at timestamptz,
	accepted_by_user_id uuid references auth.users(id) on delete set null
);

create index if not exists idx_invites_org on selva.invites(org_id, created_at desc);

alter table selva.invites enable row level security;

create policy "invites: manage_org_members can read org invites"
on selva.invites for select
to authenticated
using (selva.has_org_permission(org_id, 'manage_org_members'));

create policy "invites: manage_org_members can insert"
on selva.invites for insert
to authenticated
with check (selva.has_org_permission(org_id, 'manage_org_members'));

create policy "invites: manage_org_members can update"
on selva.invites for update
to authenticated
using (selva.has_org_permission(org_id, 'manage_org_members'))
with check (selva.has_org_permission(org_id, 'manage_org_members'));

create policy "invites: manage_org_members can delete"
on selva.invites for delete
to authenticated
using (selva.has_org_permission(org_id, 'manage_org_members'));

-- Hash-gated read via SECURITY DEFINER so the token itself is the capability.
-- Caller hashes the raw URL token at the route layer and passes the digest;
-- the function just looks up the row. Returns SETOF so a missing match
-- becomes an empty array (not a composite of nulls).
create or replace function selva.get_invite_by_token_hash(h text)
returns setof selva.invites
language sql stable security definer set search_path = public
as $$
	select *
	from selva.invites
	where token_hash = h
	and accepted_at is null
	and expires_at > now()
	limit 1;
$$;
grant execute on function selva.get_invite_by_token_hash(text) to anon, authenticated, service_role;


-- ============================================================================
-- 9. compute_servers (spec §3 — platform vs. org-private)
--
-- Servers are discriminated by `scope`:
--   * scope = 'platform' → managed by `manage_compute`. `sharedWith = 'all'`
--     (db: shared_with_all = true) exposes to every org; otherwise the
--     per-org allowlist lives in `compute_server_shares`. The global
--     default is always visible regardless (the "baseline" floor).
--   * scope = 'org'      → org-private. `owner_org_id` is required.
--     Visible only to members of that org. Gated by the platform flag
--     ALLOW_ORG_COMPUTE_OVERRIDE at the TS layer; DB policies still accept
--     writes so flipping the flag on doesn't require a policy change.
--
-- Defaults are layered:
--   * compute_server_platform_default (singleton) — global default. Must
--     reference a platform row.
--   * compute_server_org_defaults — per-org override. Must reference a
--     server visible to that org (validated at the TS layer).
--
-- Cascade note: the `owner_org_id` FK is `on delete cascade`, but
-- `deleteOrg` is a soft-delete and never triggers it. SupabaseOrgStore
-- explicitly DELETEs from compute_server_org_defaults, compute_server_shares,
-- and compute_servers (where owner_org_id matches) for the org. The FK
-- cascade only matters for the eventual hard-delete janitor.
-- ============================================================================

-- compute_servers — discriminated by `scope`.
--   * scope = 'platform': managed by `manage_compute`. `owner_org_id` must
--     be null. `shared_with_all = true` exposes the server to every org;
--     otherwise the per-org allowlist lives in `compute_server_shares`. The
--     global default in `compute_server_platform_default` is *always*
--     visible regardless of share state (spec §3 — baseline floor).
--   * scope = 'org':      managed by an org member with `manage_org_compute`.
--     `owner_org_id` is required and visibility is implicit (only members
--     of `owner_org_id` can see it). Gated by the platform flag
--     ALLOW_ORG_COMPUTE_OVERRIDE at the TS layer.
create table if not exists selva.compute_servers (
	id uuid primary key,
	scope text not null check (scope in ('platform', 'org')),
	owner_org_id uuid references selva.orgs(id) on delete cascade,
	shared_with_all boolean not null default false,
	label text not null,
	server_url text not null,
	api_key text,
	timeout_ms integer,
	retry_count integer,
	created_at timestamptz not null default now(),
	-- Scope-specific invariants.
	check (
		(scope = 'platform' and owner_org_id is null)
		or (scope = 'org' and owner_org_id is not null and shared_with_all = false)
	)
);
create index if not exists idx_compute_servers_owner_org on selva.compute_servers(owner_org_id);

-- Per-org share allowlist for platform servers. Empty rows = dormant
-- platform server (admin-only) unless it's the global default.
create table if not exists selva.compute_server_shares (
	server_id uuid not null references selva.compute_servers(id) on delete cascade,
	org_id uuid not null references selva.orgs(id) on delete cascade,
	primary key (server_id, org_id)
);
create index if not exists idx_compute_server_shares_org on selva.compute_server_shares(org_id);

-- Per-org default override (orgDefaults[orgId]).
create table if not exists selva.compute_server_org_defaults (
	org_id uuid primary key references selva.orgs(id) on delete cascade,
	default_server_id uuid references selva.compute_servers(id) on delete set null
);

-- Single-row sentinel for the global default.
create table if not exists selva.compute_server_platform_default (
	singleton boolean primary key default true,
	default_server_id uuid references selva.compute_servers(id) on delete set null,
	check (singleton)
);
insert into selva.compute_server_platform_default (singleton, default_server_id)
	values (true, null)
on conflict (singleton) do nothing;

alter table selva.compute_servers enable row level security;
alter table selva.compute_server_shares enable row level security;
alter table selva.compute_server_org_defaults enable row level security;
alter table selva.compute_server_platform_default enable row level security;

-- Read: instance_admin sees everything. Otherwise visibility follows §3:
--   * platform server with shared_with_all = true → all authenticated users
--   * platform server with a row in compute_server_shares for an org the
--     user belongs to → that user
--   * platform server that is the current global default → all (floor)
--   * org server → only members of owner_org_id
create policy "compute_servers: visibility-scoped read"
on selva.compute_servers for select
to authenticated
using (
	selva.is_instance_admin()
	or (scope = 'platform' and shared_with_all)
	or (scope = 'platform' and id = (
		select default_server_id from selva.compute_server_platform_default where singleton
	))
	or (scope = 'platform' and exists (
		select 1 from selva.compute_server_shares s
		where s.server_id = compute_servers.id and selva.is_org_member(s.org_id)
	))
	or (scope = 'org' and selva.is_org_member(owner_org_id))
);

-- Writes:
--   * scope = 'platform' → instance_admin only.
--   * scope = 'org'      → manage_org_compute on owner_org_id.
create policy "compute_servers: scoped write"
on selva.compute_servers for all
to authenticated
using (
	selva.is_instance_admin()
	or (scope = 'org' and owner_org_id is not null
		and selva.has_org_permission(owner_org_id, 'manage_org_compute'))
)
with check (
	selva.is_instance_admin()
	or (scope = 'org' and owner_org_id is not null
		and selva.has_org_permission(owner_org_id, 'manage_org_compute'))
);

create policy "compute_server_shares: read"
on selva.compute_server_shares for select
to authenticated
using (selva.is_instance_admin() or selva.is_org_member(org_id));

create policy "compute_server_shares: admin write"
on selva.compute_server_shares for all
to authenticated
using (selva.is_instance_admin())
with check (selva.is_instance_admin());

create policy "compute_server_org_defaults: members can read"
on selva.compute_server_org_defaults for select
to authenticated
using (selva.is_instance_admin() or selva.is_org_member(org_id));

create policy "compute_server_org_defaults: manage_org_compute can write"
on selva.compute_server_org_defaults for all
to authenticated
using (selva.is_instance_admin() or selva.has_org_permission(org_id, 'manage_org_compute'))
with check (selva.is_instance_admin() or selva.has_org_permission(org_id, 'manage_org_compute'));

create policy "compute_server_platform_default: read all"
on selva.compute_server_platform_default for select
to authenticated
using (true);

create policy "compute_server_platform_default: admin write"
on selva.compute_server_platform_default for all
to authenticated
using (selva.is_instance_admin())
with check (selva.is_instance_admin());


-- ============================================================================
-- 10. share_links (spec §7)
--
-- Per-definition tokens granting unauthenticated access to one
-- (definitionId, channel). token_hash is HMAC(SELVA_HMAC_KEY, raw); the
-- raw token is shown to the minter once at creation.
-- ============================================================================

create table if not exists selva.share_links (
	id uuid primary key,
	definition_guid uuid not null references selva.definitions(guid) on delete cascade,
	channel text not null check (channel in ('live', 'draft')),
	token_hash text not null unique,
	name text,
	created_by uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now(),
	expires_at timestamptz,
	revoked_at timestamptz,
	allow_solve boolean not null default true,
	max_solves integer check (max_solves is null or max_solves >= 1),
	solve_count integer not null default 0
);

create index if not exists idx_share_links_definition
	on selva.share_links(definition_guid, created_at desc)
	where revoked_at is null;

-- Atomic check-and-increment. Returns the new solve_count on success, NULL
-- when the cap was reached (no row updated) or the link is revoked /
-- expired / missing. Single-statement = no race even under concurrent solves.
create or replace function selva.try_increment_share_link_solve_count(link_id uuid)
returns integer
language sql security definer set search_path = public
as $$
	update selva.share_links
	set solve_count = solve_count + 1
	where id = link_id
	  and revoked_at is null
	  and (expires_at is null or expires_at > now())
	  and (max_solves is null or solve_count < max_solves)
	returning solve_count;
$$;
grant execute on function selva.try_increment_share_link_solve_count(uuid)
	to authenticated, anon, service_role;

alter table selva.share_links enable row level security;

-- Read/insert/revoke: same authority that can edit the parent definition
-- (project owner/editor or commons-mode definition owner). Token resolution
-- uses the SECURITY DEFINER RPC + service-role and bypasses RLS — the token
-- IS the credential there.

create policy "share_links: editors can read"
on selva.share_links for select
to authenticated
using (
	selva.is_instance_admin()
	or exists (
		select 1
		from selva.definitions d
		join selva.project_members m on m.project_id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1
		from selva.definitions d
		join selva.projects p on p.id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
	)
);

create policy "share_links: editors can insert"
on selva.share_links for insert
to authenticated
with check (
	selva.is_instance_admin()
	or exists (
		select 1
		from selva.definitions d
		join selva.project_members m on m.project_id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1
		from selva.definitions d
		join selva.projects p on p.id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
	)
);

-- UPDATE policy covers `revoke` (set revoked_at). Same authority as insert.
create policy "share_links: editors can revoke"
on selva.share_links for update
to authenticated
using (
	selva.is_instance_admin()
	or exists (
		select 1
		from selva.definitions d
		join selva.project_members m on m.project_id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
)
with check (
	selva.is_instance_admin()
	or exists (
		select 1
		from selva.definitions d
		join selva.project_members m on m.project_id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
);


-- ============================================================================
-- 11. Storage bucket policies
--
-- All mutations on both buckets go through the app server, which holds the
-- service-role key (SupabaseStorageProvider) — service-role bypasses RLS.
-- User-scoped JWTs (the `authenticated` role) get NO direct access to
-- storage REST: a logged-in user could otherwise extract their cookie JWT,
-- pair it with the public anon key, and call /storage/v1/object/... directly
-- to read/overwrite/delete any tenant's objects, since storage.objects has
-- no project/ownership column to filter on. Application-layer access is
-- enforced server-side: private reads flow through /api/files (which uses
-- the service-role client and runs project-membership checks), and public
-- reads use the CDN endpoint via the anon role below.
-- ============================================================================

-- selva-public is served directly from the CDN (cover images, brand assets);
-- anonymous reads are required. Writes are service-role only.
drop policy if exists "selva-public: anyone can read" on storage.objects;
create policy "selva-public: anyone can read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'selva-public');

-- selva-private is never accessed directly by users. No policies for the
-- authenticated role are defined; service-role bypasses RLS for app writes
-- and proxied reads through /api/files.


-- ============================================================================
-- 12. audit_events
-- Persistent sink for the domain events defined in `@selvajs/platform/events`.
-- Every successful mutation in a data store emits one row here via
-- `SupabaseEventSink`. Read-only from the application's point of view —
-- mutations come exclusively from the sink writer.
--
-- Schema is intentionally generic: type + actor + timestamp + JSONB payload
-- (the entire DomainEvent serialized). New event variants don't require a
-- column migration — only the union in events/interface.ts.
--
-- The UI for viewing this remains deferred (Permissions.md §12); the table
-- exists today so audit data is captured from the moment the system goes live.
-- ============================================================================

create table if not exists selva.audit_events (
	id uuid primary key default gen_random_uuid(),
	type text not null,
	actor_id text not null,
	occurred_at timestamptz not null default now(),
	data jsonb not null
);

create index if not exists audit_events_occurred_at_idx
	on selva.audit_events (occurred_at desc);

create index if not exists audit_events_type_occurred_at_idx
	on selva.audit_events (type, occurred_at desc);

create index if not exists audit_events_actor_occurred_at_idx
	on selva.audit_events (actor_id, occurred_at desc);

-- RLS: writes always go through service-role (the sink uses the service
-- client). Authenticated users have NO read access today — the audit-log
-- viewer UI will land later with its own instance_admin-only policy.
alter table selva.audit_events enable row level security;
