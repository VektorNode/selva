import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * Spec §7 share-link token primitives.
 *
 * ## Two-part design
 *
 * Each share link has TWO secrets:
 *
 *   1. **Per-link token** — generated here in `mintRawToken()` from 32 random
 *      bytes, returned to the API caller exactly once at mint time. Different
 *      every link. This is what end-users carry in `?token=…`.
 *
 *   2. **Instance-wide HMAC secret** (`SHARE_LINK_SECRET` env var, falls back
 *      to `SESSION_SECRET`) — used to hash tokens for storage. The store sees
 *      only `HMAC-SHA256(secret, token)`. A DB-only leak therefore can't be
 *      replayed: the attacker would need the secret too, and it lives in env,
 *      not the database.
 *
 * ## Format
 *   raw    = `share_<base64url(32 random bytes)>`
 *   hash   = base64url( HMAC-SHA256(SHARE_LINK_SECRET, raw) )
 *
 * Resolution path hashes the supplied token with the same secret and looks
 * up by exact match against `share_links.token_hash`.
 *
 * ## Setup
 *
 * See [selva.config.ts](../../../../../selva.config.ts) for the canonical
 * env-var documentation, generation command, and rotation notes. tl;dr:
 *
 *   - Set `SHARE_LINK_SECRET` to a random ≥32-byte string in production.
 *   - In dev, omitting it makes the code fall back to `SESSION_SECRET`.
 *   - Rotation invalidates every existing share link.
 */

const TOKEN_PREFIX = 'share_';

function getSecret(): string {
	const secret = env.SHARE_LINK_SECRET || env.SESSION_SECRET;
	if (!secret) {
		throw new Error(
			'Missing required env var: SHARE_LINK_SECRET (or SESSION_SECRET as fallback). ' +
				'See selva.config.ts for setup instructions.'
		);
	}
	return secret;
}

/** Mint: generate a fresh raw token. Show to the caller exactly once. */
export function mintRawToken(): string {
	return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/** Hash a raw token to its store-side representation. */
export function hashToken(raw: string): string {
	return createHmac('sha256', getSecret()).update(raw).digest('base64url');
}

/**
 * Constant-time equality for two stored hashes. Used when comparing a
 * resolved token's hash to a candidate row pulled by some other path —
 * not strictly required for getByTokenHash (DB lookup is already by exact
 * match), but useful for any future "verify two hashes are equal" callers.
 */
export function hashesEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

/** Recognize our own token format on inbound requests. */
export function looksLikeShareToken(value: string): boolean {
	return value.startsWith(TOKEN_PREFIX);
}
