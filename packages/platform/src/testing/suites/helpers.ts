import type { RequestContext } from '../../context.js';
import { ALL_ORG_PERMISSIONS } from '../../organizations/schemas.js';

/**
 * Build a test `RequestContext`. Defaults to a platform admin to keep existing
 * suites permissive; tests that verify permission gating should pass explicit
 * platform/org permission arrays.
 */
export function makeCtx(
	userId: string,
	opts: {
		orgId?: string;
		platformPermissions?: RequestContext['platformPermissions'];
		orgPermissions?: RequestContext['orgPermissions'];
	} = {}
): RequestContext {
	return {
		userId,
		orgId: opts.orgId,
		platformPermissions: opts.platformPermissions ?? ['instance_admin'],
		orgPermissions: opts.orgPermissions ?? [...ALL_ORG_PERMISSIONS]
	};
}

export function makeUuid(): string {
	return crypto.randomUUID();
}

/**
 * Optional hook adapters pass when their backend enforces referential
 * integrity on user ids (e.g. Supabase `auth.users`). Returns the id the
 * adapter actually stored — adapters that require DB-generated ids (like
 * Supabase Auth, which won't let the caller pick) can ignore the suggested
 * id and return whatever real id ended up created. Adapters without user
 * FKs (local JSON) return the suggested id as-is.
 *
 * The conformance suite calls this to get a usable id *before* constructing
 * any record that references a user. It never assumes the suggested id is
 * the one used.
 */
export type SeedUserFn = (suggestedId: string) => Promise<string>;

/** Default no-op for adapters that don't need to seed users. Echoes the id back. */
export const noopSeedUser: SeedUserFn = async (id) => id;
