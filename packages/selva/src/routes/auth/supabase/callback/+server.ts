import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getAuthProvider } from '$lib/server/auth.server';
import { bootstrapUserSession } from '$lib/server/auth-bootstrap.server';
import { consumeOAuthState } from '$lib/server/auth/oauthState.server';
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
 * Post-verification flow (data-row seeding + first-admin bootstrap) lives in
 * `bootstrapUserSession` so the email-link and OAuth paths follow the same
 * sequence in the same order.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	// Before the exchange, and before anything is read from the URL: this is a
	// GET that sets a session cookie, and SvelteKit's CSRF origin check only
	// covers form POSTs. Without the nonce an attacker's captured `?code=` logs
	// the victim into the attacker's account. Consuming it also clears the
	// cookie, so a nonce is good for exactly one attempt.
	if (!consumeOAuthState(cookies, url.searchParams.get('selva_state'))) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Sign-in session expired. Please try again.');
	}

	const code = url.searchParams.get('code');
	if (!code) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing authorization code');

	const oauth = getAuthProvider().oauth;
	if (!oauth) {
		apiError(501, ApiErrorCode.INTERNAL, 'OAuth is not supported by the configured auth provider.');
	}

	const result = await oauth.exchangeOAuthCode(code);
	if (!result) apiError(401, ApiErrorCode.UNAUTHORIZED, 'OAuth exchange failed');

	await bootstrapUserSession(result.user);

	setSessionCookie(cookies, result.sessionToken);
	setRefreshCookie(cookies, result.refreshToken);

	// Same-origin only — `//evil.com` and `/\evil.com` would otherwise pass.
	const dest = safeRedirectTarget(url.searchParams.get('redirectTo'), '/library');
	redirect(303, dest);
};
