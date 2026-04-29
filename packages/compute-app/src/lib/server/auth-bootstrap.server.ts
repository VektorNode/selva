import { env } from '$env/dynamic/private';
import {
	ALL_PLATFORM_PERMISSIONS,
	SYSTEM_CONTEXT,
	type AuthUser,
	type TenancyMode
} from '@selvajs/platform';
import { getDataProvider, getPermissionStore, tenancy } from './providers.server.js';

/**
 * Shared post-verification flow used by every IdP-callback route (OAuth,
 * email link, future SAML, …). Order matters:
 *
 *   1. `data.ensureUser` — guarantee a user-data row exists for whatever ID
 *      the auth provider issued. Local-provider creates a JSON row;
 *      Supabase no-ops (its DB trigger has already fired).
 *   2. Bootstrap-admin grant — if no instance_admin exists yet AND the
 *      tenancy/env policy allows it, grant the signing-in user every
 *      platform permission so `/admin` becomes reachable.
 *
 * Returns nothing — failures throw. Cookie/redirect are the caller's job
 * since they vary by capability (OAuth has refresh tokens, magic-link does
 * sometimes, SAML doesn't).
 */
export async function bootstrapUserSession(user: AuthUser): Promise<void> {
	await getDataProvider().ensureUser(SYSTEM_CONTEXT, user.id);

	const perms = getPermissionStore();
	const hasAdmin = await perms.hasInstanceAdmin(SYSTEM_CONTEXT);
	if (hasAdmin) return;

	if (!shouldBootstrapAdmin(user, env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL, tenancy)) return;
	await perms.set(SYSTEM_CONTEXT, user.id, [...ALL_PLATFORM_PERMISSIONS]);
}

/**
 * Decide whether the signing-in user qualifies for the first-admin grant
 * (Permissions.md §2). Pure — no I/O — so the policy is testable in
 * isolation.
 *
 * - `tenancy='single'` + no env var → first signer wins (fine for
 *   self-hosted fresh installs).
 * - `tenancy='single'` + env var set → only the named user qualifies.
 * - `tenancy='multi'` → env var REQUIRED; the named user must match the
 *   signer. Without it, the first random signup would become Selva staff.
 *
 * The env var also doubles as the break-glass recovery path
 * (Permissions.md §12) when admin is lost to backup restores or migration
 * drift.
 */
function shouldBootstrapAdmin(
	user: AuthUser,
	configuredEmail: string | undefined,
	mode: TenancyMode
): boolean {
	const expected = configuredEmail?.trim().toLowerCase();
	if (mode === 'multi' && !expected) return false;
	if (!expected) return true;
	const actual = user.email?.trim().toLowerCase();
	return !!actual && actual === expected;
}
