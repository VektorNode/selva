import type { RequestContext } from '../../context.js';
import { ALL_ORG_PERMISSIONS } from '../../organizations/schemas.js';

/**
 * Build a test `RequestContext`. Defaults to a platform admin to keep existing
 * suites permissive; tests that verify permission gating should pass explicit
 * platform/org permission arrays.
 *
 * `sessionToken`, when supplied, is stuffed into `adapterContext.sessionToken`
 * so adapters that enforce auth at the DB layer (Supabase RLS) can run the
 * call as a real authenticated user. Local providers ignore it.
 */
export function makeCtx(
	userId: string,
	opts: {
		actingOrgId?: string;
		platformPermissions?: RequestContext['platformPermissions'];
		orgPermissions?: RequestContext['orgPermissions'];
		sessionToken?: string;
	} = {}
): RequestContext {
	return {
		userId,
		actingOrgId: opts.actingOrgId,
		platformPermissions: opts.platformPermissions ?? ['instance_admin'],
		orgPermissions: opts.orgPermissions ?? [...ALL_ORG_PERMISSIONS],
		adapterContext: opts.sessionToken ? { sessionToken: opts.sessionToken } : undefined
	};
}

export function makeUuid(): string {
	return crypto.randomUUID();
}

/**
 * Optional hook adapters pass when their backend enforces referential
 * integrity on user ids (e.g. Supabase `auth.users`). Returns the id the
 * adapter actually stored AND, optionally, a session token the suite can
 * thread back into `makeCtx({ sessionToken })` so the resulting calls run
 * as that user.
 *
 * Adapters without user FKs (local JSON) return the suggested id as-is and
 * omit the token. Adapters with auth (Supabase) ignore the suggested id,
 * create a fresh user, sign in as them, and return the real id + access JWT.
 *
 * The conformance suite calls this to get a usable id *before* constructing
 * any record that references a user. It never assumes the suggested id is
 * the one used.
 */
export type SeedUserResult = { userId: string; sessionToken?: string };
export type SeedUserFn = (suggestedId: string) => Promise<SeedUserResult>;

/** Default no-op for adapters that don't need to seed users. Echoes the id back, no token. */
export const noopSeedUser: SeedUserFn = async (id) => ({ userId: id });

/**
 * Wraps a `SeedUserFn` so suites can keep their existing `seed() → userId` and
 * `ctx(userId)` shape while transparently threading session tokens for adapters
 * that return them. Build one per test (Map is mutable & local).
 */
export function makeSeedHelpers(seedUser: SeedUserFn) {
	const tokens = new Map<string, string>();

	async function seed(): Promise<string> {
		const result = await seedUser(makeUuid());
		if (result.sessionToken) tokens.set(result.userId, result.sessionToken);
		return result.userId;
	}

	/** Register a token for a user that wasn't created via `seed()` (e.g. one returned by `createStore`). */
	function registerToken(userId: string, sessionToken: string): void {
		tokens.set(userId, sessionToken);
	}

	function ctx(
		userId: string,
		opts: {
			actingOrgId?: string;
			platformPermissions?: RequestContext['platformPermissions'];
			orgPermissions?: RequestContext['orgPermissions'];
		} = {}
	): RequestContext {
		return makeCtx(userId, { ...opts, sessionToken: tokens.get(userId) });
	}

	return { seed, ctx, registerToken, tokens };
}
