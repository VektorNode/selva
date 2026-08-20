-- ============================================================================
-- The sole-instance_admin invariant becomes atomic (audit finding 17)
--
-- §2: "Any operation that would leave the instance with zero instance_admins —
-- revoking, deleting, disabling — is rejected by the data layer." It was
-- enforced as read-then-write with nothing in between:
--
--   others = count admins where user_id <> target and not disabled
--   if others = 0 -> refuse
--   update user_profiles set platform_permissions = ...
--
-- Two admins demoting each other at the same moment both read `others = 1`,
-- both pass the check, and both commit. Zero admins, and the instance can no
-- longer be administered through the UI at all. Supabase is the worse case:
-- the app runs on several instances, so the two requests are genuinely
-- concurrent rather than interleaved on one event loop.
--
-- §7's share-link solve cap already solved this shape — check and write in a
-- single statement, with the predicate in the WHERE clause so Postgres
-- evaluates it against the row it is about to lock. This applies the same
-- pattern. `try_increment_share_link_solve_count` is the template.
-- ============================================================================

-- Returns the row count so the caller can tell the outcomes apart:
--   1 -> written
--   0 -> refused (would drop the last enabled admin) OR row absent
-- The caller disambiguates with a follow-up existence check, which is safe
-- because a missing row cannot become present concurrently in a way that
-- matters — `ensureUser` seeds rows, it never removes them.
--
-- A bare `exists` in the UPDATE's WHERE clause is NOT enough, and the
-- conformance suite proves it: under READ COMMITTED the subquery reads the
-- snapshot taken when the statement began, so four concurrent demotions each
-- see the other three as still-admins and all four commit. The predicate has
-- to take real locks, hence the explicit `for update` below.
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
	-- Lock the target first, always in this order (target, then survivors), so
	-- two demotions of different users can't deadlock by grabbing each other's
	-- rows in the opposite sequence.
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
		-- `for update` makes concurrent demotions serialize on the surviving
		-- admin rows: the second waits for the first to commit, then re-reads
		-- and observes the demotion it would otherwise have raced through.
		-- Counted by locking the rows first and re-checking them after, because
		-- a lock wait re-reads the row and it may no longer qualify.
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

-- Service-role only: `SupabasePlatformPermissionStore` runs service-role
-- throughout and gates on `assertAdmin` in code (RLS on `user_profiles` is too
-- coarse for cross-user writes). Granting this to `authenticated` would hand
-- every logged-in user a permission-write bypassing that gate.
revoke execute on function selva.set_platform_permissions(uuid, text[]) from public;
grant execute on function selva.set_platform_permissions(uuid, text[]) to service_role;
