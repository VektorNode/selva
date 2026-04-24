-- Orgs, org_members, projects, project_members + RLS helpers and policies.
--
-- Design notes:
--  * All primary keys are UUIDs (matches the platform contract).
--  * `owner_id` / `user_id` columns FK to `auth.users(id)` with `on delete cascade`
--    so deleting a Supabase Auth user cleans up every related row.
--  * Slugs are unique within their parent (orgs globally, projects per org).
--  * `updated_at` is maintained by a trigger so stores don't have to remember.
--  * Helper SQL functions below (`is_instance_admin`, `is_org_member` etc.) are
--    the primitives RLS policies and `can_*` RPCs build on. Every one is
--    `SECURITY DEFINER` so it bypasses RLS itself (avoids recursion).
--  * Service role bypasses RLS entirely — admin/system code paths use it.
--
-- Audit + soft-delete (B3):
--  * Every tenant-owned table carries `created_by` / `updated_by` (where
--    applicable), `updated_at`, and `deleted_at`. Reads filter
--    `deleted_at is null`; deletes set `deleted_at` rather than DROPping rows.
--    A retention sweep (service-role) hard-deletes later.
--
-- Project flags (B4):
--  * `auto_join_on_upload` enables the commons model (see spec §4).
--  * `allow_anonymous` enables iframe-embed anonymous access.
--  * Both guarded by a CHECK that they may only be true when visibility='public'.

-- ── Tables ────────────────────────────────────────────────────────────────

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

-- Hot lookups (slug, id) should skip soft-deleted rows automatically.
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
	allow_anonymous boolean not null default false,
	owner_id uuid not null references auth.users(id) on delete cascade,
	created_by uuid references auth.users(id) on delete set null,
	updated_by uuid references auth.users(id) on delete set null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	deleted_at timestamptz,
	unique (org_id, slug),
	-- B4 invariant (defense in depth; TS validates first at the API boundary):
	-- commons and anonymous flags only make sense on public projects.
	constraint projects_flags_require_public check (
		(auto_join_on_upload = false and allow_anonymous = false)
		or visibility = 'public'
	)
);

create index if not exists idx_projects_org
	on public.projects(org_id) where deleted_at is null;

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

-- ── updated_at trigger ────────────────────────────────────────────────────
-- Keeps updated_at current on every UPDATE without adapter involvement.
-- (updated_by is set explicitly by the adapter; it can't be inferred here.)
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

drop trigger if exists trg_org_members_updated_at on public.org_members;
create trigger trg_org_members_updated_at before update on public.org_members
	for each row execute function public.set_updated_at();

drop trigger if exists trg_project_members_updated_at on public.project_members;
create trigger trg_project_members_updated_at before update on public.project_members
	for each row execute function public.set_updated_at();

-- ── Helper functions used by RLS policies ────────────────────────────────
-- Every helper is SECURITY DEFINER so it runs with the table owner's rights
-- and bypasses RLS on the tables it reads — otherwise `is_org_member` would
-- recurse into the `org_members` RLS policy it's supposed to evaluate.
--
-- Every helper filters `deleted_at is null` so soft-deleted rows don't leak
-- authority.

create or replace function public.is_instance_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.user_profiles
		where user_id = auth.uid() and 'instance_admin' = any(platform_permissions)
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
		where org_id = o and user_id = auth.uid() and deleted_at is null
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
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and role in ('owner', 'admin')
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
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and role = 'owner'
	);
$$;

-- `has_org_permission` checks the fine-grained grant on the caller's
-- membership. `instance_admin` bypass is separate — we keep this function
-- pure so the bypass lives in one place at the policy site.
create or replace function public.has_org_permission(o uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select public.is_instance_admin() or exists (
		select 1 from public.org_members
		where org_id = o and user_id = auth.uid() and deleted_at is null
		and perm = any(permissions)
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
		where project_id = p and user_id = auth.uid() and deleted_at is null
	);
$$;

-- Spec §5 `canView`: private → member, org → org member, public → everyone.
-- Never returns true for soft-deleted projects.
create or replace function public.visible_project(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
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

-- ── RLS: orgs ─────────────────────────────────────────────────────────────
alter table public.orgs enable row level security;

-- instance_admin sees everything; org members see their own orgs.
drop policy if exists "orgs: members and instance admins can read" on public.orgs;
drop policy if exists "orgs: members and platform admins can read" on public.orgs;
create policy "orgs: members and instance admins can read"
on public.orgs for select
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.is_org_member(id)));

-- Creating an org: the caller must be the owner they declare, and the
-- first `org_members` row is inserted in the same transaction by the app
-- (adapter). instance_admin can create on any user's behalf.
drop policy if exists "orgs: authenticated can create their own" on public.orgs;
create policy "orgs: authenticated can create their own"
on public.orgs for insert
to authenticated
with check (public.is_instance_admin() or owner_id = auth.uid());

drop policy if exists "orgs: owners and instance admins can update" on public.orgs;
drop policy if exists "orgs: owners and platform admins can update" on public.orgs;
create policy "orgs: owners and instance admins can update"
on public.orgs for update
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.is_org_owner(id)))
with check (public.is_instance_admin() or public.is_org_owner(id));

-- DELETE policy is retained for service-role retention sweeps. Application
-- code soft-deletes (sets deleted_at); it should not issue hard DELETEs.
drop policy if exists "orgs: owners and instance admins can delete" on public.orgs;
drop policy if exists "orgs: owners and platform admins can delete" on public.orgs;
create policy "orgs: owners and instance admins can delete"
on public.orgs for delete
to authenticated
using (public.is_instance_admin() or public.is_org_owner(id));

-- ── RLS: org_members ─────────────────────────────────────────────────────
alter table public.org_members enable row level security;

-- Any member of the org can see the roster. instance_admin sees everything.
drop policy if exists "org_members: org members can read roster" on public.org_members;
create policy "org_members: org members can read roster"
on public.org_members for select
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.is_org_member(org_id)));

-- Adding/updating/removing members requires org admin (or instance admin).
drop policy if exists "org_members: admins can insert" on public.org_members;
create policy "org_members: admins can insert"
on public.org_members for insert
to authenticated
with check (public.is_instance_admin() or public.is_org_admin(org_id));

drop policy if exists "org_members: admins can update" on public.org_members;
create policy "org_members: admins can update"
on public.org_members for update
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.is_org_admin(org_id)))
with check (public.is_instance_admin() or public.is_org_admin(org_id));

drop policy if exists "org_members: admins can delete" on public.org_members;
create policy "org_members: admins can delete"
on public.org_members for delete
to authenticated
using (public.is_instance_admin() or public.is_org_admin(org_id));

-- ── RLS: projects ────────────────────────────────────────────────────────
alter table public.projects enable row level security;

drop policy if exists "projects: visible to members" on public.projects;
create policy "projects: visible to members"
on public.projects for select
to authenticated
using (deleted_at is null and public.visible_project(id));

-- Creating a project requires `manage_projects` in the target org.
drop policy if exists "projects: manage_projects can create" on public.projects;
create policy "projects: manage_projects can create"
on public.projects for insert
to authenticated
with check (public.has_org_permission(org_id, 'manage_projects'));

-- A4: project settings (name, slug, description, visibility, flags) are
-- owner-only. Earlier drafts allowed editor + manage_projects; that side
-- channel is gone.
drop policy if exists "projects: owners or org admins can update" on public.projects;
drop policy if exists "projects: owners can update" on public.projects;
create policy "projects: owners can update"
on public.projects for update
to authenticated
using (
	deleted_at is null and (
		public.is_instance_admin()
		or owner_id = auth.uid()
	)
)
with check (
	public.is_instance_admin()
	or owner_id = auth.uid()
);

drop policy if exists "projects: owners or org admins can delete" on public.projects;
drop policy if exists "projects: owners can delete" on public.projects;
create policy "projects: owners can delete"
on public.projects for delete
to authenticated
using (public.is_instance_admin() or owner_id = auth.uid());

-- ── RLS: project_members ─────────────────────────────────────────────────
alter table public.project_members enable row level security;

drop policy if exists "project_members: visible to project members" on public.project_members;
create policy "project_members: visible to project members"
on public.project_members for select
to authenticated
using (deleted_at is null and (public.is_instance_admin() or public.visible_project(project_id)));

-- Managers = project owner or instance admin. canManage (§5) collapses to
-- owner-only; org admins no longer silently manage project members.
drop policy if exists "project_members: managers can insert" on public.project_members;
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

drop policy if exists "project_members: managers can update" on public.project_members;
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

drop policy if exists "project_members: managers can delete" on public.project_members;
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
