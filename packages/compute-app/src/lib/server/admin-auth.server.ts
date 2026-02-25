import { randomBytes, timingSafeEqual } from 'crypto';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── Server-side session store ────────────────────────────────────────────────
// Maps token → expiry timestamp (ms). Only tokens present here are valid.
// When adding OAuth (Google, etc.): the OAuth callback just calls createSession()
// after verifying the provider token. verifySession/destroySession/hooks.server.ts
// remain unchanged.
const sessionStore = new Map<string, number>();

// Periodically clean up expired sessions
setInterval(() => {
	const now = Date.now();
	for (const [token, expiresAt] of sessionStore) {
		if (now > expiresAt) sessionStore.delete(token);
	}
}, 60_000).unref(); // unref so this doesn't prevent process exit

// ── Rate limiter ─────────────────────────────────────────────────────────────
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

// ── Session management ───────────────────────────────────────────────────────

export function verifySession(cookies: Cookies): boolean {
	const token = cookies.get(SESSION_COOKIE_NAME);
	if (!token) return false;

	const expiresAt = sessionStore.get(token);
	if (expiresAt === undefined) return false;

	if (Date.now() > expiresAt) {
		sessionStore.delete(token);
		return false;
	}

	return true;
}

export function createSession(cookies: Cookies): void {
	const token = randomBytes(32).toString('hex');
	const expiresAt = Date.now() + SESSION_MAX_AGE_MS;

	sessionStore.set(token, expiresAt);

	const isSecure =
		process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_COOKIES !== 'true';

	cookies.set(SESSION_COOKIE_NAME, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecure,
		maxAge: SESSION_MAX_AGE_MS / 1000
	});
}

export function destroySession(cookies: Cookies): void {
	const token = cookies.get(SESSION_COOKIE_NAME);
	if (token) sessionStore.delete(token);
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}

// ── Password verification ────────────────────────────────────────────────────

export function verifyPassword(password: string): boolean {
	const adminPassword = env.ADMIN_PASSWORD;
	if (!adminPassword) {
		console.error('ADMIN_PASSWORD not set in environment');
		return false;
	}

	// Timing-safe comparison to prevent timing attacks
	const a = Buffer.from(password);
	const b = Buffer.from(adminPassword);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
