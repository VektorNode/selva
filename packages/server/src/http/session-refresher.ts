import type { IAuthProvider, ISessionRefresh } from '@selvajs/platform';
import { createBoundedTtlCache } from './bounded-ttl-cache.js';
import { signInIsStale } from './sign-in-age.js';

type SessionPair = NonNullable<Awaited<ReturnType<ISessionRefresh['refreshSession']>>>;

/** Long enough for the requests of one page load that left before the new cookie landed. */
const RECENT_PAIR_TTL_MS = 10_000;
const RECENT_PAIR_MAX = 1_000;

export type SessionRefresher = (refreshToken: string) => Promise<SessionPair | null>;

export interface SessionRefresherOptions {
	/**
	 * Refuse a refresh once the user's last real sign-in is older than this
	 * (see `resolveSignInMaxAgeMs`). A provider's refresh never asks the
	 * identity provider again, so without it a session outlives the account.
	 */
	signInMaxAgeMs?: number;
	auth?: () => Pick<IAuthProvider, 'verifyToken' | 'getUser'>;
	now?: () => number;
}

/**
 * A page's parallel requests all arrive with the same expired session and the same refresh token,
 * and a provider may rotate that token on first use. Each request exchanging it alone would see
 * every one after the first refused, read that as a dead session, and clear the cookie: a signed-in
 * user logged out by loading a page. So they share one exchange and its answer.
 *
 * `getRefresh` is read per exchange so a host can swap providers. One per process.
 */
export function createSessionRefresher(
	getRefresh: () => ISessionRefresh | undefined,
	{ signInMaxAgeMs, auth, now = Date.now }: SessionRefresherOptions = {}
): SessionRefresher {
	const inflight = new Map<string, Promise<SessionPair | null>>();
	const recent = createBoundedTtlCache<SessionPair>({ maxEntries: RECENT_PAIR_MAX });

	// Only a user we could read counts as lapsed: a failed lookup must not sign
	// someone out on every device. API tokens are checked on their own path.
	async function signInLapsed(pair: SessionPair): Promise<boolean> {
		if (!signInMaxAgeMs || !auth) return false;
		try {
			const provider = auth();
			const session = await provider.verifyToken(pair.sessionToken);
			const user = session && (await provider.getUser(session.id));
			return !!user && signInIsStale(user.lastLoginAt, signInMaxAgeMs, now());
		} catch {
			return false;
		}
	}

	async function exchange(refreshToken: string) {
		const refresh = getRefresh();
		const pair = (await refresh?.refreshSession(refreshToken)) ?? null;
		if (pair && (await signInLapsed(pair))) {
			await refresh?.revokeSession(pair.sessionToken).catch(() => false);
			return null;
		}
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
