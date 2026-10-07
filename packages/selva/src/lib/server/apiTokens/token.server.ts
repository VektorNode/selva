import { env } from '$env/dynamic/private';
import { createApiTokenCodec, type ApiTokenCodec } from '@selvajs/server/tokens';

// Lazy and re-keyed on the secret, like the invite and share-link codecs, so a
// rotated SELVA_HMAC_KEY applies without a restart. Rotating it invalidates
// every API token.
let cached: { secret: string; codec: ApiTokenCodec } | null = null;

/** Undefined without SELVA_HMAC_KEY: token requests then get 503, and sign-in keeps working. */
export function apiTokenCodec(): ApiTokenCodec | undefined {
	const secret = env.SELVA_HMAC_KEY;
	if (!secret) return undefined;
	if (cached?.secret !== secret) {
		cached = { secret, codec: createApiTokenCodec(secret) };
	}
	return cached.codec;
}
