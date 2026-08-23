import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC token codec — the primitive behind capability-URL tokens (share links,
 * invites, and anything shaped like them).
 *
 * ## Format
 *   raw  = `<prefix><base64url(32 random bytes)>`
 *   hash = base64url( HMAC-SHA256(secret, raw) )
 *
 * ## Two secrets per token
 *
 *   1. **Per-token entropy** — the 32 random bytes in `mintRawToken()`, handed
 *      back exactly once at mint time and never stored. This is what end-users
 *      carry in `?token=…`.
 *
 *   2. **Instance-wide HMAC secret** (`config.secret`) — hashes tokens for
 *      storage, so the store holds only `HMAC-SHA256(secret, raw)`. A DB-only
 *      leak can't be replayed: the attacker also needs the secret, and it lives
 *      in env, not the database.
 *
 * Resolution hashes the supplied token with the same secret and looks up an
 * exact match against the stored hash.
 *
 * Rotating the secret invalidates every token minted under it — give each token
 * family (each prefix) its own secret so they rotate independently.
 */

/**
 * Minimum accepted secret length, matching the "random ≥32-byte string"
 * guidance these secrets are documented under. Enforced here because a
 * presence-only check lets a 4-char dev secret reach production silently.
 */
export const MIN_TOKEN_SECRET_LENGTH = 32;

export interface TokenCodecConfig {
	/** Token-family marker prepended to every raw token, e.g. `share_`. */
	prefix: string;
	/** Instance-wide HMAC secret; one per token family so they rotate apart. */
	secret: string;
}

export interface TokenCodec {
	/** Fresh raw token. Never persisted — show it to the user exactly once. */
	mintRawToken(): string;
	/** Raw token to the hash stored in its place. */
	hashToken(raw: string): string;
	/** Constant-time compare, so a mismatch leaks no position information. */
	hashesEqual(a: string, b: string): boolean;
	/** Prefix check — recognizes this family's tokens on inbound requests. */
	looksLikeToken(value: string): boolean;
	/** For callers building URLs or error copy. */
	readonly prefix: string;
}

export function createTokenCodec(config: TokenCodecConfig): TokenCodec {
	const { prefix, secret } = config;
	if (secret.length < MIN_TOKEN_SECRET_LENGTH) {
		throw new Error(
			`Secret for "${prefix}" tokens must be at least ${MIN_TOKEN_SECRET_LENGTH} characters ` +
				`(got ${secret.length}). Generate one with: openssl rand -base64 32`
		);
	}

	return {
		prefix,
		mintRawToken(): string {
			return prefix + randomBytes(32).toString('base64url');
		},
		hashToken(raw: string): string {
			return createHmac('sha256', secret).update(raw).digest('base64url');
		},
		hashesEqual(a: string, b: string): boolean {
			const ab = Buffer.from(a);
			const bb = Buffer.from(b);
			if (ab.length !== bb.length) return false;
			return timingSafeEqual(ab, bb);
		},
		looksLikeToken(value: string): boolean {
			return value.startsWith(prefix);
		}
	};
}
