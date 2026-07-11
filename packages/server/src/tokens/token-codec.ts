import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC token codec — the primitive behind capability-URL tokens (share links,
 * invites, and anything shaped like them).
 *
 * ## Two-part design
 *
 * Each minted token involves TWO secrets:
 *
 *   1. **Per-token secret** — generated in `mintRawToken()` from 32 random
 *      bytes, returned to the caller exactly once at mint time. Different
 *      every token. This is what end-users carry in `?token=…`.
 *
 *   2. **Instance-wide HMAC secret** (`config.secret`) — used to hash tokens
 *      for storage. The store sees only `HMAC-SHA256(secret, token)`. A
 *      DB-only leak therefore can't be replayed: the attacker would need the
 *      secret too, and it lives in env, not the database.
 *
 * ## Format
 *   raw    = `<prefix><base64url(32 random bytes)>`
 *   hash   = base64url( HMAC-SHA256(secret, raw) )
 *
 * The resolution path hashes the supplied token with the same secret and looks
 * up by exact match against the stored hash.
 *
 * Rotating the secret invalidates every token minted under it — give each
 * token family (each prefix) its own secret so they rotate independently.
 */

/**
 * Minimum accepted secret length. Matches the "random ≥32-byte string"
 * guidance everywhere these secrets are documented; enforced here so a
 * short dev secret can't reach production silently (presence-only checks
 * let a 4-char secret through).
 */
export const MIN_TOKEN_SECRET_LENGTH = 32;

export interface TokenCodecConfig {
	/** Token-family marker prepended to every raw token, e.g. `share_`. */
	prefix: string;
	/** Instance-wide HMAC secret. Must be at least 32 characters. */
	secret: string;
}

export interface TokenCodec {
	/** Mint: generate a fresh raw token. Show to the caller exactly once. */
	mintRawToken(): string;
	/** Hash a raw token to its store-side representation. */
	hashToken(raw: string): string;
	/** Constant-time equality for two stored hashes. */
	hashesEqual(a: string, b: string): boolean;
	/** Recognize this codec's token format on inbound requests. */
	looksLikeToken(value: string): boolean;
	/** The configured prefix, for callers that build URLs or error copy. */
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
