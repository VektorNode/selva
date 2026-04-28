import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	ALL_PLATFORM_PERMISSIONS,
	SYSTEM_CONTEXT,
	type AuthUser,
	type TenancyMode
} from '@selvajs/platform';
import { getAuthProvider } from '$lib/server/auth.server';
import { getPermissionStore, tenancy } from '$lib/server/providers.server';
import {
	safeRedirectTarget,
	setSessionCookie,
	setRefreshCookie
} from '$lib/server/admin-auth.server';

/**
 * GET /auth/supabase/callback?code=...&redirectTo=/library
 *
 * Completes a Supabase OAuth round-trip. Exchanges the authorization code
 * for a session, sets the session cookie, and redirects to `redirectTo`.
 *
 * **Instance-admin bootstrap** (Permissions.md §2 invariant): if no user
 * currently holds `instance_admin`, the signing-in user MAY be granted every
 * platform permission. The exact rule depends on tenancy mode:
 *
 * - `tenancy='single'` (self-hosted): without `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`,
 *   whoever signs in first wins the race — fine for fresh self-hosted installs.
 *   With the env var set, only the named user qualifies.
 * - `tenancy='multi'` (multi-tenant / SaaS): the race is a security hole — the
 *   first random signup would become Selva staff. The bootstrap path is
 *   therefore **disabled unless `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is set AND
 *   matches the signer**. Operators seed admins explicitly. The env var also
 *   doubles as the break-glass recovery path (Permissions.md §12) when admin
 *   is lost to manual DB edits, a backup restore, or migration drift.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	if (!code) throw error(400, 'Missing authorization code');

	const oauth = getAuthProvider().oauth;
	if (!oauth) {
		throw error(501, 'OAuth is not supported by the configured auth provider.');
	}

	const result = await oauth.exchangeOAuthCode(code);
	if (!result) throw error(401, 'OAuth exchange failed');

	const perms = getPermissionStore();
	const hasAdmin = await perms.hasInstanceAdmin(SYSTEM_CONTEXT);
	if (
		!hasAdmin &&
		shouldBootstrapAdmin(result.user, env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL, tenancy)
	) {
		await perms.set(SYSTEM_CONTEXT, result.user.id, [...ALL_PLATFORM_PERMISSIONS]);
	}

	setSessionCookie(cookies, result.sessionToken);
	setRefreshCookie(cookies, result.refreshToken);

	// Same-origin only — `//evil.com` and `/\evil.com` would otherwise pass.
	const dest = safeRedirectTarget(url.searchParams.get('redirectTo'), '/library');
	redirect(303, dest);
};

function shouldBootstrapAdmin(
	user: AuthUser,
	configuredEmail: string | undefined,
	mode: TenancyMode
): boolean {
	const expected = configuredEmail?.trim().toLowerCase();
	// Multi-tenant: env var is REQUIRED. Without it, the first random OAuth
	// signer would become Selva staff — a SaaS-mode security hole.
	if (mode === 'multi' && !expected) return false;
	if (!expected) return true;
	const actual = user.email?.trim().toLowerCase();
	return !!actual && actual === expected;
}
