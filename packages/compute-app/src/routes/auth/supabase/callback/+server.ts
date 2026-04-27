import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { ALL_PLATFORM_PERMISSIONS, SYSTEM_CONTEXT, type AuthUser } from '@selvajs/platform';
import { getAuthProvider } from '$lib/server/auth.server';
import { getPermissionStore } from '$lib/server/providers.server';
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
 * currently holds `instance_admin`, the signing-in user is granted every
 * platform permission. `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` constrains this to a
 * single configured email — without it, *whoever signs in first wins the race*,
 * which is fine for fresh self-hosted installs but risky in production. Setting
 * the env var also doubles as the break-glass recovery path (Permissions.md §12)
 * when admin is lost to manual DB edits or a backup restore.
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
	if (!hasAdmin && shouldBootstrapAdmin(result.user, env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL)) {
		await perms.set(SYSTEM_CONTEXT, result.user.id, [...ALL_PLATFORM_PERMISSIONS]);
	}

	setSessionCookie(cookies, result.sessionToken);
	setRefreshCookie(cookies, result.refreshToken);

	// Same-origin only — `//evil.com` and `/\evil.com` would otherwise pass.
	const dest = safeRedirectTarget(url.searchParams.get('redirectTo'), '/library');
	redirect(303, dest);
};

function shouldBootstrapAdmin(user: AuthUser, configuredEmail: string | undefined): boolean {
	if (!configuredEmail) return true;
	const expected = configuredEmail.trim().toLowerCase();
	const actual = user.email?.trim().toLowerCase();
	return !!actual && actual === expected;
}
