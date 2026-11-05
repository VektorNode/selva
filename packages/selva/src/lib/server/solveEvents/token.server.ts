import { createHmac, timingSafeEqual } from 'node:crypto';
import { hmacKeys } from '#lib/server/keys.server.js';

/**
 * Per-solve bearer for the Compute → Selva callback. Stateless on purpose: the
 * token proves "the Selva server minted this for this solveId, and it has not
 * expired", which a second server instance can check without shared state.
 *
 * Format: `<expiryMs>.<base64url(HMAC-SHA256(SELVA_HMAC_KEY, solveId + "." + expiryMs))>`.
 * Verified under the previous key too, so a rotation doesn't cut off solves in flight.
 */

function keys(): string[] {
	const { current, previous } = hmacKeys();
	if (!current) {
		throw new Error(
			'Missing required env var: SELVA_HMAC_KEY. See packages/selva/.env.example for setup instructions.'
		);
	}
	return previous ? [current, previous] : [current];
}

function sign(key: string, solveId: string, expiresAt: number): string {
	return createHmac('sha256', key).update(`${solveId}.${expiresAt}`).digest('base64url');
}

export function mintSolveToken(solveId: string, ttlMs: number): string {
	const expiresAt = Date.now() + ttlMs;
	return `${expiresAt}.${sign(keys()[0], solveId, expiresAt)}`;
}

export function verifySolveToken(solveId: string, token: string | null | undefined): boolean {
	if (!token) return false;
	const dot = token.indexOf('.');
	if (dot <= 0) return false;
	const expiresAt = Number(token.slice(0, dot));
	if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
	const given = Buffer.from(token.slice(dot + 1));
	return keys().some((key) => {
		const expected = Buffer.from(sign(key, solveId, expiresAt));
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}
