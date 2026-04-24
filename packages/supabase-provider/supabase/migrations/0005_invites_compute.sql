-- Invites + compute_servers.
--
-- Permissions used here reflect the post-refactor vocabulary:
--   * Invite management → `manage_org_members` (org-scope).
--   * Instance-wide compute pool (rows with org_id IS NULL) → `manage_compute`
--     (platform-scope), callable only by an instance_admin.
--   * Per-org compute override (rows with org_id IS NOT NULL) →
--     `manage_org_compute` (org-scope).
--
-- BYO compute is gated at the TS layer by the `ALLOW_ORG_COMPUTE_OVERRIDE`
-- platform flag. When the flag is off the TS provider refuses to insert
-- non-null org_id rows; the DB policy below still accepts them so flipping
-- the flag on doesn't require a policy change. If you want defense in depth,
-- fold a platform-config check in here later — for now the TS boundary is
-- the single source of truth.

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
drop policy if exists "invites: manage_org_members can read org invites" on public.invites;
create policy "invites: manage_org_members can read org invites"
on public.invites for select
to authenticated
using (public.has_org_permission(org_id, 'manage_org_members'));

drop policy if exists "invites: manage_users can insert" on public.invites;
drop policy if exists "invites: manage_org_members can insert" on public.invites;
create policy "invites: manage_org_members can insert"
on public.invites for insert
to authenticated
with check (public.has_org_permission(org_id, 'manage_org_members'));

drop policy if exists "invites: manage_users can update" on public.invites;
drop policy if exists "invites: manage_org_members can update" on public.invites;
create policy "invites: manage_org_members can update"
on public.invites for update
to authenticated
using (public.has_org_permission(org_id, 'manage_org_members'))
with check (public.has_org_permission(org_id, 'manage_org_members'));

drop policy if exists "invites: manage_users can delete" on public.invites;
drop policy if exists "invites: manage_org_members can delete" on public.invites;
create policy "invites: manage_org_members can delete"
on public.invites for delete
to authenticated
using (public.has_org_permission(org_id, 'manage_org_members'));

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
--
-- Row shape:
--   * `org_id IS NULL`   → instance-pool server (managed by instance_admin
--                          via `manage_compute` platform permission).
--   * `org_id IS NOT NULL` → per-org override (BYO compute); managed by an
--                          org member holding `manage_org_compute`.

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
	public.is_instance_admin()
	or org_id is null
	or public.is_org_member(org_id)
);

-- Writes:
--   * Instance pool (org_id is null) → only instance_admin may write.
--   * Org override    (org_id is not null) → `manage_org_compute` grant required.
drop policy if exists "compute_servers: manage_compute can write" on public.compute_servers;
drop policy if exists "compute_servers: scoped write" on public.compute_servers;
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

drop policy if exists "compute_server_defaults: members can read" on public.compute_server_defaults;
create policy "compute_server_defaults: members can read"
on public.compute_server_defaults for select
to authenticated
using (public.is_instance_admin() or public.is_org_member(org_id));

-- compute_server_defaults always carries an org_id (PK), so write authority
-- is exactly `manage_org_compute` on that org (or instance_admin).
drop policy if exists "compute_server_defaults: manage_compute can write" on public.compute_server_defaults;
drop policy if exists "compute_server_defaults: manage_org_compute can write" on public.compute_server_defaults;
create policy "compute_server_defaults: manage_org_compute can write"
on public.compute_server_defaults for all
to authenticated
using (public.is_instance_admin() or public.has_org_permission(org_id, 'manage_org_compute'))
with check (public.is_instance_admin() or public.has_org_permission(org_id, 'manage_org_compute'));

drop policy if exists "compute_server_platform_default: read all" on public.compute_server_platform_default;
create policy "compute_server_platform_default: read all"
on public.compute_server_platform_default for select
to authenticated
using (true);

drop policy if exists "compute_server_platform_default: admin write" on public.compute_server_platform_default;
create policy "compute_server_platform_default: admin write"
on public.compute_server_platform_default for all
to authenticated
using (public.is_instance_admin())
with check (public.is_instance_admin());
