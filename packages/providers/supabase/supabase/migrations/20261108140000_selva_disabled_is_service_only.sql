-- ============================================================================
-- A disabled user is banned in GoTrue and flagged in app_metadata
--
-- user_metadata belongs to the user: GoTrue lets them rewrite it through
-- PUT /auth/v1/user, so a disabled flag there is one they can lift. The auth
-- provider bans the user (ban_duration) and sets app_metadata.disabled, which
-- only the service role writes; user_profiles.disabled follows those two.
--
-- A ban refuses new sessions and refreshes but cannot recall an access token
-- already issued. PostgREST's pre-request hook therefore refuses every request
-- whose caller is disabled, so that token reads and writes nothing, through
-- any table or function, until it expires.
-- ============================================================================

create or replace function selva.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into selva.user_profiles (user_id, disabled)
	values (
		new.id,
		coalesce(new.raw_app_meta_data ->> 'disabled' = 'true', false)
		or coalesce(new.banned_until > now(), false)
	)
	on conflict (user_id) do nothing;
	return new;
end;
$$;

create or replace function selva.sync_auth_user_disabled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	update selva.user_profiles
	set disabled = coalesce(new.raw_app_meta_data ->> 'disabled' = 'true', false)
		or coalesce(new.banned_until > now(), false)
	where user_id = new.id;
	return new;
end;
$$;

drop trigger if exists trg_auth_user_disabled_sync on auth.users;
create trigger trg_auth_user_disabled_sync
	after update of raw_app_meta_data, banned_until on auth.users
	for each row
	when (
		old.raw_app_meta_data ->> 'disabled' is distinct from new.raw_app_meta_data ->> 'disabled'
		or old.banned_until is distinct from new.banned_until
	)
	execute function selva.sync_auth_user_disabled();

-- Users disabled through user_metadata alone keep that state, now where they
-- cannot clear it.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"disabled": true}'::jsonb,
	banned_until = now() + interval '100 years'
where raw_user_meta_data ->> 'disabled' = 'true'
	and raw_app_meta_data ->> 'disabled' is distinct from 'true';

update selva.user_profiles p
set disabled = coalesce(u.raw_app_meta_data ->> 'disabled' = 'true', false)
	or coalesce(u.banned_until > now(), false)
from auth.users u
where u.id = p.user_id
	and p.disabled is distinct from (
		coalesce(u.raw_app_meta_data ->> 'disabled' = 'true', false)
		or coalesce(u.banned_until > now(), false)
	);

-- Runs before every PostgREST request, as the request's role. One primary-key
-- lookup; anon and the service role carry no auth.uid() and pass.
create or replace function selva.refuse_disabled_caller()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if exists (
		select 1 from selva.user_profiles where user_id = auth.uid() and disabled
	) then
		raise exception 'This account is disabled.' using errcode = '42501';
	end if;
end;
$$;

revoke all on function selva.refuse_disabled_caller() from public;
grant execute on function selva.refuse_disabled_caller() to anon, authenticated, service_role;

-- A host that needs its own pre-request hook calls this one from it.
alter role authenticator set pgrst.db_pre_request = 'selva.refuse_disabled_caller';
notify pgrst, 'reload config';
