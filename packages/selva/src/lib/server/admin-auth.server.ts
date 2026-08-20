import { error, type Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createComputeRateLimiter } from '@selvajs/server/compute';
import { declaredBodySizeExceeds, safeRedirectTarget } from '@selvajs/server/http';

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
const REFRESH_COOKIE_NAME = 'admin_refresh';
// Longer-lived than the access token so the middleware can mint new access
// tokens silently. 30 days matches Supabase's default.
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ============================================================================
// Login rate limiter
// ============================================================================
// Failure-counting flow on the shared fixed-window limiter: `peek` gates the
// attempt without spending budget, `check` records only failed logins, and a
// success `clear`s the bucket.
const loginRateLimiter = createComputeRateLimiter({
	windowMs: 15 * 60 * 1000, // 15 minutes
	maxPerWindow: 5
});

export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
	return loginRateLimiter.peek(ip);
}

export function recordFailedAttempt(ip: string): void {
	loginRateLimiter.check(ip);
}

export function clearRateLimit(ip: string): void {
	loginRateLimiter.clear(ip);
}

// ============================================================================
// Session management (cookie I/O — SvelteKit transport layer)
// ============================================================================
// The token itself is always minted by the auth provider (local = HMAC,
// Supabase = JWT) as part of `verifyLogin`; these helpers only handle cookies.
export function setSessionCookie(cookies: Cookies, sessionToken: string): void {
	const isSecure = process.env.NODE_ENV === 'production' && env.ALLOW_INSECURE_COOKIES !== 'true';

	cookies.set(SESSION_COOKIE_NAME, sessionToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecure,
		maxAge: SESSION_MAX_AGE_MS / 1000
	});
}

/** Read before `destroySession` — logout needs the token to revoke it provider-side. */
export function getSessionToken(cookies: Cookies): string | undefined {
	return cookies.get(SESSION_COOKIE_NAME);
}

export function destroySession(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	cookies.delete(REFRESH_COOKIE_NAME, { path: '/' });
}

/**
 * Refresh-token cookie for the OAuth/Supabase flow — `hooks.server.ts`'s
 * session-refresh middleware swaps an expired access token for a fresh one
 * using this. Local/HMAC sessions don't need it.
 */
export function setRefreshCookie(cookies: Cookies, refreshToken: string): void {
	const isSecure = process.env.NODE_ENV === 'production' && env.ALLOW_INSECURE_COOKIES !== 'true';
	cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecure,
		maxAge: REFRESH_MAX_AGE_MS / 1000
	});
}

export function getRefreshToken(cookies: Cookies): string | undefined {
	return cookies.get(REFRESH_COOKIE_NAME);
}

export function clearRefreshCookie(cookies: Cookies): void {
	cookies.delete(REFRESH_COOKIE_NAME, { path: '/' });
}

// ============================================================================
// HTTP hardening (bindings over @selvajs/server/http)
// ============================================================================
/**
 * Rejects a request whose declared `Content-Length` exceeds `maxBytes` — a
 * per-route lower bound under the global adapter-node `BODY_SIZE_LIMIT`
 * (which must stay high enough for 50MB .gh uploads). Throws 413 before the
 * body is read; see `declaredBodySizeExceeds` for the chunked-encoding caveat.
 */
export function requireMaxBodySize(request: Request, maxBytes: number): void {
	if (declaredBodySizeExceeds(request.headers, maxBytes)) {
		throw error(413, `Request body exceeds the limit for this endpoint.`);
	}
}

/** Post-login redirect validator — re-exported for the login/OAuth routes. */
export { safeRedirectTarget };
