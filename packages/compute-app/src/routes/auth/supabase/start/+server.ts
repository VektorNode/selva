import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getAuthProvider } from '$lib/server/auth.server';

const ALLOWED_PROVIDERS = ['google', 'github', 'azure', 'gitlab'] as const;
type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number];

function isAllowedProvider(value: string | null): value is AllowedProvider {
	return value !== null && (ALLOWED_PROVIDERS as readonly string[]).includes(value);
}

/**
 * GET /auth/supabase/start?provider=google&redirectTo=/app
 *
 * Initiates an OAuth sign-in via Supabase Auth. The Supabase project must
 * have the named provider enabled in its dashboard. Bounces the browser to
 * the IdP's authorize endpoint; the IdP returns to `/auth/supabase/callback`
 * with a `?code=...`.
 *
 * `redirectTo` is preserved through the round trip via `?redirectTo=...` on
 * the callback URL we hand to Supabase.
 */
export const GET: RequestHandler = async ({ url }) => {
	const provider = url.searchParams.get('provider');
	if (!isAllowedProvider(provider)) {
		throw error(400, `Invalid provider. Allowed: ${ALLOWED_PROVIDERS.join(', ')}`);
	}

	const oauth = getAuthProvider().oauth;
	if (!oauth) {
		throw error(501, 'OAuth is not supported by the configured auth provider.');
	}

	const redirectTo = url.searchParams.get('redirectTo') ?? '/app';
	// Forward `redirectTo` through the OAuth callback so the post-login redirect
	// survives the IdP round trip.
	const callbackUrl = new URL('/auth/supabase/callback', url.origin);
	if (redirectTo.startsWith('/')) {
		callbackUrl.searchParams.set('redirectTo', redirectTo);
	}

	const authorizationUrl = await oauth.getOAuthAuthorizationUrl(provider, callbackUrl.toString());
	redirect(303, authorizationUrl);
};
