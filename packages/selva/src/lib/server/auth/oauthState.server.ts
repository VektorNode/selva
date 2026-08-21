/**
 * CSRF `state` for the OAuth round trip.
 *
 * `/auth/supabase/callback` is a GET that mints and sets a session cookie.
 * SvelteKit's built-in CSRF origin check covers form POSTs, not GETs, so
 * without a state nonce the callback accepts a `?code=` from anywhere. The
 * attack is login CSRF: the attacker starts their own OAuth flow, captures
 * their `code`, and induces the victim's browser to load the callback with it.
 * The victim is now silently signed into the attacker's account, and everything
 * they do there is visible to the attacker.
 *
 * The nonce lives in a short-lived cookie rather than server memory so it
 * survives a multi-instance deployment without a shared store — the browser
 * that started the flow is the only one that can finish it. `SameSite=Lax` is
 * required, not `Strict`: the IdP redirects back cross-site, and `Strict` would
 * withhold the cookie on exactly the request that needs it.
 *
 * `exchangeOAuthCode` takes only `code` — the adapter enforces neither `state`
 * nor PKCE — so this app-layer check is the only thing standing between the
 * callback and a replayed authorization code.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';

const STATE_COOKIE_NAME = 'oauth_state';

// Long enough for the slowest realistic IdP round trip (consent screen, MFA,
// account chooser), short enough that a stolen nonce is worthless.
const STATE_MAX_AGE_S = 10 * 60;

/**
 * Mint a nonce, store it in the cookie, and return it for the caller to hand
 * to the IdP as `state`.
 */
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
 * Compare the callback's `state` against the cookie and clear the cookie either
 * way — a nonce is single-use, so a failed attempt must not leave a live one
 * behind for a retry.
 */
export function consumeOAuthState(cookies: Cookies, submitted: string | null): boolean {
	const expected = cookies.get(STATE_COOKIE_NAME);
	cookies.delete(STATE_COOKIE_NAME, { path: '/' });
	if (!expected || !submitted) return false;

	// Both are base64url of the same 32 bytes when honest, but `submitted` is
	// attacker-controlled and may be any length — `timingSafeEqual` throws on a
	// length mismatch, so that case is answered before it is called.
	const a = Buffer.from(expected);
	const b = Buffer.from(submitted);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
