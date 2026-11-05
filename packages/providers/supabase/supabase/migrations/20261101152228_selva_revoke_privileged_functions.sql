-- ============================================================================
-- EXECUTE on `selva` functions matches who calls them
--
-- PostgREST exposes `selva` and the anon key is publishable, so the grant is all
-- that stands between a caller and a SECURITY DEFINER function.
--
-- Postgres gives every new function EXECUTE to PUBLIC, and per-schema default
-- privileges can only add to that. Each new function in `selva` has to revoke
-- from public itself: function-privileges.test.ts fails until it does.
-- ============================================================================

alter default privileges in schema selva revoke all on functions from anon, authenticated;

-- Server-only: the app reaches these through the service-role client. PUBLIC is
-- listed because anon and authenticated inherit from it. Revoking on a trigger
-- function is safe: Postgres checks EXECUTE when a trigger is created, not when
-- it fires.
revoke all on function
	selva.claim_first_instance_admin(uuid, text[]),
	selva.handle_new_auth_user(),
	selva.migration_head(),
	selva.redact_audit_event_email(text),
	selva.set_platform_permissions(uuid, text[]),
	selva.set_updated_at(),
	selva.sync_auth_user_disabled(),
	selva.try_increment_share_link_solve_count(uuid)
from public, anon, authenticated;

grant execute on function
	selva.claim_first_instance_admin(uuid, text[]),
	selva.handle_new_auth_user(),
	selva.migration_head(),
	selva.redact_audit_event_email(text),
	selva.set_platform_permissions(uuid, text[]),
	selva.set_updated_at(),
	selva.sync_auth_user_disabled(),
	selva.try_increment_share_link_solve_count(uuid)
to service_role;

-- Solves and version uploads always carry a signed-in user or the service role.
revoke all on function
	selva.increment_run_count(uuid),
	selva.reserve_next_version_number(uuid)
from public, anon;
