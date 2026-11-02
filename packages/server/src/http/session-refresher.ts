import type { ISessionRefresh } from '@selvajs/platform';
import { createBoundedTtlCache } from './bounded-ttl-cache.js';

type SessionPair = NonNullable<Awaited<ReturnType<ISessionRefresh['refreshSession']>>>;

/** Long enough for the requests of one page load that left before the new cookie landed. */
const RECENT_PAIR_TTL_MS = 10_000;
const RECENT_PAIR_MAX = 1_000;

export type SessionRefresher = (refreshToken: string) => Promise<SessionPair | null>;

/**
 * A page's parallel requests all arrive with the same expired session and the same refresh token,
 * and a provider may rotate that token on first use. Each request exchanging it alone would see
 * every one after the first refused, read that as a dead session, and clear the cookie: a signed-in
 * user logged out by loading a page. So they share one exchange and its answer.
 *
 * `getRefresh` is read per exchange so a host can swap providers. One per process.
 */
export function createSessionRefresher(
	getRefresh: () => ISessionRefresh | undefined
): SessionRefresher {
	const inflight = new Map<string, Promise<SessionPair | null>>();
	const recent = createBoundedTtlCache<SessionPair>({ maxEntries: RECENT_PAIR_MAX });

	async function exchange(refreshToken: string) {
		const pair = (await getRefresh()?.refreshSession(refreshToken)) ?? null;
		if (pair) recent.set(refreshToken, pair, RECENT_PAIR_TTL_MS);
		return pair;
	}

	return (refreshToken) => {
		const done = recent.get(refreshToken);
		if (done) return Promise.resolve(done);
		let pending = inflight.get(refreshToken);
		if (!pending) {
			pending = exchange(refreshToken).finally(() => inflight.delete(refreshToken));
			inflight.set(refreshToken, pending);
		}
		return pending;
	};
}
