-- ============================================================================
-- Concurrent permission writes queue instead of deadlocking
--
-- Each call locks its target, then the surviving admins, so two admins demoting
-- each other hold what the other wants. Postgres kills one and that caller gets
-- a 40P01 rather than `last_admin`. The advisory lock lets one call run at a
-- time, which is cheap: permission writes are rare.
-- ============================================================================

create or replace function selva.set_platform_permissions(
	p_user_id uuid,
	p_permissions text[]
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
	v_is_demotion boolean;
	v_others integer;
	v_updated integer;
begin
	perform pg_advisory_xact_lock(hashtext('selva.set_platform_permissions'));

	select 'instance_admin' = any(platform_permissions)
	       and not ('instance_admin' = any(p_permissions))
	into v_is_demotion
	from selva.user_profiles
	where user_id = p_user_id
	for update;

	if not found then
		return 0;
	end if;

	if v_is_demotion then
		-- Row locks still guard against `disabled` changing underneath the count.
		perform 1
		from selva.user_profiles
		where user_id <> p_user_id
		  and disabled = false
		  and 'instance_admin' = any(platform_permissions)
		for update;

		select count(*) into v_others
		from selva.user_profiles
		where user_id <> p_user_id
		  and disabled = false
		  and 'instance_admin' = any(platform_permissions);

		if v_others = 0 then
			return 0;
		end if;
	end if;

	update selva.user_profiles
	set platform_permissions = p_permissions
	where user_id = p_user_id;

	get diagnostics v_updated = row_count;
	return v_updated;
end;
$$;
