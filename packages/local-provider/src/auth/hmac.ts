import { timingSafeEqual, createHmac } from 'node:crypto';

const DEFAULT_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Sign an HMAC token encoding an expiry timestamp.
 * Token format: base64url(expiry) + '.' + hmac(base64url(expiry))
 */
export function signHmacToken(secret: string, maxAgeMs = DEFAULT_MAX_AGE_MS): string {
	const expiry = Date.now() + maxAgeMs;
	const payload = Buffer.from(String(expiry)).toString('base64url');
	const sig = createHmac('sha256', secret).update(payload).digest('base64url');
	return `${payload}.${sig}`;
}

/**
 * Verify an HMAC token. Returns true if the signature is valid and the token has not expired.
 */
export function verifyHmacToken(token: string, secret: string): boolean {
	const dot = token.lastIndexOf('.');
	if (dot === -1) return false;
	const payload = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url');
	const a = Buffer.from(sig);
	const b = Buffer.from(expectedSig);
	if (a.length !== b.length) return false;
	if (!timingSafeEqual(a, b)) return false;
	const expiry = parseInt(Buffer.from(payload, 'base64url').toString(), 10);
	return Date.now() < expiry;
}
