-- ============================================================================
-- user_profiles.disabled denormalization + platform_permissions GIN index
--
-- The instance-admin invariant queries ("is there an enabled instance_admin?",
-- "how many enabled admins besides X?") previously selected candidate ids and
-- then called the GoTrue admin API once per candidate just to read
-- user_metadata.disabled — an N+1 on the bootstrap and admin-write paths.
--
-- auth.users.raw_user_meta_data->>'disabled' stays the source of truth (the
-- auth provider keeps writing it via the admin API); user_profiles.disabled is
-- a trigger-maintained read-model copy so the invariant collapses to a single
-- indexed query. The GIN index serves the `platform_permissions @> ...`
-- filters those queries already used.
-- ============================================================================

alter table selva.user_profiles
	add column if not exists disabled boolean not null default false;

-- Signup seed: carry disabled state for users created already-disabled (e.g.
-- via the Supabase dashboard). Conflict semantics unchanged (do nothing) —
-- a profile row can only pre-exist on re-fired triggers, where the update
-- trigger below owns the sync.
create or replace function selva.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into selva.user_profiles (user_id, disabled)
	values (new.id, coalesce((new.raw_user_meta_data ->> 'disabled')::boolean, false))
	on conflict (user_id) do nothing;
	return new;
end;
$$;

-- Sync disable/enable flips. The original mirror trigger is INSERT-only, so
-- without this the read-model copy would never see a later flip (which lands
-- as an UPDATE of raw_user_meta_data through the GoTrue admin API).
create or replace function selva.sync_auth_user_disabled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	update selva.user_profiles
	set disabled = coalesce((new.raw_user_meta_data ->> 'disabled')::boolean, false)
	where user_id = new.id;
	return new;
end;
$$;

drop trigger if exists trg_auth_user_disabled_sync on auth.users;
create trigger trg_auth_user_disabled_sync
	after update of raw_user_meta_data on auth.users
	for each row
	when (
		coalesce(old.raw_user_meta_data ->> 'disabled', 'false')
		is distinct from coalesce(new.raw_user_meta_data ->> 'disabled', 'false')
	)
	execute function selva.sync_auth_user_disabled();

-- Backfill existing rows from the source of truth.
update selva.user_profiles p
set disabled = coalesce((u.raw_user_meta_data ->> 'disabled')::boolean, false)
from auth.users u
where u.id = p.user_id
	and p.disabled is distinct from coalesce((u.raw_user_meta_data ->> 'disabled')::boolean, false);

-- The `platform_permissions @> '{instance_admin}'` filters in the permission
-- store were sequential scans without this.
create index if not exists idx_user_profiles_platform_permissions
	on selva.user_profiles using gin (platform_permissions);

-- Extend the self-update RLS policy: users must not be able to clear their own
-- disabled flag (same freeze pattern as platform_permissions — only
-- service-role writes and the sync trigger may change it).
drop policy if exists "user_profiles: users can update own" on selva.user_profiles;

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
	and disabled is not distinct from (
		select disabled from selva.user_profiles where user_id = auth.uid()
	)
);
