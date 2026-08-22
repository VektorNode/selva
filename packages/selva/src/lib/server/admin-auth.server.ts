import { error, type Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	addressKeysCollapsed,
	createLoginRateLimiter,
	declaredBodySizeExceeds,
	safeRedirectTarget
} from '@selvajs/server/http';

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
const REFRESH_COOKIE_NAME = 'admin_refresh';
// Longer-lived than the access token so the middleware can mint new access
// tokens silently. 30 days matches Supabase's default.
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ============================================================================
// Login rate limiter
// ============================================================================
// This app's instance of the shared two-bucket login limiter, plus the
// deployment check it cannot make for itself. The policy — why two buckets,
// why failures rather than attempts, why the account cap is looser — lives in
// `@selvajs/server/http`.

const loginRateLimiter = createLoginRateLimiter();

export function checkRateLimit(
	ip: string,
	email?: string
): { allowed: boolean; retryAfter?: number } {
	return loginRateLimiter.check(ip, email);
}

export function recordFailedAttempt(ip: string, email?: string): void {
	loginRateLimiter.recordFailure(ip, email);
}

export function clearRateLimit(ip: string, email?: string): void {
	loginRateLimiter.clear(ip, email);
}

// The address-collapse failure mode is invisible in normal operation — the app
// looks fine right up until the first five failed logins lock everyone out. So
// say it out loud, once, the first time a real request arrives showing it.
let addressWarningIssued = false;

export function warnIfAddressKeysCollapse(
	ip: string,
	log: { warn(message: string, fields?: Record<string, unknown>): void }
): void {
	if (addressWarningIssued) return;
	if (!addressKeysCollapsed(ip, Boolean(env.ADDRESS_HEADER))) return;
	addressWarningIssued = true;
	log.warn(
		'Login rate limiting is keyed to the loopback address for every request. ' +
			'The app is behind a proxy but ADDRESS_HEADER is unset, so getClientAddress() ' +
			'returns the socket peer and all clients share one bucket — five failed logins ' +
			'lock out the whole instance. Set ADDRESS_HEADER=X-Forwarded-For and XFF_DEPTH ' +
			'to your proxy count (see .env.example).',
		{ component: 'auth/rate-limit' }
	);
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
