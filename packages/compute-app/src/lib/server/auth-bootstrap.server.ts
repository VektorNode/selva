import { env } from '$env/dynamic/private';
import {
	ALL_PLATFORM_PERMISSIONS,
	SYSTEM_CONTEXT,
	type AuthUser,
	type TenancyMode
} from '@selvajs/platform';
import {
	getAuthProvider,
	getDataProvider,
	getPermissionStore,
	tenancy
} from './providers.server.js';

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
 * (Permissions.md §2) when admin is lost to backup restores or migration
 * drift.
 */
export function shouldBootstrapAdmin(
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

/**
 * Header-auth-specific variant of the bootstrap policy. Used by
 * `wireHeaderAuthBootstrap` to decide whether an unrecognized UPN arriving
 * through the proxy should be auto-allowlisted as the first admin.
 *
 * Same logic as `shouldBootstrapAdmin` but operates on the raw UPN/email
 * before any allowlist row exists. For Entra deployments UPN ≈ email; if
 * they differ, the proxy is expected to forward both and we prefer email
 * when present.
 */
function shouldBootstrapUpn(
	upn: string,
	email: string | undefined,
	configuredEmail: string | undefined,
	mode: TenancyMode
): boolean {
	const expected = configuredEmail?.trim().toLowerCase();
	if (mode === 'multi' && !expected) return false;
	if (!expected) return true;
	const candidate = (email ?? upn).trim().toLowerCase();
	return !!candidate && candidate === expected;
}

/**
 * Wire a bootstrap-allowlist policy onto the auth provider if it supports
 * header-auth-style first-admin bootstrapping. Idempotent — safe to call on
 * every startup; the provider holds the policy until process exit.
 *
 * Header-auth deployments can't reach `/setup` (no password form, no OAuth
 * callback), so without this the first proxy-authenticated visitor is
 * silently rejected (UPN not in allowlist) and the operator has to
 * hand-write JSON files. With it, the first visit whose UPN/email matches
 * `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is auto-allowlisted, and the immediately
 * following `bootstrapUserSession` call grants instance_admin.
 *
 * The policy is gated by `hasInstanceAdmin` — once any admin exists, the
 * policy returns false and the strict allowlist-only behavior resumes.
 * Single-tenant deployments with no env var get the "first signer wins"
 * shape, matching the password/OAuth bootstrap policy.
 */
export function wireHeaderAuthBootstrap(): void {
	const auth = getAuthProvider() as unknown as {
		setBootstrapAllowlistPolicy?: (
			policy:
				| ((p: { upn: string; email: string | undefined }) => boolean | Promise<boolean>)
				| null
		) => void;
	};
	if (typeof auth.setBootstrapAllowlistPolicy !== 'function') return;

	auth.setBootstrapAllowlistPolicy(async ({ upn, email }) => {
		const hasAdmin = await getPermissionStore().hasInstanceAdmin(SYSTEM_CONTEXT);
		if (hasAdmin) return false;
		return shouldBootstrapUpn(upn, email, env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL, tenancy);
	});
}
