-- ============================================================================
-- Delegated sessions never carry instance-admin rights
--
-- An API-token request runs under a short-lived session Selva signs for the
-- token's owner, marked with a `selva_org` claim (the token's org). Instance
-- authority must never ride on a bearer key, but `is_instance_admin()` only
-- looked at `auth.uid()`, so an admin's key passed every policy's admin bypass
-- and read every org. Each of those bypasses goes through this function, so
-- returning false for delegated sessions closes all of them.
-- ============================================================================

-- The org a delegated session is bound to, or null for a normal session. Host
-- apps can use it to pin their own policies to the token's org.
create or replace function selva.delegated_org()
returns uuid
language sql stable
as $$
	select nullif(auth.jwt() ->> 'selva_org', '')::uuid;
$$;

grant execute on function selva.delegated_org() to anon, authenticated, service_role;

create or replace function selva.is_instance_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
	select selva.delegated_org() is null and exists (
		select 1 from selva.user_profiles
		where user_id = auth.uid() and 'instance_admin' = any(platform_permissions)
	);
$$;
