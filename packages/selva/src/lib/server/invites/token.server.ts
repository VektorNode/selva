import { env } from '$env/dynamic/private';
import { createTokenCodec, type TokenCodec } from '@selvajs/server/tokens';

/**
 * Invite-token primitives — thin binding over `@selvajs/server/tokens`
 * (`createTokenCodec`), mirroring the share-link design (see
 * `shareLinks/token.server.ts`).
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

// Lazy + re-keyed on the secret — same rationale as the share-link binding.
let cached: { secret: string; codec: TokenCodec } | null = null;
function getCodec(): TokenCodec {
	const secret = env.INVITE_TOKEN_SECRET || env.SELVA_HMAC_KEY;
	if (!secret) {
		throw new Error(
			'Missing required env var: INVITE_TOKEN_SECRET (or SELVA_HMAC_KEY as fallback). ' +
				'Generate with: openssl rand -base64 32'
		);
	}
	if (cached?.secret !== secret) {
		cached = { secret, codec: createTokenCodec({ prefix: TOKEN_PREFIX, secret }) };
	}
	return cached.codec;
}

/** Mint: generate a fresh raw token. Show to the recipient exactly once. */
export function mintRawToken(): string {
	return getCodec().mintRawToken();
}

/** Hash a raw token to its store-side representation. */
export function hashToken(raw: string): string {
	return getCodec().hashToken(raw);
}

/** Constant-time equality for two stored hashes. */
export function hashesEqual(a: string, b: string): boolean {
	return getCodec().hashesEqual(a, b);
}

/** Recognize our own token format on inbound URLs. */
export function looksLikeInviteToken(value: string): boolean {
	// Prefix check only — works even when the secret isn't configured.
	return value.startsWith(TOKEN_PREFIX);
}
