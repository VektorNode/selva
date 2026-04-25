import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { ALL_PLATFORM_PERMISSIONS, SYSTEM_CONTEXT } from '@selva/platform';
import { getAuthProvider } from '$lib/server/auth.server';
import { getPermissionStore } from '$lib/server/providers.server';
import { setSessionCookie, setRefreshCookie } from '$lib/server/admin-auth.server';

/**
 * GET /auth/supabase/callback?code=...&redirectTo=/app
 *
 * Completes a Supabase OAuth round-trip. Exchanges the authorization code
 * for a session, sets the session cookie, and redirects to `redirectTo`.
 *
 * **First-OAuth-signin-becomes-admin** (Permissions.md §2 invariant
 * bootstrap): if no user currently holds `instance_admin` and the deployment
 * has no other way to bootstrap one (no password setup form because OIDC-only),
 * the first OAuth sign-in is granted every platform permission. Subsequent
 * sign-ins behave normally.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	if (!code) throw error(400, 'Missing authorization code');

	const auth = getAuthProvider();
	if (typeof (auth as { exchangeOAuthCode?: unknown }).exchangeOAuthCode !== 'function') {
		throw error(501, 'OAuth is not supported by the configured auth provider.');
	}

	const oauth = auth as unknown as {
		exchangeOAuthCode: (
			code: string
		) => Promise<{ user: { id: string }; sessionToken: string; refreshToken: string } | null>;
	};
	const result = await oauth.exchangeOAuthCode(code);
	if (!result) throw error(401, 'OAuth exchange failed');

	// First-signin-becomes-admin bootstrap path. Runs at most once per
	// deployment — once a user holds instance_admin, this branch never fires.
	const perms = getPermissionStore();
	const hasAdmin = await perms.hasInstanceAdmin(SYSTEM_CONTEXT);
	if (!hasAdmin) {
		await perms.set(SYSTEM_CONTEXT, result.user.id, [...ALL_PLATFORM_PERMISSIONS]);
	}

	setSessionCookie(cookies, result.sessionToken);
	setRefreshCookie(cookies, result.refreshToken);

	const rawRedirect = url.searchParams.get('redirectTo');
	const dest = rawRedirect && rawRedirect.startsWith('/') ? rawRedirect : '/app';
	redirect(303, dest);
};
