import type { EnvRecord } from './resolve.js';

/** How long `selva keys rotate` keeps the previous key accepted. */
export const PREVIOUS_KEY_DAYS = 30;
// Room to extend one overlap by hand; a deadline further out is likelier a typo than a plan.
const MAX_DEADLINE_DAYS = 3 * PREVIOUS_KEY_DAYS;

const DAY_MS = 86_400_000;

/**
 * `active`: accepted until `expires`. `expired`: past its deadline (or the
 * deadline is unreadable or too far out), no longer accepted. `no-deadline`: set
 * by hand without `<KEY>_PREVIOUS_EXPIRES`, accepted, and reported so someone sets one.
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
	const at = parseDeadline(expires);
	// Unreadable or too far out is treated as passed: a typo must not keep an old key alive.
	if (at === null || at <= now || at - now > MAX_DEADLINE_DAYS * DAY_MS) {
		return { state: 'expired', expires };
	}
	return { state: 'active', key, expires, daysLeft: Math.ceil((at - now) / DAY_MS) };
}

const ISO_DEADLINE =
	/^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(\.\d+)?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/;

/**
 * `YYYY-MM-DD`, or an ISO timestamp, UTC unless it names an offset. Not
 * `Date.parse`: it reads `12.1.2027` as 1 December and rolls `2026-11-31` over.
 */
function parseDeadline(text: string): number | null {
	const m = ISO_DEADLINE.exec(text);
	if (!m) return null;
	const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '', zone = 'Z'] = m;
	const midnight = Date.UTC(Number(year), Number(month) - 1, Number(day));
	const date = new Date(midnight);
	if (
		date.getUTCFullYear() !== Number(year) ||
		date.getUTCMonth() !== Number(month) - 1 ||
		date.getUTCDate() !== Number(day)
	) {
		return null;
	}
	const offsetMinutes =
		zone === 'Z'
			? 0
			: (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4)));
	const seconds = (Number(hour) * 60 + Number(minute) - offsetMinutes) * 60 + Number(second);
	return midnight + seconds * 1000 + Math.floor(Number(`0${fraction}`) * 1000);
}

/** A root key's rotation overlap, without the key: safe to send to an admin's browser. */
export interface KeyRotation {
	key: 'SELVA_HMAC_KEY' | 'SELVA_AT_REST_KEY';
	state: PreviousKey['state'];
	expires?: string;
	daysLeft?: number;
}
