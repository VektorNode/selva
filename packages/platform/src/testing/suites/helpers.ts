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
		platformPermissions: opts.platformPermissions ?? ['platform_admin'],
		orgPermissions: opts.orgPermissions ?? [...ALL_ORG_PERMISSIONS]
	};
}

export function makeUuid(): string {
	return crypto.randomUUID();
}
