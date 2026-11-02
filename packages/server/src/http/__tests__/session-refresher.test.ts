import type { ISessionRefresh } from '@selvajs/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionRefresher } from '../session-refresher.js';

const PAIR = { sessionToken: 'new-session', refreshToken: 'new-refresh' };

function provider(refreshSession: ISessionRefresh['refreshSession']) {
	return { refreshSession, revokeSession: vi.fn() } as unknown as ISessionRefresh;
}

describe('createSessionRefresher', () => {
	afterEach(() => vi.useRealTimers());

	it('gives parallel requests one exchange and one answer', async () => {
		const refreshSession = vi.fn(async () => PAIR);
		const refresh = createSessionRefresher(() => provider(refreshSession));

		const answers = await Promise.all([refresh('t'), refresh('t'), refresh('t')]);

		expect(refreshSession).toHaveBeenCalledTimes(1);
		expect(answers).toEqual([PAIR, PAIR, PAIR]);
	});

	it('answers a straggler with the same pair after the exchange finished', async () => {
		const refreshSession = vi.fn(async () => PAIR);
		const refresh = createSessionRefresher(() => provider(refreshSession));

		await refresh('t');

		await expect(refresh('t')).resolves.toEqual(PAIR);
		expect(refreshSession).toHaveBeenCalledTimes(1);
	});

	it('exchanges again once the remembered pair expires', async () => {
		vi.useFakeTimers();
		const refreshSession = vi.fn(async () => PAIR);
		const refresh = createSessionRefresher(() => provider(refreshSession));

		await refresh('t');
		vi.advanceTimersByTime(10_001);
		await refresh('t');

		expect(refreshSession).toHaveBeenCalledTimes(2);
	});

	it('keeps different refresh tokens apart', async () => {
		const refreshSession = vi.fn(async () => PAIR);
		const refresh = createSessionRefresher(() => provider(refreshSession));

		await Promise.all([refresh('a'), refresh('b')]);

		expect(refreshSession).toHaveBeenCalledTimes(2);
	});

	it('does not remember a refused token, so a later try reaches the provider', async () => {
		const refreshSession = vi.fn(async () => null);
		const refresh = createSessionRefresher(() => provider(refreshSession));

		await expect(refresh('t')).resolves.toBeNull();
		await refresh('t');

		expect(refreshSession).toHaveBeenCalledTimes(2);
	});

	it('frees the token after a rejected exchange', async () => {
		const refreshSession = vi
			.fn<ISessionRefresh['refreshSession']>()
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValueOnce(PAIR);
		const refresh = createSessionRefresher(() => provider(refreshSession));

		await expect(refresh('t')).rejects.toThrow('network');

		await expect(refresh('t')).resolves.toEqual(PAIR);
	});

	it('reads null without a provider that refreshes', async () => {
		const refresh = createSessionRefresher(() => undefined);

		await expect(refresh('t')).resolves.toBeNull();
	});
});
