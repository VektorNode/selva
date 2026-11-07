import { randomBytes } from 'node:crypto';

// What the shipped .env template holds until a real key replaces it.
export const KEY_PLACEHOLDER = 'replace-this-with-a-random-32-byte-hex-key';

// 32 bytes hex = 64-character string. Matches the runtime's expectation
// (HMAC-SHA256 key + AES-256-GCM key, both 32 bytes).
export function generateKey() {
	return randomBytes(32).toString('hex');
}
