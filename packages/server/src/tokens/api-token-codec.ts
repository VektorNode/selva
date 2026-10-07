import { randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { createTokenCodec, type TokenCodec } from './token-codec.js';

/**
 * API token format: `selva_` + 30 base62 random chars + 6 base62 chars of
 * CRC32 over the random part. 42 chars total.
 *
 * - The prefix is what secret scanners match on; `sk_` was dropped because
 *   Stripe and OpenAI keys share it.
 * - 30 base62 chars carry ~178 bits of entropy.
 * - The checksum lets the resolver reject a typo or a truncated paste without
 *   a store lookup. It is not a MAC: the HMAC at rest is what authenticates.
 * - CRC32 tops out below 62^6, so 6 chars always fit; shorter values are
 *   left-padded with `0`.
 */
export const API_TOKEN_PREFIX = 'selva_';
const RANDOM_LENGTH = 30;
const CHECKSUM_LENGTH = 6;
const TOKEN_LENGTH = API_TOKEN_PREFIX.length + RANDOM_LENGTH + CHECKSUM_LENGTH;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BODY_PATTERN = /^[0-9A-Za-z]+$/;

// Bytes at or above 248 (62 * 4) are dropped rather than reduced, so every
// character is equally likely.
function randomBase62(length: number): string {
	let out = '';
	while (out.length < length) {
		for (const byte of randomBytes(length * 2)) {
			if (byte < 248) out += BASE62[byte % 62];
			if (out.length === length) break;
		}
	}
	return out;
}

function checksum(random: string): string {
	let n = crc32(random);
	let out = '';
	for (let i = 0; i < CHECKSUM_LENGTH; i++) {
		out = BASE62[n % 62] + out;
		n = Math.floor(n / 62);
	}
	return out;
}

/**
 * Shape only, no secret needed. For spotting a key where it must not be, such
 * as a query string, without flagging text that merely starts with `selva_`.
 */
export function looksLikeApiToken(value: string): boolean {
	return (
		value.length === TOKEN_LENGTH &&
		value.startsWith(API_TOKEN_PREFIX) &&
		BODY_PATTERN.test(value.slice(API_TOKEN_PREFIX.length))
	);
}

export interface ApiTokenCodec extends TokenCodec {
	/** Shape and checksum only. A true result says nothing about whether the key exists. */
	hasValidChecksum(raw: string): boolean;
}

export function createApiTokenCodec(secret: string): ApiTokenCodec {
	const base = createTokenCodec({ prefix: API_TOKEN_PREFIX, secret });
	return {
		...base,
		mintRawToken(): string {
			const random = randomBase62(RANDOM_LENGTH);
			return API_TOKEN_PREFIX + random + checksum(random);
		},
		hasValidChecksum(raw: string): boolean {
			if (!looksLikeApiToken(raw)) return false;
			const body = raw.slice(API_TOKEN_PREFIX.length);
			return checksum(body.slice(0, RANDOM_LENGTH)) === body.slice(RANDOM_LENGTH);
		}
	};
}
