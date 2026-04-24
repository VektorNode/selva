-- ============================================================================
-- TODO(access-control refactor / B1): permission identifier renames
--
-- This file gates invite + compute policies on the OLD permission names.
-- Rename the following consistently across policy names, comments, USING/WITH
-- CHECK clauses, and any indexes.
--
--   • Policy names + string literals:
--       `'manage_users'`   → `'manage_org_members'`   (invites gating)
--       `'manage_compute'` (when used via `has_org_permission(org_id, …)`)
--           → `'manage_org_compute'`
--   • Keep platform-level `'manage_compute'` when called via
--     `is_platform_admin()` — that check stays; see spec §2.
--   • `is_platform_admin()` call sites here → `is_instance_admin()`
--     (rename defined in migration 0003's TODO).
--
-- Additional work deferred to B4: add per-org compute override gating through
-- `ALLOW_ORG_COMPUTE_OVERRIDE` — when that platform flag is off, `manage_org_compute`
-- must be inert regardless of grant. Safest to leave policies strict for now
-- and add the flag check later.
-- ============================================================================

-- Invites + compute_servers.

-- ── Invites ───────────────────────────────────────────────────────────────

create table if not exists public.invites (
	id uuid primary key,
	token text not null unique,
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

drop policy if exists "invites: manage_users can read org invites" on public.invites;
create policy "invites: manage_users can read org invites"
on public.invites for select
to authenticated
using (public.has_org_permission(org_id, 'manage_users'));

drop policy if exists "invites: manage_users can insert" on public.invites;
create policy "invites: manage_users can insert"
on public.invites for insert
to authenticated
with check (public.has_org_permission(org_id, 'manage_users'));

drop policy if exists "invites: manage_users can update" on public.invites;
create policy "invites: manage_users can update"
on public.invites for update
to authenticated
using (public.has_org_permission(org_id, 'manage_users'))
with check (public.has_org_permission(org_id, 'manage_users'));

drop policy if exists "invites: manage_users can delete" on public.invites;
create policy "invites: manage_users can delete"
on public.invites for delete
to authenticated
using (public.has_org_permission(org_id, 'manage_users'));

-- Token-gated read via SECURITY DEFINER so the token itself is the capability.
--
-- Returns SETOF (not a single composite) so "no match" is an empty set and
-- PostgREST returns an empty array instead of an all-null-fields composite.
create or replace function public.get_invite_by_token(t text)
returns setof public.invites
language sql
stable
security definer
set search_path = public
as $$
	select *
	from public.invites
	where token = t
	and accepted_at is null
	and expires_at > now()
	limit 1;
$$;

grant execute on function public.get_invite_by_token(text) to anon, authenticated, service_role;

-- ── Compute servers ───────────────────────────────────────────────────────

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

drop policy if exists "compute_servers: members can read" on public.compute_servers;
create policy "compute_servers: members can read"
on public.compute_servers for select
to authenticated
using (
	public.is_platform_admin()
	or org_id is null
	or public.is_org_member(org_id)
);

drop policy if exists "compute_servers: manage_compute can write" on public.compute_servers;
create policy "compute_servers: manage_compute can write"
on public.compute_servers for all
to authenticated
using (
	public.is_platform_admin()
	or (org_id is not null and public.has_org_permission(org_id, 'manage_compute'))
)
with check (
	public.is_platform_admin()
	or (org_id is not null and public.has_org_permission(org_id, 'manage_compute'))
);

drop policy if exists "compute_server_defaults: members can read" on public.compute_server_defaults;
create policy "compute_server_defaults: members can read"
on public.compute_server_defaults for select
to authenticated
using (public.is_platform_admin() or public.is_org_member(org_id));

drop policy if exists "compute_server_defaults: manage_compute can write" on public.compute_server_defaults;
create policy "compute_server_defaults: manage_compute can write"
on public.compute_server_defaults for all
to authenticated
using (public.is_platform_admin() or public.has_org_permission(org_id, 'manage_compute'))
with check (public.is_platform_admin() or public.has_org_permission(org_id, 'manage_compute'));

drop policy if exists "compute_server_platform_default: read all" on public.compute_server_platform_default;
create policy "compute_server_platform_default: read all"
on public.compute_server_platform_default for select
to authenticated
using (true);

drop policy if exists "compute_server_platform_default: admin write" on public.compute_server_platform_default;
create policy "compute_server_platform_default: admin write"
on public.compute_server_platform_default for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());
