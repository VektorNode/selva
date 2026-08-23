-- ============================================================================
-- First-admin bootstrap becomes atomic (audit finding 20)
--
-- §2: "first signer wins" on a fresh instance. It was enforced as
-- read-then-write in `bootstrapUserSession`:
--
--   if not hasInstanceAdmin() then set(user, ALL_PLATFORM_PERMISSIONS)
--
-- On a single-tenant install with no BOOTSTRAP_INSTANCE_ADMIN_EMAIL set,
-- `shouldBootstrapAdmin` returns true for ANY signer — so two different people
-- signing in at the same moment both observe "no admin" and both are granted
-- every platform permission, permanently. Supabase is the worse case: the app
-- runs on several instances, so the two requests are genuinely concurrent
-- rather than interleaved on one event loop.
--
-- Same shape as `set_platform_permissions` (finding 17) pointing the other
-- way: that one refuses to drop the LAST admin, this one refuses to create a
-- SECOND first admin. The lesson from that migration applies here verbatim —
-- a bare `not exists (...)` in the UPDATE's WHERE clause is not enough, because
-- under READ COMMITTED the subquery reads the snapshot taken when the statement
-- began and both racers see an empty table. The predicate has to take a real
-- lock.
--
-- There is no row to lock here (the point is that no admin row exists), so this
-- takes a transaction-scoped advisory lock instead. The second caller blocks,
-- then re-reads after the first commits and correctly sees an admin.
-- ============================================================================

-- Returns true if THIS call claimed the instance, false if an admin already
-- existed or the target profile is absent. Idempotent under concurrency: at
-- most one caller can ever observe true for a given instance.
create or replace function selva.claim_first_instance_admin(
	p_user_id uuid,
	p_permissions text[]
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
	v_updated integer;
begin
	-- Transaction-scoped, released on commit/rollback. The key is an arbitrary
	-- constant naming this invariant — every caller of this function contends
	-- on the same one, which is exactly the intent: bootstrap happens once per
	-- instance, so serializing all attempts costs nothing after the first.
	perform pg_advisory_xact_lock(hashtext('selva.first_instance_admin'));

	-- Re-read INSIDE the lock. A caller that blocked here started before the
	-- winner committed, so its own earlier `hasInstanceAdmin()` read is stale.
	if exists (
		select 1 from selva.user_profiles
		where disabled = false
		  and 'instance_admin' = any(platform_permissions)
	) then
		return false;
	end if;

	update selva.user_profiles
	set platform_permissions = p_permissions
	where user_id = p_user_id;

	get diagnostics v_updated = row_count;
	return v_updated = 1;
end;
$$;

-- Service-role only, for the same reason as `set_platform_permissions`:
-- granting this to `authenticated` would let any logged-in user attempt a
-- platform-permission write. It fails closed once an admin exists, but the
-- bootstrap window is precisely when that is not yet true.
revoke execute on function selva.claim_first_instance_admin(uuid, text[]) from public;
grant execute on function selva.claim_first_instance_admin(uuid, text[]) to service_role;
