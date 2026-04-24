-- ============================================================================
-- TODO(access-control refactor / B1): permission identifier renames
--
-- The TypeScript platform contract (spec: compute-app/src/routes/admin/Permissions.md)
-- was renamed. This SQL must follow to keep RLS aligned. All renames are
-- hand-fixes; no migration needed (nothing is live).
--
--   • Helper function `is_platform_admin()`      → rename to `is_instance_admin()`
--     and change its body to match `'instance_admin' = any(platform_permissions)`.
--     Every policy below calls this function; rename call sites too.
--
--   • String literal `'platform_admin'` (in `is_platform_admin` body and any
--     manual checks in policies)                → `'instance_admin'`
--
-- See related migrations 0002, 0004, 0005, 0007 for additional call-site renames.
-- ============================================================================

-- ============================================================================
-- TODO(access-control refactor / B3): audit fields + soft delete
--
-- Add the following columns to every tenant-owned table in this file. All are
-- additive — existing rows take a default. The TS mappers already fall back to
-- owner-equivalent ids when columns are null, so the code runs safely
-- pre-migration.
--
-- Tables to extend:
--   public.orgs          → add  created_by uuid references auth.users(id),
--                              updated_by uuid references auth.users(id),
--                              deleted_at timestamptz null
--                         defaults: created_by = owner_id, updated_by = owner_id
--                         (backfill existing rows with the owner on migration).
--
--   public.org_members   → add  updated_at timestamptz not null default now(),
--                              updated_by uuid references auth.users(id),
--                              deleted_at timestamptz null
--                         defaults: updated_at = joined_at, updated_by = user_id.
--                         Add a trigger to keep updated_at current on role/perm change.
--
--   public.projects      → add  created_by uuid references auth.users(id),
--                              updated_by uuid references auth.users(id),
--                              deleted_at timestamptz null
--                         defaults mirror public.orgs.
--
--   public.project_members → add updated_at timestamptz not null default now(),
--                               updated_by uuid references auth.users(id),
--                               deleted_at timestamptz null
--                         defaults mirror public.org_members.
--
-- RLS impact: every SELECT/UPDATE/DELETE policy on these tables must include
-- `deleted_at is null` in the USING clause. Adds on DELETE policies are
-- effectively dead since the TS layer soft-deletes (sets deleted_at); a
-- hard-delete retention sweep will run as service-role later.
--
-- Indexes: add a partial index `where deleted_at is null` on every hot-read
-- column (orgs.slug, projects.slug+org_id, org_members(org_id,user_id)).
-- ============================================================================

-- Orgs, org_members, projects, project_members + RLS helpers and policies.
--
-- Design notes:
--  * All primary keys are UUIDs (matches the platform contract).
--  * `owner_id` / `user_id` columns FK to `auth.users(id)` with `on delete cascade`
--    so deleting a Supabase Auth user cleans up every related row.
--  * Slugs are unique within their parent (orgs globally, projects per org).
--  * `updated_at` is maintained by a trigger so stores don't have to remember.
--  * Helper SQL functions below (`is_platform_admin`, `is_org_member` etc.) are
--    the primitives RLS policies and `can_*` RPCs build on. Every one is
--    `SECURITY DEFINER` so it bypasses RLS itself (avoids recursion).
--  * Service role bypasses RLS entirely — admin/system code paths use it.

-- ── Tables ────────────────────────────────────────────────────────────────

create table if not exists public.orgs (
	id uuid primary key,
	name text not null,
	slug text not null unique,
	owner_id uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.org_members (
	org_id uuid not null references public.orgs(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	role text not null check (role in ('owner', 'admin', 'member')),
	permissions text[] not null default '{}',
	joined_at timestamptz not null default now(),
	primary key (org_id, user_id)
);

create index if not exists idx_org_members_user on public.org_members(user_id);

create table if not exists public.projects (
	id uuid primary key,
	org_id uuid not null references public.orgs(id) on delete cascade,
	name text not null,
	slug text not null,
	description text,
	visibility text not null check (visibility in ('public', 'org', 'private')),
	owner_id uuid not null references auth.users(id) on delete cascade,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (org_id, slug)
);

create index if not exists idx_projects_org on public.projects(org_id);

create table if not exists public.project_members (
	project_id uuid not null references public.projects(id) on delete cascade,
	user_id uuid not null references auth.users(id) on delete cascade,
	role text not null check (role in ('owner', 'editor', 'viewer')),
	joined_at timestamptz not null default now(),
	primary key (project_id, user_id)
);

create index if not exists idx_project_members_user on public.project_members(user_id);

-- ── updated_at trigger ────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;

drop trigger if exists trg_orgs_updated_at on public.orgs;
create trigger trg_orgs_updated_at before update on public.orgs
	for each row execute function public.set_updated_at();

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects
	for each row execute function public.set_updated_at();

-- ── Helper functions used by RLS policies ────────────────────────────────
-- Every helper is SECURITY DEFINER so it runs with the table owner's rights
-- and bypasses RLS on the tables it reads — otherwise `is_org_member` would
-- recurse into the `org_members` RLS policy it's supposed to evaluate.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.user_profiles
		where user_id = auth.uid() and 'platform_admin' = any(platform_permissions)
	);
$$;

create or replace function public.is_org_member(o uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.org_members
		where org_id = o and user_id = auth.uid()
	);
$$;

create or replace function public.is_org_admin(o uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.org_members
		where org_id = o and user_id = auth.uid() and role in ('owner', 'admin')
	);
$$;

create or replace function public.is_org_owner(o uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.org_members
		where org_id = o and user_id = auth.uid() and role = 'owner'
	);
$$;

create or replace function public.has_org_permission(o uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select public.is_platform_admin() or exists (
		select 1 from public.org_members
		where org_id = o and user_id = auth.uid() and perm = any(permissions)
	);
$$;

create or replace function public.is_project_member(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.project_members
		where project_id = p and user_id = auth.uid()
	);
$$;

create or replace function public.visible_project(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select public.is_platform_admin() or exists (
		select 1
		from public.projects
		where id = p
		and (
			visibility = 'public'
			or (visibility = 'org' and public.is_org_member(org_id))
			or public.is_project_member(id)
		)
	);
$$;

-- ── RLS: orgs ─────────────────────────────────────────────────────────────
alter table public.orgs enable row level security;

-- platform_admin sees everything; org members see their own orgs.
drop policy if exists "orgs: members and platform admins can read" on public.orgs;
create policy "orgs: members and platform admins can read"
on public.orgs for select
to authenticated
using (public.is_platform_admin() or public.is_org_member(id));

-- Creating an org: the caller must be the owner they declare, and the
-- first `org_members` row is inserted in the same transaction by the app
-- (adapter). Platform admins can create on any user's behalf.
drop policy if exists "orgs: authenticated can create their own" on public.orgs;
create policy "orgs: authenticated can create their own"
on public.orgs for insert
to authenticated
with check (public.is_platform_admin() or owner_id = auth.uid());

drop policy if exists "orgs: owners and platform admins can update" on public.orgs;
create policy "orgs: owners and platform admins can update"
on public.orgs for update
to authenticated
using (public.is_platform_admin() or public.is_org_owner(id))
with check (public.is_platform_admin() or public.is_org_owner(id));

drop policy if exists "orgs: owners and platform admins can delete" on public.orgs;
create policy "orgs: owners and platform admins can delete"
on public.orgs for delete
to authenticated
using (public.is_platform_admin() or public.is_org_owner(id));

-- ── RLS: org_members ─────────────────────────────────────────────────────
alter table public.org_members enable row level security;

-- Any member of the org can see the roster. Platform admins see everything.
drop policy if exists "org_members: org members can read roster" on public.org_members;
create policy "org_members: org members can read roster"
on public.org_members for select
to authenticated
using (public.is_platform_admin() or public.is_org_member(org_id));

-- Adding/updating/removing members requires org admin (or platform admin).
drop policy if exists "org_members: admins can insert" on public.org_members;
create policy "org_members: admins can insert"
on public.org_members for insert
to authenticated
with check (public.is_platform_admin() or public.is_org_admin(org_id));

drop policy if exists "org_members: admins can update" on public.org_members;
create policy "org_members: admins can update"
on public.org_members for update
to authenticated
using (public.is_platform_admin() or public.is_org_admin(org_id))
with check (public.is_platform_admin() or public.is_org_admin(org_id));

drop policy if exists "org_members: admins can delete" on public.org_members;
create policy "org_members: admins can delete"
on public.org_members for delete
to authenticated
using (public.is_platform_admin() or public.is_org_admin(org_id));

-- ── RLS: projects ────────────────────────────────────────────────────────
alter table public.projects enable row level security;

drop policy if exists "projects: visible to members" on public.projects;
create policy "projects: visible to members"
on public.projects for select
to authenticated
using (public.visible_project(id));

-- Creating a project requires `manage_projects` in the target org.
drop policy if exists "projects: manage_projects can create" on public.projects;
create policy "projects: manage_projects can create"
on public.projects for insert
to authenticated
with check (public.has_org_permission(org_id, 'manage_projects'));

drop policy if exists "projects: owners or org admins can update" on public.projects;
create policy "projects: owners or org admins can update"
on public.projects for update
to authenticated
using (
	public.is_platform_admin()
	or owner_id = auth.uid()
	or public.is_org_admin(org_id)
	or public.has_org_permission(org_id, 'manage_projects')
)
with check (
	public.is_platform_admin()
	or owner_id = auth.uid()
	or public.is_org_admin(org_id)
	or public.has_org_permission(org_id, 'manage_projects')
);

drop policy if exists "projects: owners or org admins can delete" on public.projects;
create policy "projects: owners or org admins can delete"
on public.projects for delete
to authenticated
using (
	public.is_platform_admin()
	or owner_id = auth.uid()
	or public.is_org_admin(org_id)
	or public.has_org_permission(org_id, 'manage_projects')
);

-- ── RLS: project_members ─────────────────────────────────────────────────
alter table public.project_members enable row level security;

drop policy if exists "project_members: visible to project members" on public.project_members;
create policy "project_members: visible to project members"
on public.project_members for select
to authenticated
using (public.is_platform_admin() or public.visible_project(project_id));

drop policy if exists "project_members: managers can insert" on public.project_members;
create policy "project_members: managers can insert"
on public.project_members for insert
to authenticated
with check (
	public.is_platform_admin()
	or exists (
		select 1 from public.projects p
		where p.id = project_id
		and (p.owner_id = auth.uid() or public.is_org_admin(p.org_id))
	)
);

drop policy if exists "project_members: managers can update" on public.project_members;
create policy "project_members: managers can update"
on public.project_members for update
to authenticated
using (
	public.is_platform_admin()
	or exists (
		select 1 from public.projects p
		where p.id = project_id
		and (p.owner_id = auth.uid() or public.is_org_admin(p.org_id))
	)
)
with check (
	public.is_platform_admin()
	or exists (
		select 1 from public.projects p
		where p.id = project_id
		and (p.owner_id = auth.uid() or public.is_org_admin(p.org_id))
	)
);

drop policy if exists "project_members: managers can delete" on public.project_members;
create policy "project_members: managers can delete"
on public.project_members for delete
to authenticated
using (
	public.is_platform_admin()
	or exists (
		select 1 from public.projects p
		where p.id = project_id
		and (p.owner_id = auth.uid() or public.is_org_admin(p.org_id))
	)
);
