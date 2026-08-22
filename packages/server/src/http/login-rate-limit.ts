/**
 * Login rate limiting: two buckets per attempt, because neither dimension
 * covers the other.
 *
 *   - **Per-address** bounds one client hammering the form. It is only
 *     meaningful when the host resolves a real client address. Behind a reverse
 *     proxy that is not configured to forward one, every request reports the
 *     socket peer — `127.0.0.1` for all of them — which collapses the whole key
 *     space into a single bucket: five failed logins from anywhere lock out the
 *     entire instance, and only a success clears it, which nobody can now
 *     reach. That failure is completely silent, hence
 *     {@link addressKeysCollapsed}.
 *   - **Per-account** bounds a targeted guessing attack, which address limiting
 *     does not: an attacker spread across many source IPs contends with no
 *     shared counter at all, leaving password-hash cost as the only real bound
 *     on online guessing.
 *
 * An attempt must clear both and a failure charges both. A success clears the
 * account bucket and the calling address's — a *different* address that failed
 * against the same account keeps its own penalty.
 *
 * The flow counts failures rather than attempts: `check` gates without spending
 * budget, `recordFailure` spends, and `clear` forgives. A successful login
 * therefore costs nothing, so an ordinary user typing one wrong password never
 * walks toward a lockout.
 */

import { createComputeRateLimiter } from '../compute/rate-limit.js';
import type { RateLimitResult } from '../compute/rate-limit.js';

/** Loopback in the three spellings a Node server actually reports. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface LoginRateLimiterConfig {
	/** Window for both buckets. Default 15 minutes. */
	windowMs?: number;
	/** Failed logins per address per window. Default 5. */
	maxPerAddress?: number;
	/**
	 * Failed logins per account per window. Default 20 — deliberately looser
	 * than the address cap, because this bucket is reachable by an attacker who
	 * wants to lock a known user out of their own account. It trades a little
	 * brute-force headroom for not being a cheap denial of service on a named
	 * victim.
	 */
	maxPerAccount?: number;
}

export interface LoginRateLimiter {
	/**
	 * Gate one attempt without spending budget.
	 *
	 * `email` may be absent — a password-only login against a provider with no
	 * user store has no account to key on — in which case only the address
	 * bucket applies.
	 */
	check(address: string, email?: string): RateLimitResult;
	/** Charge a failed attempt to both buckets. */
	recordFailure(address: string, email?: string): void;
	/** Forgive on success. */
	clear(address: string, email?: string): void;
	/** Drop all state. For tests. */
	reset(): void;
}

/** Normalized so case tricks (`Alice@` vs `alice@`) share one bucket. */
function accountKey(email: string): string {
	return `account:${email.trim().toLowerCase()}`;
}

export function createLoginRateLimiter(config: LoginRateLimiterConfig = {}): LoginRateLimiter {
	const windowMs = config.windowMs ?? 15 * 60 * 1000;
	const byAddress = createComputeRateLimiter({
		windowMs,
		maxPerWindow: config.maxPerAddress ?? 5
	});
	const byAccount = createComputeRateLimiter({
		windowMs,
		maxPerWindow: config.maxPerAccount ?? 20
	});

	return {
		check(address, email) {
			const address_ = byAddress.peek(address);
			if (!address_.allowed || !email) return address_;
			return byAccount.peek(accountKey(email));
		},
		recordFailure(address, email) {
			byAddress.check(address);
			if (email) byAccount.check(accountKey(email));
		},
		clear(address, email) {
			byAddress.clear(address);
			if (email) byAccount.clear(accountKey(email));
		},
		reset() {
			byAddress.reset();
			byAccount.reset();
		}
	};
}

/**
 * Whether per-address limiting has degenerated into one shared bucket.
 *
 * True when the host reports a loopback address for a request it did not
 * originate — which means it sits behind a proxy and is reading the socket peer
 * instead of a forwarded client address. The host decides what to do about it;
 * warning once at startup is enough, and warning per request is not.
 *
 * `addressHeaderConfigured` is the host's answer to "am I reading a forwarded
 * header at all", since which header and how many hops to trust are deployment
 * config that no package can resolve for it.
 */
export function addressKeysCollapsed(address: string, addressHeaderConfigured: boolean): boolean {
	if (addressHeaderConfigured) return false;
	return LOOPBACK.has(address);
}
