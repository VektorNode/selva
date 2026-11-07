import { trimTrailing } from '../utils/trim.js';

/**
 * A 32-byte key written as 64 hex characters or base64 (padding optional), or
 * null. No `node:crypto` here: the config boot check imports this too.
 */
export function parseKey32(raw: string): Buffer | null {
	const key = raw.trim();
	if (/^[0-9a-fA-F]{64}$/.test(key)) return Buffer.from(key, 'hex');
	// `Buffer.from` skips what it can't decode, so only a round trip proves the
	// whole string was base64 rather than 32 bytes of it.
	const buf = Buffer.from(key, 'base64');
	return buf.length === 32 && trimTrailing(buf.toString('base64'), '=') === trimTrailing(key, '=')
		? buf
		: null;
}
