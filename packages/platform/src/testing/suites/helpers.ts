import { expect } from 'vitest';
import type { RequestContext } from '../../context.js';
import { ALL_ORG_PERMISSIONS } from '../../organizations/schemas.js';

/**
 * Build a test `RequestContext`. Defaults to a platform admin; a suite run with
 * `nonAdminCtx` passes `platformPermissions: []` through its seed helpers.
 *
 * `sessionToken` goes into `adapterContext.sessionToken`, so an adapter that
 * enforces auth in the database (Supabase RLS) runs the call as that user.
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

/**
 * A system context holding no permissions of its own, for proving a store leans on
 * `system` rather than on a permission `SYSTEM_CONTEXT` happens to carry.
 */
export function makeSystemCtx(userId = ''): RequestContext {
	return { userId, platformPermissions: [], orgPermissions: [], system: true };
}

/** An anonymous share-link holder: `system` for adapter dispatch, never authority. */
export function makeShareCtx(): RequestContext {
	return {
		userId: '',
		platformPermissions: [],
		orgPermissions: [],
		system: true,
		shareLinkId: makeUuid()
	};
}

export function makeUuid(): string {
	return crypto.randomUUID();
}

export function randomSlug(prefix = 'test'): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Lets the clock move past the current millisecond, so a timestamp written next is strictly later. */
export function nextTick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 5));
}

/**
 * Optional hook for adapters whose backend enforces referential integrity on user
 * ids (Supabase `auth.users`). Returns the id the adapter actually stored and,
 * optionally, a session token the suite threads into `ctx` so calls run as that
 * user. Adapters without user FKs echo the suggested id and omit the token.
 */
export type SeedUserResult = { userId: string; sessionToken?: string };
export type SeedUserFn = (suggestedId: string) => Promise<SeedUserResult>;

export const noopSeedUser: SeedUserFn = async (id) => ({ userId: id });

/** Fails unless `promise` rejects with this `statusCode`. A `TypeError` from a bug does not pass. */
export async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
	await expect(promise).rejects.toMatchObject({ statusCode: status });
}

/**
 * The denial check a suite uses: the exact status under `strictDenials`, any
 * rejection otherwise.
 */
export function makeExpectDenied(
	strictDenials: boolean
): (promise: Promise<unknown>, status: number) => Promise<void> {
	return (promise, status) =>
		strictDenials ? expectStatus(promise, status) : expect(promise).rejects.toThrow();
}

/**
 * Per-run user bookkeeping: seeds users, remembers their session tokens, and
 * builds a `ctx` that carries the right token. Call it inside a `run*` function
 * so each suite registration has its own token map.
 */
export function makeSeedHelpers(seedUser: SeedUserFn, opts: { nonAdminCtx?: boolean } = {}) {
	const tokens = new Map<string, string>();

	function remember(user: { userId?: string; sessionToken?: string }): void {
		if (user.userId && user.sessionToken) tokens.set(user.userId, user.sessionToken);
	}

	async function seed(): Promise<string> {
		const result = await seedUser(makeUuid());
		remember(result);
		return result.userId;
	}

	function ctx(
		userId: string,
		perms: {
			actingOrgId?: string;
			platformPermissions?: RequestContext['platformPermissions'];
			orgPermissions?: RequestContext['orgPermissions'];
		} = {}
	): RequestContext {
		return makeCtx(userId, {
			...perms,
			platformPermissions: perms.platformPermissions ?? (opts.nonAdminCtx ? [] : undefined),
			sessionToken: tokens.get(userId)
		});
	}

	/**
	 * The adapter's per-test scope (or `fallback` when it supplies none), with the
	 * session tokens of the users `usersOf` names registered.
	 */
	function scopeFrom<S>(
		createScope: (() => Promise<S> | S) | undefined,
		fallback: S,
		usersOf: (scope: S) => Array<{ userId?: string; sessionToken?: string }>
	): () => Promise<S> {
		return async () => {
			const scope = createScope ? await createScope() : fallback;
			for (const user of usersOf(scope)) remember(user);
			return scope;
		};
	}

	return { seed, ctx, remember, scopeFrom };
}
