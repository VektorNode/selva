/**
 * Turns a session token into whatever a host attaches to a request, with the round trips that
 * cost cut to what the token needs.
 *
 * - The user's rows are read beside `verify`, keyed by the token's unverified subject, and kept
 *   only when `verify` confirms that same user. `read` must be a read: it runs before the token
 *   is checked, so it must not write anything for the subject it is handed.
 * - Requests carrying one token share one resolution while it runs.
 * - With `freshForMs`, a resolved session is reused for that long. Past it the session is still
 *   answered, and resolved again behind the request; a re-check that refuses the token drops it,
 *   so after a sign-out or disable the requests already in flight are the last to get through.
 *   A session is never answered past its token's expiry, so row security never sees an expired
 *   token mid-request.
 */

import type { AuthUser } from '@selvajs/platform';

export interface SessionResolverConfig<Rows, Session> {
	/** The token's user, or null for a token it refuses. */
	verify(token: string): Promise<AuthUser | null>;
	/** Everything the session needs that is keyed by the user id alone. Never a write. */
	read(userId: string): Promise<Rows>;
	/** The session from the verified user and its rows. Writes for the user belong here. */
	build(user: AuthUser, rows: Rows, token: string): Promise<Session> | Session;
	/**
	 * How long a resolved session is reused before a request re-checks it behind its answer.
	 * 0 (the default) keeps nothing between requests: every request resolves.
	 */
	freshForMs?: number;
	/** The cap on remembered sessions; the oldest go first. Default 5,000. */
	maxEntries?: number;
	/** The token's subject, unverified: which rows to read ahead. Default: a JWT's `sub`. */
	subjectOf?: (token: string) => string | null;
	/** The token's expiry in ms epoch, unverified. Default: a JWT's `exp`. Null: unknown. */
	expiresAtOf?: (token: string) => number | null;
	/** A background re-check that threw rather than refused. The session is kept. */
	onRefreshError?: (err: unknown) => void;
	now?: () => number;
}

export interface SessionResolver<Session> {
	/** The token's session, or null when `verify` refuses it. */
	resolve(token: string): Promise<Session | null>;
	/** Forget one token's session: after a sign-out, or a change to what it holds. */
	invalidate(token: string): void;
	/** Forget every session of `userId`: after a change to their permissions or memberships. */
	invalidateUser(userId: string): void;
	clear(): void;
}

interface Entry<Session> {
	session: Session;
	userId: string;
	resolvedAt: number;
	/** Never answered at or past this: the token's expiry, else the end of the fresh window. */
	until: number;
}

const DEFAULT_MAX_ENTRIES = 5_000;

export function createSessionResolver<Rows, Session>(
	config: SessionResolverConfig<Rows, Session>
): SessionResolver<Session> {
	const freshForMs = Math.max(0, config.freshForMs ?? 0);
	const maxEntries = Math.max(1, config.maxEntries ?? DEFAULT_MAX_ENTRIES);
	const subjectOf = config.subjectOf ?? jwtSubject;
	const expiresAtOf = config.expiresAtOf ?? jwtExpiresAt;
	const now = config.now ?? Date.now;
	const entries = new Map<string, Entry<Session>>();
	const inFlight = new Map<string, Promise<Entry<Session> | null>>();

	async function build(token: string): Promise<Entry<Session> | null> {
		const subject = subjectOf(token);
		const ahead = subject ? config.read(subject) : null;
		// A token that fails verification never awaits its read-ahead.
		ahead?.catch(() => {});
		const user = await config.verify(token);
		if (!user) return null;
		const rows = ahead && user.id === subject ? await ahead : await config.read(user.id);
		const session = await config.build(user, rows, token);
		const resolvedAt = now();
		const expiresAt = expiresAtOf(token);
		return {
			session,
			userId: user.id,
			resolvedAt,
			until: expiresAt ?? resolvedAt + freshForMs
		};
	}

	function remember(token: string, entry: Entry<Session>): void {
		if (freshForMs === 0 || entry.until <= now()) return;
		if (entries.size >= maxEntries) {
			const at = now();
			for (const [key, e] of entries) if (e.until <= at) entries.delete(key);
			// Map keeps insertion order, so the first key is the oldest.
			while (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
		}
		entries.delete(token);
		entries.set(token, entry);
	}

	function start(token: string): Promise<Entry<Session> | null> {
		const resolution = build(token).then((entry) => {
			// An invalidation while it ran dropped this resolution: what it read may be stale.
			if (inFlight.get(token) === resolution) {
				if (entry) remember(token, entry);
				else entries.delete(token);
			}
			return entry;
		});
		inFlight.set(token, resolution);
		const settle = () => {
			if (inFlight.get(token) === resolution) inFlight.delete(token);
		};
		resolution.then(settle, settle);
		return resolution;
	}

	return {
		async resolve(token) {
			if (!token) return null;
			const entry = entries.get(token);
			if (entry) {
				const at = now();
				if (entry.until <= at) {
					entries.delete(token);
				} else {
					if (at - entry.resolvedAt >= freshForMs && !inFlight.has(token)) {
						start(token).catch((err) => config.onRefreshError?.(err));
					}
					return entry.session;
				}
			}
			const resolved = await (inFlight.get(token) ?? start(token));
			return resolved?.session ?? null;
		},
		invalidate(token) {
			entries.delete(token);
			inFlight.delete(token);
		},
		invalidateUser(userId) {
			for (const [token, entry] of entries) if (entry.userId === userId) entries.delete(token);
			// A resolution under way may hold the user's old rows; none of them is kept.
			inFlight.clear();
		},
		clear() {
			entries.clear();
			inFlight.clear();
		}
	};
}

// ============================================================================
// Unverified JWT claims
// ============================================================================

function jwtClaims(token: string): Record<string, unknown> | null {
	const parts = token.split('.');
	if (parts.length !== 3 || !parts[1]) return null;
	try {
		const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
		return claims && typeof claims === 'object' ? claims : null;
	} catch {
		return null;
	}
}

function jwtSubject(token: string): string | null {
	const sub = jwtClaims(token)?.sub;
	return typeof sub === 'string' && sub ? sub : null;
}

function jwtExpiresAt(token: string): number | null {
	const exp = jwtClaims(token)?.exp;
	return typeof exp === 'number' ? exp * 1000 : null;
}
