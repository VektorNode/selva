import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { SELVA_HMAC_KEY: 'test-secret-that-is-at-least-32-chars-long' }
}));

import { mintSolveToken, verifySolveToken } from '../token.server';

describe('solve token', () => {
	it('round-trips for the solve it was minted for', () => {
		const token = mintSolveToken('solve-1', 60_000);
		expect(verifySolveToken('solve-1', token)).toBe(true);
	});

	it('is bound to the solve id', () => {
		const token = mintSolveToken('solve-1', 60_000);
		expect(verifySolveToken('solve-2', token)).toBe(false);
	});

	it('expires', () => {
		const token = mintSolveToken('solve-1', -1);
		expect(verifySolveToken('solve-1', token)).toBe(false);
	});

	it('rejects garbage without throwing', () => {
		expect(verifySolveToken('solve-1', null)).toBe(false);
		expect(verifySolveToken('solve-1', '')).toBe(false);
		expect(verifySolveToken('solve-1', 'no-dot')).toBe(false);
		expect(verifySolveToken('solve-1', '123.')).toBe(false);
		expect(verifySolveToken('solve-1', 'abc.def')).toBe(false);
	});
});
