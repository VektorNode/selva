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

	it('an unreadable deadline counts as passed: fail closed', () => {
		const p = previousKey(
			{ SELVA_HMAC_KEY_PREVIOUS: 'old', SELVA_HMAC_KEY_PREVIOUS_EXPIRES: 'next tuesday' },
			'SELVA_HMAC_KEY',
			NOW
		);
		expect(p.state).toBe('expired');
		expect(p.key).toBeUndefined();
	});

	it('no previous key', () => {
		expect(previousKey({}, 'SELVA_HMAC_KEY', NOW)).toEqual({ state: 'none' });
	});
});
