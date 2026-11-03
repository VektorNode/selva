import { describe, it, expect } from 'vitest';
import { resolveSignInMaxAgeMs, signInIsStale } from '../sign-in-age.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-03T12:00:00Z');
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('resolveSignInMaxAgeMs', () => {
	it('reads whole days, unset or 0 meaning off', () => {
		expect(resolveSignInMaxAgeMs({ SIGN_IN_MAX_AGE_DAYS: '7' })).toBe(7 * DAY);
		expect(resolveSignInMaxAgeMs({ SIGN_IN_MAX_AGE_DAYS: '0' })).toBeUndefined();
		expect(resolveSignInMaxAgeMs({})).toBeUndefined();
	});

	it.each(['7d', '1w', '0.5', '-1', 'abc', 'Infinity'])(
		'refuses %s instead of turning off',
		(value) => {
			expect(() => resolveSignInMaxAgeMs({ SIGN_IN_MAX_AGE_DAYS: value })).toThrow(
				/SIGN_IN_MAX_AGE_DAYS/
			);
		}
	);
});

describe('signInIsStale', () => {
	it('is never stale without a max age', () => {
		expect(signInIsStale(undefined, undefined, NOW)).toBe(false);
	});

	it('is fresh inside the max age and stale past it', () => {
		expect(signInIsStale(at(-6 * DAY), 7 * DAY, NOW)).toBe(false);
		expect(signInIsStale(at(-8 * DAY), 7 * DAY, NOW)).toBe(true);
	});

	it('is stale with no sign-in, an unreadable one, or one in the future', () => {
		expect(signInIsStale(undefined, 7 * DAY, NOW)).toBe(true);
		expect(signInIsStale('not a date', 7 * DAY, NOW)).toBe(true);
		expect(signInIsStale(at(5 * 60_000), 7 * DAY, NOW)).toBe(true);
	});

	it('tolerates a little clock skew', () => {
		expect(signInIsStale(at(30_000), 7 * DAY, NOW)).toBe(false);
	});
});
