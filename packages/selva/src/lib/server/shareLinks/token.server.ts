import { env } from '$env/dynamic/private';
import { createTokenCodec, type TokenCodec } from '@selvajs/server/tokens';

/**
 * Spec §7 share-link token primitives — thin binding over
 * `@selvajs/server/tokens` (`createTokenCodec`), which owns the two-part
 * design (per-link random secret, instance-wide HMAC secret hashing tokens at
 * rest) and enforces the ≥32-char secret minimum.
 *
 * ## Format
 *   raw    = `share_<base64url(32 random bytes)>`
 *   hash   = base64url( HMAC-SHA256(SELVA_HMAC_KEY, raw) )
 *
 * Rotating `SELVA_HMAC_KEY` invalidates every existing share link.
 */

const TOKEN_PREFIX = 'share_';

// Codec creation validates the secret, so resolve lazily (env isn't ready at
// import time in every context) and re-key on the secret so tests that mutate
// the env stub per-scenario see the change.
let cached: { secret: string; codec: TokenCodec } | null = null;
function getCodec(): TokenCodec {
	const secret = env.SELVA_HMAC_KEY;
	if (!secret) {
		throw new Error(
			'Missing required env var: SELVA_HMAC_KEY. ' +
				'See packages/selva/.env.example for setup instructions.'
		);
	}
	if (cached?.secret !== secret) {
		cached = { secret, codec: createTokenCodec({ prefix: TOKEN_PREFIX, secret }) };
	}
	return cached.codec;
}

/** Mint: generate a fresh raw token. Show to the caller exactly once. */
export function mintRawToken(): string {
	return getCodec().mintRawToken();
}

/** Hash a raw token to its store-side representation. */
export function hashToken(raw: string): string {
	return getCodec().hashToken(raw);
}

/** Recognize our own token format on inbound requests. */
export function looksLikeShareToken(value: string): boolean {
	// Prefix check only — deliberately doesn't touch the codec, so a missing
	// secret can't turn "is this even a share token?" into a 500.
	return value.startsWith(TOKEN_PREFIX);
}
