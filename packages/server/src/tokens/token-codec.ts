import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token codec — the primitive behind capability-URL tokens (share links,
 * invites, API tokens, and anything shaped like them).
 *
 * ## Format
 *   raw  = `<prefix><base64url(32 random bytes)>`
 *   hash = `sha256:` + base64url( SHA-256(raw) )
 *
 * The raw token is handed back once at mint time and never stored; the store
 * holds only the hash. With 256 bits of entropy in the raw token, an unkeyed
 * hash is as unreplayable from a database leak as a keyed one, and rotating
 * the instance secret no longer invalidates stored tokens.
 *
 * ## Legacy hashes
 *
 * Tokens minted before this format were stored as
 * `base64url(HMAC-SHA256(secret, raw))`. `lookupHashes` returns those forms
 * too, under the current and the previous secret, so they keep resolving
 * through a rotation until they expire.
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
	/** Instance secret. Only legacy hashes use it. */
	secret: string;
	/** The secret before the last rotation; legacy hashes made under it still resolve. */
	previousSecret?: string;
}

export interface TokenCodec {
	/** Fresh raw token. Never persisted — show it to the user exactly once. */
	mintRawToken(): string;
	/** Raw token to the hash stored in its place. */
	hashToken(raw: string): string;
	/** Every hash a stored record of `raw` may carry, current form first. Try each in turn. */
	lookupHashes(raw: string): string[];
	/** Constant-time compare, so a mismatch leaks no position information. */
	hashesEqual(a: string, b: string): boolean;
	/** Prefix check — recognizes this family's tokens on inbound requests. */
	looksLikeToken(value: string): boolean;
	/** For callers building URLs or error copy. */
	readonly prefix: string;
}

export function createTokenCodec(config: TokenCodecConfig): TokenCodec {
	const { prefix, secret, previousSecret } = config;
	for (const s of [secret, ...(previousSecret ? [previousSecret] : [])]) {
		if (s.length < MIN_TOKEN_SECRET_LENGTH) {
			throw new Error(
				`Secret for "${prefix}" tokens must be at least ${MIN_TOKEN_SECRET_LENGTH} characters ` +
					`(got ${s.length}). Generate one with: openssl rand -base64 32`
			);
		}
	}

	const hashToken = (raw: string): string =>
		'sha256:' + createHash('sha256').update(raw).digest('base64url');

	return {
		prefix,
		mintRawToken(): string {
			return prefix + randomBytes(32).toString('base64url');
		},
		hashToken,
		lookupHashes(raw: string): string[] {
			const legacy = [secret, ...(previousSecret ? [previousSecret] : [])].map((key) =>
				createHmac('sha256', key).update(raw).digest('base64url')
			);
			return [hashToken(raw), ...legacy];
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

/**
 * Look a raw token up by each hash its record may carry. Sequential rather than
 * one `IN` query so stores keep their single-hash interface; records are never
 * rewritten here, so there is no rewrite for a lookup to race.
 */
export async function findByToken<T>(
	codec: Pick<TokenCodec, 'lookupHashes'>,
	raw: string,
	lookup: (hash: string) => Promise<T | null>
): Promise<T | null> {
	for (const hash of codec.lookupHashes(raw)) {
		const found = await lookup(hash);
		if (found) return found;
	}
	return null;
}
