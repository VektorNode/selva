import { error, type Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
const REFRESH_COOKIE_NAME = 'admin_refresh';
// Refresh tokens have longer life than the access token so the middleware
// can mint new access tokens silently. 30 days matches Supabase's default.
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ============================================================================
// Rate limiter
// ============================================================================
// Process-local state — not a provider concern.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
	const now = Date.now();
	const entry = rateLimitStore.get(ip);

	if (!entry || now > entry.resetAt) {
		return { allowed: true };
	}

	if (entry.count >= RATE_LIMIT_MAX) {
		const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
		return { allowed: false, retryAfter };
	}

	return { allowed: true };
}

export function recordFailedAttempt(ip: string): void {
	const now = Date.now();
	const entry = rateLimitStore.get(ip);

	if (!entry || now > entry.resetAt) {
		rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
	} else {
		entry.count += 1;
	}
}

export function clearRateLimit(ip: string): void {
	rateLimitStore.delete(ip);
}

// ============================================================================
// Session management (cookie I/O — SvelteKit transport layer)
// ============================================================================
/**
 * Set the session cookie using a token produced by the auth provider. The
 * token is always minted by the provider (local = HMAC, Supabase = JWT) as
 * part of `verifyLogin` — this helper does cookie transport only.
 */
export function setSessionCookie(cookies: Cookies, sessionToken: string): void {
	const isSecure =
		// eslint-disable-next-line no-restricted-properties -- NODE_ENV is OS-level, set by Node/Vite, not loaded from .env
		process.env.NODE_ENV === 'production' && env.ALLOW_INSECURE_COOKIES !== 'true';

	cookies.set(SESSION_COOKIE_NAME, sessionToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecure,
		maxAge: SESSION_MAX_AGE_MS / 1000
	});
}

export function destroySession(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	cookies.delete(REFRESH_COOKIE_NAME, { path: '/' });
}

/**
 * Set the refresh-token cookie used by the OAuth/Supabase flow. The
 * session-refresh middleware in `hooks.server.ts` swaps an expired access
 * token for a fresh one using this. Local/HMAC sessions don't need it.
 */
export function setRefreshCookie(cookies: Cookies, refreshToken: string): void {
	const isSecure =
		// eslint-disable-next-line no-restricted-properties -- NODE_ENV is OS-level, set by Node/Vite, not loaded from .env
		process.env.NODE_ENV === 'production' && env.ALLOW_INSECURE_COOKIES !== 'true';
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
// Request body size guard
// ============================================================================
/**
 * Reject a request whose declared `Content-Length` exceeds `maxBytes`. Throws
 * 413 BEFORE the body is read so a malicious client can't burn memory by
 * sending a huge JSON payload to a small-body endpoint.
 *
 * Background: the global `BODY_SIZE_LIMIT` env var is enforced by adapter-node
 * for every route — but we want it set high enough to accept the largest
 * legitimate upload (50MB .gh files), which means the smaller JSON endpoints
 * inherit that ceiling by default. This helper is the per-route lower bound.
 *
 * Caveat: requests without `Content-Length` (chunked transfer encoding) bypass
 * this check. Most browsers and HTTP clients send Content-Length on POST/PUT.
 * The global `BODY_SIZE_LIMIT` is the backstop for those.
 */
export function requireMaxBodySize(request: Request, maxBytes: number): void {
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw error(413, `Request body exceeds the limit for this endpoint.`);
	}
}

// ============================================================================
// Redirect target validation
// ============================================================================
/**
 * Validate a user-supplied post-login redirect target. Accepts only same-origin
 * relative paths starting with `/` followed by a non-`/` character, so
 * `//evil.com/path` (protocol-relative URL — browser treats as cross-origin)
 * and `/\evil.com` (back-slash variants some browsers normalize) are rejected.
 *
 * Always returns a safe path: the validated target on success, the fallback
 * otherwise. Routes call this with `redirectTo` from form data or query string.
 */
export function safeRedirectTarget(raw: string | null | undefined, fallback: string): string {
	if (typeof raw !== 'string' || raw.length < 2) return fallback;
	if (raw[0] !== '/') return fallback;
	// Reject protocol-relative (`//host`) and back-slash bypass (`/\host`).
	if (raw[1] === '/' || raw[1] === '\\') return fallback;
	return raw;
}
