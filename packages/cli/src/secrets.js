import { randomBytes } from 'node:crypto';

// 32 bytes hex = 64-character string. Matches the runtime's expectation
// (HMAC-SHA256 key + AES-256-GCM key, both 32 bytes).
export function generateKey() {
	return randomBytes(32).toString('hex');
}
