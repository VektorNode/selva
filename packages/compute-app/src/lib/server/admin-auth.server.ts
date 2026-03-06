import { timingSafeEqual, createHmac } from 'crypto';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── HMAC-signed stateless sessions ───────────────────────────────────────────
// Sessions are self-verifying: token = base64(expiry) + '.' + hmac(base64(expiry))
// This survives PM2 restarts and cluster worker recycling because there is no
// in-memory store that gets wiped. The SESSION_SECRET must be stable across restarts
// (set it in your ecosystem.config.cjs / .env).
function getSecret(): string {
	const secret = env.SESSION_SECRET || env.ADMIN_PASSWORD;
	if (!secret) throw new Error('SESSION_SECRET or ADMIN_PASSWORD must be set');
	return secret;
}

function signToken(expiry: number): string {
	const payload = Buffer.from(String(expiry)).toString('base64url');
	const sig = createHmac('sha256', getSecret()).update(payload).digest('base64url');
	return `${payload}.${sig}`;
}

function verifyToken(token: string): boolean {
	const dot = token.lastIndexOf('.');
	if (dot === -1) return false;
	const payload = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const expectedSig = createHmac('sha256', getSecret()).update(payload).digest('base64url');
	// Timing-safe comparison
	const a = Buffer.from(sig);
	const b = Buffer.from(expectedSig);
	if (a.length !== b.length) return false;
	if (!timingSafeEqual(a, b)) return false;
	const expiry = parseInt(Buffer.from(payload, 'base64url').toString(), 10);
	return Date.now() < expiry;
}

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
	try {
		return verifyToken(token);
	} catch {
		return false;
	}
}

export function createSession(cookies: Cookies): void {
	const expiry = Date.now() + SESSION_MAX_AGE_MS;
	const token = signToken(expiry);

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
