import type { EnvRecord } from './resolve.js';

/** How long `selva keys rotate` keeps the previous key accepted. */
export const PREVIOUS_KEY_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * `active`: accepted until `expires`. `expired`: past its deadline (or the
 * deadline is unreadable), no longer accepted. `no-deadline`: set by hand
 * without `<KEY>_PREVIOUS_EXPIRES`, accepted, and reported so someone sets one.
 */
export type PreviousKey =
	| { state: 'none'; key?: undefined }
	| { state: 'active'; key: string; expires: string; daysLeft: number }
	| { state: 'expired'; key?: undefined; expires: string }
	| { state: 'no-deadline'; key: string };

/**
 * The previous key for `base` (`SELVA_HMAC_KEY` or `SELVA_AT_REST_KEY`), if it
 * is still within its deadline. A rotation is meant to bound how long a key
 * that leaked unnoticed stays useful, so the overlap ends on its own.
 */
export function previousKey(env: EnvRecord, base: string, now: number = Date.now()): PreviousKey {
	const key = env[`${base}_PREVIOUS`]?.trim();
	if (!key) return { state: 'none' };
	const expires = env[`${base}_PREVIOUS_EXPIRES`]?.trim();
	if (!expires) return { state: 'no-deadline', key };
	const at = Date.parse(expires);
	// Unreadable is treated as passed: a typo must not keep an old key alive.
	if (!Number.isFinite(at) || at <= now) return { state: 'expired', expires };
	return { state: 'active', key, expires, daysLeft: Math.ceil((at - now) / DAY_MS) };
}

/** A root key's rotation overlap, without the key: safe to send to an admin's browser. */
export interface KeyRotation {
	key: 'SELVA_HMAC_KEY' | 'SELVA_AT_REST_KEY';
	state: PreviousKey['state'];
	expires?: string;
	daysLeft?: number;
}
