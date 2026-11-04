import { createTokenCodec, findByToken, type TokenCodec } from '@selvajs/server/tokens';
import { hmacKeys } from '#lib/server/keys.server.js';

/**
 * Invite-token primitives — thin binding over `@selvajs/server/tokens`'s
 * `createTokenCodec`, mirroring the share-link design.
 *
 * ## Format
 *   raw    = `invite_<base64url(32 random bytes)>`
 *   hash   = base64url( HMAC-SHA256(SELVA_HMAC_KEY, raw) )
 *
 * Rotating `SELVA_HMAC_KEY` invalidates every pending invite.
 */

const TOKEN_PREFIX = 'invite_';

// Lazy + re-keyed on the secret so tests that mutate the env stub per-scenario see the change.
let cached: { cacheKey: string; codec: TokenCodec } | null = null;
function getCodec(): TokenCodec {
	const { current: secret, previous } = hmacKeys();
	if (!secret) {
		throw new Error(
			'Missing required env var: SELVA_HMAC_KEY. Generate with: openssl rand -base64 32'
		);
	}
	const cacheKey = `${secret}\n${previous ?? ''}`;
	if (cached?.cacheKey !== cacheKey) {
		const previousSecret = previous ? { previousSecret: previous } : {};
		cached = {
			cacheKey,
			codec: createTokenCodec({ prefix: TOKEN_PREFIX, secret, ...previousSecret })
		};
	}
	return cached.codec;
}

/** The codec itself, for the composition root to put on `SelvaDeps.tokens`. */
export function inviteCodec(): TokenCodec {
	return getCodec();
}

/** Mint: generate a fresh raw token. Show to the recipient exactly once. */
export function mintRawToken(): string {
	return getCodec().mintRawToken();
}

/** Hash a raw token to its store-side representation. */
export function hashToken(raw: string): string {
	return getCodec().hashToken(raw);
}

/** The stored record for `raw`, whichever hash form it was saved under. */
export function findByRawToken<T>(
	raw: string,
	lookup: (hash: string) => Promise<T | null>
): Promise<T | null> {
	return findByToken(getCodec(), raw, lookup);
}
