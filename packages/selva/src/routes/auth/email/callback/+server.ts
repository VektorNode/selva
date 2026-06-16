import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getAuthProvider } from '$lib/server/auth.server';
import { bootstrapUserSession } from '$lib/server/auth-bootstrap.server';
import {
	safeRedirectTarget,
	setSessionCookie,
	setRefreshCookie
} from '$lib/server/admin-auth.server';

/**
 * GET /auth/email/callback?token_hash=...&type=...&redirectTo=/library
 *
 * The user clicked the magic link in their inbox. Hand the full URL to the
 * adapter (it knows its own token format), set cookies on success, redirect
 * to the destination. Mirrors `/auth/supabase/callback` but capability-named
 * — this route doesn't know which IdP brokered the email.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const emailLink = getAuthProvider().emailLink;
	if (!emailLink) {
		apiError(501, ApiErrorCode.INTERNAL, 'Email sign-in is not supported by this provider.');
	}

	// Pass the full URL through so the adapter can read whatever query
	// params it needs (Supabase wants `token_hash` + `type`; a future
	// adapter might use a different shape).
	const result = await emailLink.verifyMagicLink(url.toString());
	if (!result)
		apiError(401, ApiErrorCode.UNAUTHORIZED, 'This sign-in link is invalid or has expired.');

	await bootstrapUserSession(result.user);

	setSessionCookie(cookies, result.sessionToken);
	if (result.refreshToken) setRefreshCookie(cookies, result.refreshToken);

	const dest = safeRedirectTarget(url.searchParams.get('redirectTo'), '/library');
	redirect(303, dest);
};
