import { readSetting, type EnvRecord } from '@selvajs/platform/config';
import { SIGN_IN_MAX_AGE_SETTING } from '../config/settings.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// A stamp this far ahead of the server clock is skew; further ahead it is a
// restored or hand-edited file, and trusting it would pin the age check open.
const FUTURE_SKEW_MS = 60_000;

/**
 * `SIGN_IN_MAX_AGE_DAYS` in milliseconds: how long one sign-in at the identity
 * provider lasts before browser sessions Selva owns and API tokens need a new
 * one. Undefined when unset or 0.
 *
 * Throws on anything but a whole number of days: a typo that silently turned
 * the check off would leave a leaver's keys working.
 */
export function resolveSignInMaxAgeMs(env: EnvRecord): number | undefined {
	// A fail-closed setting reads as undefined when its value breaks the rule.
	const days = readSetting(SIGN_IN_MAX_AGE_SETTING, env) as number | undefined;
	if (days === undefined) {
		throw new Error(
			`SIGN_IN_MAX_AGE_DAYS must be a whole number of days, got "${env.SIGN_IN_MAX_AGE_DAYS}".`
		);
	}
	return days > 0 ? days * DAY_MS : undefined;
}

/**
 * Whether `lastLoginAt` (the identity provider's last real sign-in, never a
 * session refresh) is older than `maxAgeMs`. No sign-in on record, an
 * unreadable one, or one in the future all count as stale.
 */
export function signInIsStale(
	lastLoginAt: string | undefined,
	maxAgeMs: number | undefined,
	now: number
): boolean {
	if (!maxAgeMs) return false;
	const at = Date.parse(lastLoginAt ?? '');
	if (!Number.isFinite(at)) return true;
	return now - at > maxAgeMs || at - now > FUTURE_SKEW_MS;
}
