import { env } from '$env/dynamic/private';
import {
	createApiTokenCodec,
	MIN_TOKEN_SECRET_LENGTH,
	type ApiTokenCodec
} from '@selvajs/server/tokens';

// Lazy and re-keyed on the secret, like the invite and share-link codecs, so a
// rotated SELVA_HMAC_KEY applies without a restart. Rotating it invalidates
// every API token.
let cached: { secret: string; codec: ApiTokenCodec } | null = null;

/**
 * Undefined without a usable SELVA_HMAC_KEY (missing or too short): token
 * requests then get 503 and sign-in keeps working. It runs on every request, so
 * it must not throw.
 */
export function apiTokenCodec(): ApiTokenCodec | undefined {
	const secret = env.SELVA_HMAC_KEY;
	if (!secret || secret.length < MIN_TOKEN_SECRET_LENGTH) return undefined;
	if (cached?.secret !== secret) {
		cached = { secret, codec: createApiTokenCodec(secret) };
	}
	return cached.codec;
}
