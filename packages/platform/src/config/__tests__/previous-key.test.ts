import { describe, expect, it } from 'vitest';
import { previousKey } from '../index.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');

describe('previousKey', () => {
	it('is accepted until its deadline, with the days left', () => {
		const p = previousKey(
			{ SELVA_HMAC_KEY_PREVIOUS: 'old', SELVA_HMAC_KEY_PREVIOUS_EXPIRES: '2026-11-13T12:00:00Z' },
			'SELVA_HMAC_KEY',
			NOW
		);
		expect(p).toEqual({
			state: 'active',
			key: 'old',
			expires: '2026-11-13T12:00:00Z',
			daysLeft: 10
		});
	});

	it('is not accepted once the deadline has passed', () => {
		const p = previousKey(
			{ SELVA_HMAC_KEY_PREVIOUS: 'old', SELVA_HMAC_KEY_PREVIOUS_EXPIRES: '2026-11-01T00:00:00Z' },
			'SELVA_HMAC_KEY',
			NOW
		);
		expect(p.state).toBe('expired');
		expect(p.key).toBeUndefined();
	});

	it('a previous key set by hand without a deadline is accepted, and says it has none', () => {
		const p = previousKey({ SELVA_AT_REST_KEY_PREVIOUS: 'old' }, 'SELVA_AT_REST_KEY', NOW);
		expect(p).toEqual({ state: 'no-deadline', key: 'old' });
	});

	it.each([
		['2026-11-13', 10],
		['2026-11-13T13:00:00.000+01:00', 10]
	])('reads an ISO date or timestamp: %s', (expires, daysLeft) => {
		const p = previousKey(
			{ SELVA_HMAC_KEY_PREVIOUS: 'old', SELVA_HMAC_KEY_PREVIOUS_EXPIRES: expires },
			'SELVA_HMAC_KEY',
			NOW
		);
		expect(p).toMatchObject({ state: 'active', daysLeft });
	});

	it.each(['next tuesday', '12.1.2027', '2026-11-31', 'Dec 1 2026', '2099-12-01'])(
		'an unreadable or implausible deadline counts as passed: %s',
		(expires) => {
			const p = previousKey(
				{ SELVA_HMAC_KEY_PREVIOUS: 'old', SELVA_HMAC_KEY_PREVIOUS_EXPIRES: expires },
				'SELVA_HMAC_KEY',
				NOW
			);
			expect(p.state).toBe('expired');
			expect(p.key).toBeUndefined();
		}
	);

	it('a deadline extended by hand within a few rotations is accepted', () => {
		const p = previousKey(
			{ SELVA_HMAC_KEY_PREVIOUS: 'old', SELVA_HMAC_KEY_PREVIOUS_EXPIRES: '2027-01-02' },
			'SELVA_HMAC_KEY',
			NOW
		);
		expect(p.state).toBe('active');
	});

	it('no previous key', () => {
		expect(previousKey({}, 'SELVA_HMAC_KEY', NOW)).toEqual({ state: 'none' });
	});
});
