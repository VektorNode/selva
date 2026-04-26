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

create or replace function public.set_updated_at()
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

create table if not exists public.user_profiles (
	user_id uuid primary key references auth.users(id) on delete cascade,
	display_name text,
	platform_permissions text[] not null default '{}',
	starred_definitions uuid[] not null default '{}',
	recent_runs jsonb not null default '[]',
	created_at timestamptz not null default now(),
	last_login_at timestamptz
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.user_profiles (user_id)
	values (new.id)
	on conflict (user_id) do nothing;
	return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
	after insert on auth.users
	for each row execute function public.handle_new_auth_user();

alter table public.user_profiles enable row level security;

create policy "user_profiles: any authenticated can read"
on public.user_profiles for select
to authenticated
using (true);

create policy "user_profiles: users can update own"
on public.user_profiles for update
to authenticated
using (user_id = auth.uid())
with check (
	user_id = auth.uid()
	-- Users cannot escalate their own platform permissions; only service-role
	-- writes (which bypass RLS) may change that column.
	and platform_permissions is not distinct from (
		select platform_permissions from public.user_profiles where user_id = auth.uid()
	)
);


-- ============================================================================
-- 3. orgs, org_members, projects, project_members
-- Tenant-owned hierarchy. All carry created_by/updated_by/deleted_at;
-- reads filter deleted_at IS NULL.
-- ============================================================================

create table if not exists public.orgs (
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
create index if not exists idx_orgs_live on public.orgs(id) where deleted_at is null;

create table if not exists public.org_members (
	org_id uuid not null references public.orgs(id) on delete cascade,
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
	on public.org_members(user_id) where deleted_at is null;

create table if not exists public.projects (
	id uuid primary key,
	org_id uuid not null references public.orgs(id) on delete cascade,
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
	-- Spec §4: commons mode requires visibility=public.
	constraint projects_commons_requires_public check (
		auto_join_on_upload = false or visibility = 'public'
	)
);
create index if not exists idx_projects_org
	on public.projects(org_id) where deleted_at is null;
-- Case-insensitive unique name per org (defense beyond slug uniqueness).
create unique index if not exists projects_org_name_unique
	on public.projects (org_id, lower(name));

create table if not exists public.project_members (
	project_id uuid not null references public.projects(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	role text not null check (role in ('owner', 'editor', 'viewer')),
	joined_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	updated_by uuid references auth.users(id) on delete set null,
	deleted_at timestamptz,
	primary key (project_id, user_id)
);
create index if not exists idx_project_members_user
	on public.project_members(user_id) where deleted_at is null;


-- ============================================================================
-- 4. updated_at triggers
-- ============================================================================

create trigger trg_orgs_updated_at before update on public.orgs
	for each row execute function public.set_updated_at();
create trigger trg_projects_updated_at before update on public.projects
	for each row execute function public.set_updated_at();
create trigger trg_org_members_updated_at before update on public.org_members
	for each row execute function public.set_updated_at();
create trigger trg_project_members_updated_at before update on public.project_members
	for each row execute function public.set_updated_at();


-- ============================================================================
-- 5. RLS helper functions
-- All SECURITY DEFINER so they bypass RLS on the tables they read (avoids
-- recursion). All filter deleted_at IS NULL.
-- ============================================================================

create or replace function public.is_instance_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from public.user_profiles
		where user_id = auth.uid() and 'instance_admin' = any(platform_permissions)
	);
$$;

create or replace function public.is_org_member(o uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from public.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
	);
$$;

create or replace function public.is_org_admin(o uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from public.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and role in ('owner', 'admin')
	);
$$;

create or replace function public.is_org_owner(o uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from public.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and role = 'owner'
	);
$$;

create or replace function public.has_org_permission(o uuid, perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
	select public.is_instance_admin() or exists (
		select 1 from public.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and perm = any(permissions)
	);
$$;

create or replace function public.is_project_member(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from public.project_members
		where project_id = p and user_id = auth.uid() and deleted_at is null
	);
$$;

-- Spec §5 canView: private → member, org → org member, public → everyone.
create or replace function public.visible_project(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
	select public.is_instance_admin() or exists (
		select 1
		from public.projects
		where id = p
		and deleted_at is null
		and (
			visibility = 'public'
			or (visibility = 'org' and public.is_org_member(org_id))
			or public.is_project_member(id)
		)
	);
$$;


-- ============================================================================
-- 6. Org / project RLS policies
-- ============================================================================

alter table public.orgs enable row level security;

create policy "orgs: members and instance admins can read"
on public.orgs for select
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.is_org_member(id)));

create policy "orgs: authenticated can create their own"
on public.orgs for insert
to authenticated
with check (public.is_instance_admin() or owner_id = auth.uid());

create policy "orgs: owners and instance admins can update"
on public.orgs for update
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.is_org_owner(id)))
with check (public.is_instance_admin() or public.is_org_owner(id));

create policy "orgs: owners and instance admins can delete"
on public.orgs for delete
to authenticated
using (public.is_instance_admin() or public.is_org_owner(id));

alter table public.org_members enable row level security;

create policy "org_members: org members can read roster"
on public.org_members for select
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.is_org_member(org_id)));

create policy "org_members: admins can insert"
on public.org_members for insert
to authenticated
with check (public.is_instance_admin() or public.is_org_admin(org_id));

create policy "org_members: admins can update"
on public.org_members for update
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.is_org_admin(org_id)))
with check (public.is_instance_admin() or public.is_org_admin(org_id));

create policy "org_members: admins can delete"
on public.org_members for delete
to authenticated
using (public.is_instance_admin() or public.is_org_admin(org_id));

alter table public.projects enable row level security;

create policy "projects: visible to members"
on public.projects for select
to authenticated
using (deleted_at is null and public.visible_project(id));

create policy "projects: manage_projects can create"
on public.projects for insert
to authenticated
with check (public.has_org_permission(org_id, 'manage_projects'));

-- Project settings (name, slug, description, visibility, flags) are owner-only.
create policy "projects: owners can update"
on public.projects for update
to authenticated
using (
	deleted_at is null and (public.is_instance_admin() or owner_id = auth.uid())
)
with check (public.is_instance_admin() or owner_id = auth.uid());

create policy "projects: owners can delete"
on public.projects for delete
to authenticated
using (public.is_instance_admin() or owner_id = auth.uid());

alter table public.project_members enable row level security;

create policy "project_members: visible to project members"
on public.project_members for select
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.visible_project(project_id)));

-- canManage (§5) collapses to owner-only; org admins no longer silently
-- manage project members.
create policy "project_members: managers can insert"
on public.project_members for insert
to authenticated
with check (
	public.is_instance_admin()
	or exists (
		select 1 from public.projects p
		where p.id = project_id and p.deleted_at is null and p.owner_id = auth.uid()
	)
);

create policy "project_members: managers can update"
on public.project_members for update
to authenticated
using (
	deleted_at is null and (
		public.is_instance_admin()
		or exists (
			select 1 from public.projects p
			where p.id = project_id and p.deleted_at is null and p.owner_id = auth.uid()
		)
	)
)
with check (
	public.is_instance_admin()
	or exists (
		select 1 from public.projects p
		where p.id = project_id and p.deleted_at is null and p.owner_id = auth.uid()
	)
);

create policy "project_members: managers can delete"
on public.project_members for delete
to authenticated
using (
	public.is_instance_admin()
	or exists (
		select 1 from public.projects p
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

create table if not exists public.definitions (
	guid uuid primary key,
	project_id uuid not null references public.projects(id) on delete cascade,
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
	on public.definitions(project_id) where deleted_at is null;
create index if not exists idx_definitions_status
	on public.definitions(status) where deleted_at is null;
create index if not exists idx_definitions_pending_updated
	on public.definitions(updated_at)
	where status = 'pending' and deleted_at is null;

create trigger trg_definitions_updated_at before update on public.definitions
	for each row execute function public.set_updated_at();

create table if not exists public.definition_versions (
	id uuid primary key,
	definition_guid uuid not null references public.definitions(guid) on delete cascade,
	version_number integer not null check (version_number >= 1),
	file_ext text not null check (file_ext in ('gh', 'ghx')),
	file_key text not null,
	original_filename text,
	uploaded_by uuid not null references auth.users(id) on delete cascade,
	uploaded_at timestamptz not null default now(),
	unique (definition_guid, version_number)
);

create index if not exists idx_definition_versions_def
	on public.definition_versions(definition_guid, version_number desc);

-- Spec §6 deletion protection: cannot delete a version while it's serving
-- either channel. Postgres raises 23503; the store maps that to 409.
alter table public.definitions
	add constraint fk_definitions_live_version
	foreign key (live_version_id) references public.definition_versions(id)
	on delete restrict;

alter table public.definitions
	add constraint fk_definitions_draft_version
	foreign key (draft_version_id) references public.definition_versions(id)
	on delete restrict;

-- Atomic run-count increment. Called after each successful solve. No-op on
-- missing or soft-deleted rows.
create or replace function public.increment_run_count(g uuid)
returns void
language sql security definer set search_path = public
as $$
	update public.definitions
	set run_count = run_count + 1
	where guid = g and deleted_at is null;
$$;
grant execute on function public.increment_run_count(uuid) to authenticated, service_role;

alter table public.definitions enable row level security;

create policy "definitions: visible via project"
on public.definitions for select
to authenticated
using (deleted_at is null and public.visible_project(project_id));

create policy "definitions: editors can insert"
on public.definitions for insert
to authenticated
with check (
	public.is_instance_admin()
	-- Container mode: project editor/owner required.
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	-- Commons mode: any authenticated user may create on a public + commons
	-- project; they become its owner_id.
	or exists (
		select 1 from public.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.visibility = 'public'
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
);

create policy "definitions: editors can update"
on public.definitions for update
to authenticated
using (
	deleted_at is null and (
		public.is_instance_admin()
		or exists (
			select 1 from public.project_members m
			where m.project_id = definitions.project_id
			and m.user_id = auth.uid()
			and m.deleted_at is null
			and m.role in ('owner', 'editor')
		)
		or exists (
			select 1 from public.projects p
			where p.id = definitions.project_id
			and p.deleted_at is null
			and p.auto_join_on_upload = true
			and definitions.owner_id = auth.uid()
		)
	)
)
with check (
	public.is_instance_admin()
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1 from public.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
);

create policy "definitions: editors can delete"
on public.definitions for delete
to authenticated
using (
	public.is_instance_admin()
	or exists (
		select 1 from public.project_members m
		where m.project_id = definitions.project_id
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1 from public.projects p
		where p.id = definitions.project_id
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and definitions.owner_id = auth.uid()
	)
);

alter table public.definition_versions enable row level security;

-- Versions inherit visibility from the parent definition (which inherits
-- from the parent project). Versions are immutable — no UPDATE policy.
create policy "definition_versions: visible via parent"
on public.definition_versions for select
to authenticated
using (
	exists (
		select 1 from public.definitions d
		where d.guid = definition_versions.definition_guid
		and d.deleted_at is null
		and public.visible_project(d.project_id)
	)
);

create policy "definition_versions: editors can insert"
on public.definition_versions for insert
to authenticated
with check (
	public.is_instance_admin()
	or exists (
		select 1
		from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1
		from public.definitions d
		join public.projects p on p.id = d.project_id
		where d.guid = definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
		and definition_versions.uploaded_by = auth.uid()
	)
);


-- ============================================================================
-- 8. invites
-- ============================================================================

-- `org_id ... on delete cascade` only fires when the org is HARD-deleted.
-- The standard `deleteOrg` path is a soft-delete (UPDATE deleted_at), so the
-- SupabaseOrgStore.deleteOrg cascade explicitly DELETEs invites for the org;
-- see SupabaseOrgStore.ts. Same pattern for compute_servers below.
-- Invite tokens are HMAC-hashed at the route layer (compute-app's
-- `lib/server/invites/token.server.ts`) before reaching the store — the raw
-- token is shown to the admin once and never persisted. A DB-only leak
-- therefore can't be replayed without the instance's INVITE_TOKEN_SECRET.
-- Mirrors the share-link design (`share_links.token_hash`).
create table if not exists public.invites (
	id uuid primary key,
	token_hash text not null unique,
	email text not null,
	org_id uuid not null references public.orgs(id) on delete cascade,
	org_role text not null check (org_role in ('owner', 'admin', 'member')),
	org_permissions text[] not null default '{}',
	invited_by uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now(),
	expires_at timestamptz not null,
	accepted_at timestamptz,
	accepted_by_user_id uuid references auth.users(id) on delete set null
);

create index if not exists idx_invites_org on public.invites(org_id, created_at desc);

alter table public.invites enable row level security;

create policy "invites: manage_org_members can read org invites"
on public.invites for select
to authenticated
using (public.has_org_permission(org_id, 'manage_org_members'));

create policy "invites: manage_org_members can insert"
on public.invites for insert
to authenticated
with check (public.has_org_permission(org_id, 'manage_org_members'));

create policy "invites: manage_org_members can update"
on public.invites for update
to authenticated
using (public.has_org_permission(org_id, 'manage_org_members'))
with check (public.has_org_permission(org_id, 'manage_org_members'));

create policy "invites: manage_org_members can delete"
on public.invites for delete
to authenticated
using (public.has_org_permission(org_id, 'manage_org_members'));

-- Hash-gated read via SECURITY DEFINER so the token itself is the capability.
-- Caller hashes the raw URL token at the route layer and passes the digest;
-- the function just looks up the row. Returns SETOF so a missing match
-- becomes an empty array (not a composite of nulls).
create or replace function public.get_invite_by_token_hash(h text)
returns setof public.invites
language sql stable security definer set search_path = public
as $$
	select *
	from public.invites
	where token_hash = h
	and accepted_at is null
	and expires_at > now()
	limit 1;
$$;
grant execute on function public.get_invite_by_token_hash(text) to anon, authenticated, service_role;


-- ============================================================================
-- 9. compute_servers (spec §3 BYO compute)
--
-- Row shape:
--   * org_id IS NULL     → instance-pool server (managed by instance_admin
--                          via `manage_compute` platform permission).
--   * org_id IS NOT NULL → per-org override; managed by an org member
--                          holding `manage_org_compute`.
--
-- The platform flag ALLOW_ORG_COMPUTE_OVERRIDE gates org-row writes at the
-- TS layer. The DB policy still accepts them so flipping the flag on
-- doesn't require a policy change.
--
-- Cascade note: the `org_id` FK below is `on delete cascade`, but `deleteOrg`
-- is a soft-delete and never triggers it. SupabaseOrgStore.deleteOrg
-- explicitly DELETEs from `compute_server_defaults` and `compute_servers`
-- for the org. The FK cascade only matters for the eventual hard-delete
-- janitor.
-- ============================================================================

create table if not exists public.compute_servers (
	id uuid primary key,
	org_id uuid references public.orgs(id) on delete cascade,
	label text not null,
	server_url text not null,
	api_key text,
	timeout_ms integer,
	retry_count integer,
	created_at timestamptz not null default now()
);
create index if not exists idx_compute_servers_org on public.compute_servers(org_id);

create table if not exists public.compute_server_defaults (
	org_id uuid primary key references public.orgs(id) on delete cascade,
	default_server_id uuid references public.compute_servers(id) on delete set null
);

create table if not exists public.compute_server_platform_default (
	singleton boolean primary key default true,
	default_server_id uuid references public.compute_servers(id) on delete set null,
	check (singleton)
);
insert into public.compute_server_platform_default (singleton, default_server_id)
	values (true, null)
on conflict (singleton) do nothing;

alter table public.compute_servers enable row level security;
alter table public.compute_server_defaults enable row level security;
alter table public.compute_server_platform_default enable row level security;

create policy "compute_servers: members can read"
on public.compute_servers for select
to authenticated
using (
	public.is_instance_admin()
	or org_id is null
	or public.is_org_member(org_id)
);

-- Writes:
--   * Instance pool (org_id is null) → only instance_admin may write.
--   * Org override (org_id is not null) → manage_org_compute grant required.
create policy "compute_servers: scoped write"
on public.compute_servers for all
to authenticated
using (
	public.is_instance_admin()
	or (org_id is not null and public.has_org_permission(org_id, 'manage_org_compute'))
)
with check (
	public.is_instance_admin()
	or (org_id is not null and public.has_org_permission(org_id, 'manage_org_compute'))
);

create policy "compute_server_defaults: members can read"
on public.compute_server_defaults for select
to authenticated
using (public.is_instance_admin() or public.is_org_member(org_id));

create policy "compute_server_defaults: manage_org_compute can write"
on public.compute_server_defaults for all
to authenticated
using (public.is_instance_admin() or public.has_org_permission(org_id, 'manage_org_compute'))
with check (public.is_instance_admin() or public.has_org_permission(org_id, 'manage_org_compute'));

create policy "compute_server_platform_default: read all"
on public.compute_server_platform_default for select
to authenticated
using (true);

create policy "compute_server_platform_default: admin write"
on public.compute_server_platform_default for all
to authenticated
using (public.is_instance_admin())
with check (public.is_instance_admin());


-- ============================================================================
-- 10. share_links (spec §7)
--
-- Per-definition tokens granting unauthenticated access to one
-- (definitionId, channel). token_hash is HMAC(SHARE_LINK_SECRET, raw); the
-- raw token is shown to the minter once at creation.
-- ============================================================================

create table if not exists public.share_links (
	id uuid primary key,
	definition_guid uuid not null references public.definitions(guid) on delete cascade,
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
	on public.share_links(definition_guid, created_at desc)
	where revoked_at is null;

-- Atomic check-and-increment. Returns the new solve_count on success, NULL
-- when the cap was reached (no row updated) or the link is revoked /
-- expired / missing. Single-statement = no race even under concurrent solves.
create or replace function public.try_increment_share_link_solve_count(link_id uuid)
returns integer
language sql security definer set search_path = public
as $$
	update public.share_links
	set solve_count = solve_count + 1
	where id = link_id
	  and revoked_at is null
	  and (expires_at is null or expires_at > now())
	  and (max_solves is null or solve_count < max_solves)
	returning solve_count;
$$;
grant execute on function public.try_increment_share_link_solve_count(uuid)
	to authenticated, anon, service_role;

alter table public.share_links enable row level security;

-- Read/insert/revoke: same authority that can edit the parent definition
-- (project owner/editor or commons-mode definition owner). Token resolution
-- uses the SECURITY DEFINER RPC + service-role and bypasses RLS — the token
-- IS the credential there.

create policy "share_links: editors can read"
on public.share_links for select
to authenticated
using (
	revoked_at is null and (
		public.is_instance_admin()
		or exists (
			select 1
			from public.definitions d
			join public.project_members m on m.project_id = d.project_id
			where d.guid = share_links.definition_guid
			and d.deleted_at is null
			and m.user_id = auth.uid()
			and m.deleted_at is null
			and m.role in ('owner', 'editor')
		)
		or exists (
			select 1
			from public.definitions d
			join public.projects p on p.id = d.project_id
			where d.guid = share_links.definition_guid
			and d.deleted_at is null
			and p.deleted_at is null
			and p.auto_join_on_upload = true
			and d.owner_id = auth.uid()
		)
	)
);

create policy "share_links: editors can insert"
on public.share_links for insert
to authenticated
with check (
	public.is_instance_admin()
	or exists (
		select 1
		from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
	or exists (
		select 1
		from public.definitions d
		join public.projects p on p.id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and p.deleted_at is null
		and p.auto_join_on_upload = true
		and d.owner_id = auth.uid()
	)
);

-- UPDATE policy covers `revoke` (set revoked_at). Same authority as insert.
create policy "share_links: editors can revoke"
on public.share_links for update
to authenticated
using (
	public.is_instance_admin()
	or exists (
		select 1
		from public.definitions d
		join public.project_members m on m.project_id = d.project_id
		where d.guid = share_links.definition_guid
		and d.deleted_at is null
		and m.user_id = auth.uid()
		and m.deleted_at is null
		and m.role in ('owner', 'editor')
	)
)
with check (
	public.is_instance_admin()
	or exists (
		select 1
		from public.definitions d
		join public.project_members m on m.project_id = d.project_id
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
-- selva-public:  anyone reads, authenticated writes/deletes.
-- selva-private: authenticated only for everything; app-layer checks layer
--                visibility on top via /api/files.
-- Service-role bypasses RLS entirely — admin paths and the conformance
-- suite rely on that.
-- ============================================================================

create policy "selva-public: anyone can read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'selva-public');

create policy "selva-public: authenticated can write"
on storage.objects for insert
to authenticated
with check (bucket_id = 'selva-public');

create policy "selva-public: authenticated can update"
on storage.objects for update
to authenticated
using (bucket_id = 'selva-public')
with check (bucket_id = 'selva-public');

create policy "selva-public: authenticated can delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'selva-public');

create policy "selva-private: authenticated can read"
on storage.objects for select
to authenticated
using (bucket_id = 'selva-private');

create policy "selva-private: authenticated can write"
on storage.objects for insert
to authenticated
with check (bucket_id = 'selva-private');

create policy "selva-private: authenticated can update"
on storage.objects for update
to authenticated
using (bucket_id = 'selva-private')
with check (bucket_id = 'selva-private');

create policy "selva-private: authenticated can delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'selva-private');


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

create table if not exists public.audit_events (
	id uuid primary key default gen_random_uuid(),
	type text not null,
	actor_id text not null,
	occurred_at timestamptz not null default now(),
	data jsonb not null
);

create index if not exists audit_events_occurred_at_idx
	on public.audit_events (occurred_at desc);

create index if not exists audit_events_type_occurred_at_idx
	on public.audit_events (type, occurred_at desc);

create index if not exists audit_events_actor_occurred_at_idx
	on public.audit_events (actor_id, occurred_at desc);

-- RLS: writes always go through service-role (the sink uses the service
-- client). Authenticated users have NO read access today — the audit-log
-- viewer UI will land later with its own instance_admin-only policy.
alter table public.audit_events enable row level security;
