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

describe('createSessionRefresher with a sign-in max age', () => {
	const DAY = 86_400_000;
	const NOW = Date.parse('2026-11-03T12:00:00Z');

	function withSignIn(lastLoginAt: string | undefined) {
		const refreshSession = vi.fn(async () => PAIR);
		const revokeSession = vi.fn(async () => true);
		const auth = {
			verifyToken: vi.fn(async (token: string) =>
				token === PAIR.sessionToken ? { id: 'u1' } : null
			),
			getUser: vi.fn(async () => ({ id: 'u1', lastLoginAt }))
		};
		const refresh = createSessionRefresher(
			() => ({ refreshSession, revokeSession }) as unknown as ISessionRefresh,
			{ signInMaxAgeMs: 7 * DAY, auth: () => auth, now: () => NOW }
		);
		return { refresh, revokeSession };
	}

	it('refreshes while the last sign-in is within the max age', async () => {
		const { refresh } = withSignIn(new Date(NOW - 6 * DAY).toISOString());
		await expect(refresh('t')).resolves.toEqual(PAIR);
	});

	it('ends the session once the last sign-in is older, so the user signs in again', async () => {
		const { refresh, revokeSession } = withSignIn(new Date(NOW - 8 * DAY).toISOString());
		await expect(refresh('t')).resolves.toBeNull();
		expect(revokeSession).toHaveBeenCalledWith(PAIR.sessionToken);
	});
});

describe('createSessionRefresher when the sign-in lookup fails', () => {
	it('keeps the session rather than signing the user out everywhere', async () => {
		const revokeSession = vi.fn(async () => true);
		const refresh = createSessionRefresher(
			() => ({ refreshSession: async () => PAIR, revokeSession }) as unknown as ISessionRefresh,
			{
				signInMaxAgeMs: 7 * 86_400_000,
				auth: () => ({
					verifyToken: async () => ({ id: 'u1' }),
					getUser: async () => {
						throw new Error('GoTrue 503');
					}
				})
			}
		);
		await expect(refresh('t')).resolves.toEqual(PAIR);
		expect(revokeSession).not.toHaveBeenCalled();
	});
});
