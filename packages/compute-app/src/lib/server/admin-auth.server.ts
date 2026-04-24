import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── Rate limiter ─────────────────────────────────────────────────────────────
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

// ── Session management (cookie I/O — SvelteKit transport layer) ──────────────

/**
 * Set the session cookie using a token produced by the auth provider. §1a:
 * the token is always minted by the provider (local = HMAC, Supabase = JWT)
 * as part of `verifyLogin` — this helper does cookie transport only.
 */
export function setSessionCookie(cookies: Cookies, sessionToken: string): void {
	const isSecure =
		process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_COOKIES !== 'true';

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
}
