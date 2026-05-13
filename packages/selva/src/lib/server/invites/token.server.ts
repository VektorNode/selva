import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * Invite-token primitives. Mirrors the share-link design (see
 * `shareLinks/token.server.ts`):
 *
 *   - per-link random secret of 32 bytes, returned to the admin once via the
 *     accept URL; never stored.
 *   - instance-wide HMAC secret hashes the token at rest; a DB-only leak
 *     can't be replayed without knowing the secret too.
 *
 * ## Format
 *   raw    = `invite_<base64url(32 random bytes)>`
 *   hash   = base64url( HMAC-SHA256(INVITE_TOKEN_SECRET, raw) )
 *
 * `INVITE_TOKEN_SECRET` falls back to `SELVA_HMAC_KEY` so single-tenant
 * deployments don't have to manage a third secret. Multi-tenant / production
 * setups should set both `SHARE_LINK_SECRET` and `INVITE_TOKEN_SECRET`
 * explicitly so they can be rotated independently — rotating one shouldn't
 * invalidate the other.
 */

const TOKEN_PREFIX = 'invite_';

function getSecret(): string {
	const secret = env.INVITE_TOKEN_SECRET || env.SELVA_HMAC_KEY;
	if (!secret) {
		throw new Error(
			'Missing required env var: INVITE_TOKEN_SECRET (or SELVA_HMAC_KEY as fallback). ' +
				'Generate with: openssl rand -base64 32'
		);
	}
	return secret;
}

/** Mint: generate a fresh raw token. Show to the recipient exactly once. */
export function mintRawToken(): string {
	return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/** Hash a raw token to its store-side representation. */
export function hashToken(raw: string): string {
	return createHmac('sha256', getSecret()).update(raw).digest('base64url');
}

/** Constant-time equality for two stored hashes. */
export function hashesEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

/** Recognize our own token format on inbound URLs. */
export function looksLikeInviteToken(value: string): boolean {
	return value.startsWith(TOKEN_PREFIX);
}
