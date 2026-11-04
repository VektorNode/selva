import {
	createApiTokenCodec,
	MIN_TOKEN_SECRET_LENGTH,
	type ApiTokenCodec
} from '@selvajs/server/tokens';
import { createApiTokenResolutionCache } from '@selvajs/server/http';
import { hmacKeys } from '#lib/server/keys.server.js';

// Lazy and re-keyed on the secret, like the invite and share-link codecs, so a
// rotated SELVA_HMAC_KEY applies without a restart. Rotating it invalidates
// every API token.
let cached: { cacheKey: string; codec: ApiTokenCodec } | null = null;

/**
 * Undefined without a usable SELVA_HMAC_KEY (missing or too short): token
 * requests then get 503 and sign-in keeps working. It runs on every request, so
 * it must not throw.
 */
export function apiTokenCodec(): ApiTokenCodec | undefined {
	const { current: secret, previous } = hmacKeys();
	if (!secret || secret.length < MIN_TOKEN_SECRET_LENGTH) return undefined;
	const cacheKey = `${secret}\n${previous ?? ''}`;
	if (cached?.cacheKey !== cacheKey) {
		cached = { cacheKey, codec: createApiTokenCodec(secret, previous) };
	}
	return cached.codec;
}

/**
 * Resolved keys, one window per process: the hook reads it, and the revoke handlers and the
 * user-disable route drop from it, so a revoke here takes effect at once.
 */
export const apiTokenResolutions = createApiTokenResolutionCache();
