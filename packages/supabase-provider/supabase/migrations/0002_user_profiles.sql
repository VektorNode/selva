-- user_profiles: profile state (displayName, starred definitions, recent runs)
-- plus platform-scope permissions (platform_admin, etc.).
--
-- Identity (email, password, lifecycle) is owned by Supabase's `auth.users`.
-- This table extends it with the Selva-specific columns that `AuthUser` and
-- `UserProfile` surface. One row per user, PK = auth.users(id).
--
-- Auto-seeded by a trigger on `auth.users` insert so the adapter never has
-- to remember the create-user-then-create-profile two-step.

create table if not exists public.user_profiles (
	user_id uuid primary key references auth.users(id) on delete cascade,
	display_name text,
	platform_permissions text[] not null default '{}',
	starred_definitions uuid[] not null default '{}',
	-- recent_runs is a JSONB array of RecentRun objects, capped to 20 by
	-- the adapter. Using JSONB (not a child table) because the array is
	-- always read in full and is stale-tolerable.
	recent_runs jsonb not null default '[]',
	created_at timestamptz not null default now(),
	last_login_at timestamptz
);

-- ── Auto-create profile for every new auth.users row ─────────────────────
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

-- ── RLS: user_profiles ───────────────────────────────────────────────────
-- Users can read every profile (display names surface in member lists etc.)
-- but only update their own. Platform permissions can only be changed via
-- service role (the admin-scoped endpoints bypass RLS).

alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles: any authenticated can read" on public.user_profiles;
create policy "user_profiles: any authenticated can read"
on public.user_profiles for select
to authenticated
using (true);

drop policy if exists "user_profiles: users can update own" on public.user_profiles;
create policy "user_profiles: users can update own"
on public.user_profiles for update
to authenticated
using (user_id = auth.uid())
with check (
	user_id = auth.uid()
	-- Users cannot escalate their own platform permissions; only service-role
	-- writes (which bypass RLS) may change that column. We enforce by
	-- refusing any non-bypass update that changes platform_permissions.
	and platform_permissions is not distinct from (
		select platform_permissions from public.user_profiles where user_id = auth.uid()
	)
);
