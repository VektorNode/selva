/**
 * The one thing test fixtures cannot get from `SelvaConfig`: creating and
 * reading identities.
 *
 * Everything else a fixture needs — orgs, projects, definitions, invites —
 * lives behind `IDataProvider` and is portable as-is. Identity is not.
 * `IAuthProvider` exposes user *creation* only through the optional
 * `passwordAuth.createUserWithPassword`, and a provider that authenticates by
 * OAuth or forwarded headers implements none of it, so there is no interface
 * method every provider answers. Each provider also stores identity its own
 * way — the local one in `auth-users.json`, Supabase in its own `auth.users`
 * table — and seeding has to reach that store directly, not through a login
 * flow no test wants to perform.
 *
 * So the host supplies this. Two methods, because that is all the shared
 * fixtures use: `seedUser` creates, `actAs` reads back.
 */

import type { AuthUser } from '@selvajs/platform';

export interface SeedAuthAdapter {
	/**
	 * Create an identity and return it. Called before the data-layer row exists,
	 * so implementations must not assume `ensureUser` has run.
	 *
	 * The returned `id` is what every other seeder keys off, so it has to be the
	 * id the auth provider will report for this user later — not a fresh one.
	 */
	createUser(email: string): Promise<AuthUser>;

	/** Read an identity back. `null` when absent, so `actAs` can fail loudly. */
	findById(id: string): Promise<AuthUser | null>;
}
