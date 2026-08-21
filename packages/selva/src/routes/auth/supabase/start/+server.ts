import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getAuthProvider } from '$lib/server/auth.server';
import { issueOAuthState } from '$lib/server/auth/oauthState.server';

const ALLOWED_PROVIDERS = ['google', 'github', 'azure', 'gitlab'] as const;
type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number];

function isAllowedProvider(value: string | null): value is AllowedProvider {
	return value !== null && (ALLOWED_PROVIDERS as readonly string[]).includes(value);
}

/**
 * GET /auth/supabase/start?provider=google&redirectTo=/library
 *
 * Initiates an OAuth sign-in via Supabase Auth. The Supabase project must
 * have the named provider enabled in its dashboard. Bounces the browser to
 * the IdP's authorize endpoint; the IdP returns to `/auth/supabase/callback`
 * with a `?code=...`.
 *
 * `redirectTo` is preserved through the round trip via `?redirectTo=...` on
 * the callback URL we hand to Supabase.
 *
 * A CSRF nonce rides along the same way. Supabase owns the real OAuth `state`
 * and doesn't expose it, and `exchangeOAuthCode` takes only `code` — so the
 * nonce is our own, carried on the callback URL and compared against a cookie.
 * Without it the callback accepts an attacker's `?code=` and silently signs the
 * victim into the attacker's account. See `oauthState.server.ts`.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const provider = url.searchParams.get('provider');
	if (!isAllowedProvider(provider)) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`Invalid provider. Allowed: ${ALLOWED_PROVIDERS.join(', ')}`
		);
	}

	const oauth = getAuthProvider().oauth;
	if (!oauth) {
		apiError(501, ApiErrorCode.INTERNAL, 'OAuth is not supported by the configured auth provider.');
	}

	const redirectTo = url.searchParams.get('redirectTo') ?? '/library';
	// Forward `redirectTo` through the OAuth callback so the post-login redirect
	// survives the IdP round trip.
	const callbackUrl = new URL('/auth/supabase/callback', url.origin);
	if (redirectTo.startsWith('/')) {
		callbackUrl.searchParams.set('redirectTo', redirectTo);
	}
	callbackUrl.searchParams.set('selva_state', issueOAuthState(cookies));

	const authorizationUrl = await oauth.getOAuthAuthorizationUrl(provider, callbackUrl.toString());
	redirect(303, authorizationUrl);
};
