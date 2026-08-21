import { env } from '$env/dynamic/private';
import { createTokenCodec, type TokenCodec } from '@selvajs/server/tokens';

/**
 * Invite-token primitives — thin binding over `@selvajs/server/tokens`
 * (`createTokenCodec`), mirroring the share-link design (see
 * `shareLinks/token.server.ts`).
 *
 * ## Format
 *   raw    = `invite_<base64url(32 random bytes)>`
 *   hash   = base64url( HMAC-SHA256(SELVA_HMAC_KEY, raw) )
 *
 * Rotating `SELVA_HMAC_KEY` invalidates every pending invite.
 */

const TOKEN_PREFIX = 'invite_';

// Lazy + re-keyed on the secret — same rationale as the share-link binding.
let cached: { secret: string; codec: TokenCodec } | null = null;
function getCodec(): TokenCodec {
	const secret = env.SELVA_HMAC_KEY;
	if (!secret) {
		throw new Error(
			'Missing required env var: SELVA_HMAC_KEY. Generate with: openssl rand -base64 32'
		);
	}
	if (cached?.secret !== secret) {
		cached = { secret, codec: createTokenCodec({ prefix: TOKEN_PREFIX, secret }) };
	}
	return cached.codec;
}

/**
 * The codec itself, for the composition root to put on `SelvaDeps.tokens`.
 * Handlers take theirs injected — see the share-link binding for why.
 */
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
