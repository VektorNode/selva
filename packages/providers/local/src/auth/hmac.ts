import { timingSafeEqual, createHmac } from 'node:crypto';

const DEFAULT_MAX_AGE_MS = 8 * 60 * 60 * 1000;

/**
 * Token format: base64url(userId + ':' + expiry) + '.' + hmac(payload)
 *
 * The userId is embedded so verifyToken can look up the live user record
 * (and therefore always reflect the current permissions, not stale ones
 * baked into the token at login time).
 */
export function signHmacToken(
	secret: string,
	userId: string,
	maxAgeMs = DEFAULT_MAX_AGE_MS
): string {
	const expiry = Date.now() + maxAgeMs;
	const payload = Buffer.from(`${userId}:${expiry}`).toString('base64url');
	const sig = createHmac('sha256', secret).update(payload).digest('base64url');
	return `${payload}.${sig}`;
}

export interface HmacTokenPayload {
	userId: string;
	valid: boolean;
}

/**
 * Verify an HMAC token. Returns the userId if valid and unexpired, or
 * { valid: false } if the signature is wrong or the token has expired.
 */
export function verifyHmacToken(token: string, secret: string): HmacTokenPayload {
	const dot = token.lastIndexOf('.');
	if (dot === -1) return { userId: '', valid: false };

	const payload = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url');

	const a = Buffer.from(sig);
	const b = Buffer.from(expectedSig);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return { userId: '', valid: false };

	const decoded = Buffer.from(payload, 'base64url').toString();
	const colon = decoded.lastIndexOf(':');
	if (colon === -1) return { userId: '', valid: false };

	const userId = decoded.slice(0, colon);
	const expiry = parseInt(decoded.slice(colon + 1), 10);
	if (!Number.isFinite(expiry) || Date.now() >= expiry) return { userId: '', valid: false };

	return { userId, valid: true };
}
