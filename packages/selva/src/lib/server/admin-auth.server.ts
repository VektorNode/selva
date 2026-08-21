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
//
// Two limiters, not one, because neither dimension covers the other:
//
//   - Per-address bounds one client hammering the form. It is only meaningful
//     when `ADDRESS_HEADER`/`XFF_DEPTH` are set (see .env.example) — behind a
//     reverse proxy without them, `getClientAddress()` returns the socket peer,
//     which is `127.0.0.1` for every request from every user. That collapses
//     the whole key space into one bucket, so five failed logins from anywhere
//     lock out the entire instance, and only a success clears it — which nobody
//     can now reach. Hence `warnIfAddressKeysCollapse` below: the failure is
//     otherwise completely silent.
//   - Per-account bounds a targeted guessing attack. Address limiting does not:
//     an attacker spread across many source IPs contends with no shared counter
//     at all, leaving PBKDF2 cost as the only real bound on online guessing.
//
// An attempt must clear BOTH, and a failure charges both. A success clears only
// the account bucket and the calling address's — a different address that
// failed against the same account keeps its own penalty.
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const loginRateLimiter = createComputeRateLimiter({
	windowMs: LOGIN_WINDOW_MS,
	maxPerWindow: 5
});

// Deliberately looser than the per-address cap. This one is reachable by an
// attacker who wants to lock a known user out of their own account, so it
// trades a little brute-force headroom for not being a cheap DoS on a named
// victim. Keyed on the normalized email, so it survives case tricks.
const accountRateLimiter = createComputeRateLimiter({
	windowMs: LOGIN_WINDOW_MS,
	maxPerWindow: 20
});

function accountKey(email: string): string {
	return `account:${email.trim().toLowerCase()}`;
}

/**
 * Gate one login attempt. `email` may be empty — the local provider allows a
 * password-only login when no user store is configured — in which case only the
 * address bucket applies.
 */
export function checkRateLimit(
	ip: string,
	email?: string
): { allowed: boolean; retryAfter?: number } {
	const byAddress = loginRateLimiter.peek(ip);
	if (!byAddress.allowed) return byAddress;
	if (!email) return byAddress;
	return accountRateLimiter.peek(accountKey(email));
}

export function recordFailedAttempt(ip: string, email?: string): void {
	loginRateLimiter.check(ip);
	if (email) accountRateLimiter.check(accountKey(email));
}

export function clearRateLimit(ip: string, email?: string): void {
	loginRateLimiter.clear(ip);
	if (email) accountRateLimiter.clear(accountKey(email));
}

// The address-collapse failure mode is invisible in normal operation — the app
// looks fine right up until the first five failed logins lock everyone out. So
// say it out loud, once, the first time a real request arrives on loopback with
// no `ADDRESS_HEADER` configured.
let addressWarningIssued = false;

export function warnIfAddressKeysCollapse(
	ip: string,
	log: { warn(message: string, fields?: Record<string, unknown>): void }
): void {
	if (addressWarningIssued) return;
	if (env.ADDRESS_HEADER) return;
	if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') return;
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
