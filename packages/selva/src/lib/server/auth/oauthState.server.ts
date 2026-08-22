/**
 * CSRF `state` for the OAuth round trip.
 *
 * `/auth/supabase/callback` is a GET that sets a session cookie. SvelteKit's
 * CSRF check covers form POSTs, not GETs, so without this nonce the callback
 * would accept a `?code=` from anywhere — an attacker starts their own OAuth
 * flow, captures the code, and gets the victim's browser to load the callback
 * with it, silently signing the victim into the attacker's account.
 *
 * The nonce lives in a cookie, not server memory, so it survives a
 * multi-instance deployment without a shared store. `SameSite=Lax`, not
 * `Strict`: the IdP redirect back is cross-site, and `Strict` would withhold
 * the cookie on exactly the request that needs it.
 *
 * `exchangeOAuthCode` takes only `code` — the adapter enforces neither `state`
 * nor PKCE — so this is the only thing standing between the callback and a
 * replayed authorization code.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';

const STATE_COOKIE_NAME = 'oauth_state';

// Long enough for a slow IdP round trip (consent screen, MFA, account chooser),
// short enough that a stolen nonce is worthless.
const STATE_MAX_AGE_S = 10 * 60;

/** Mint a nonce, store it in the cookie, and return it to hand to the IdP as `state`. */
export function issueOAuthState(cookies: Cookies): string {
	const state = randomBytes(32).toString('base64url');
	cookies.set(STATE_COOKIE_NAME, state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production' && env.ALLOW_INSECURE_COOKIES !== 'true',
		maxAge: STATE_MAX_AGE_S
	});
	return state;
}

/**
 * Compares the callback's `state` against the cookie and clears the cookie
 * either way — a nonce is single-use, so a failed attempt must not leave a
 * live one behind for a retry.
 */
export function consumeOAuthState(cookies: Cookies, submitted: string | null): boolean {
	const expected = cookies.get(STATE_COOKIE_NAME);
	cookies.delete(STATE_COOKIE_NAME, { path: '/' });
	if (!expected || !submitted) return false;

	// `submitted` is attacker-controlled and may be any length; timingSafeEqual
	// throws on a length mismatch, so that's checked first.
	const a = Buffer.from(expected);
	const b = Buffer.from(submitted);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
