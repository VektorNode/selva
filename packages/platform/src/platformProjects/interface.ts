import type { RequestContext } from '../context.js';
import type { PlatformProjectGrant } from './types.js';

/**
 * Grants for `platform`-visibility projects. Enables `instance_admin` to
 * grant orgs or individual users view-only or view+solve access without
 * creating project membership rows.
 *
 * All deletes are hard-deletes — grants have no downstream references and
 * revocation is immediate.
 */
export interface IPlatformProjectGrantStore {
	listByProject(ctx: RequestContext, projectId: string): Promise<PlatformProjectGrant[]>;
	create(ctx: RequestContext, grant: PlatformProjectGrant): Promise<void>;
	delete(ctx: RequestContext, id: string): Promise<void>;
	/**
	 * Cascade hook: drop every grant for a project. Called by `deleteProject`.
	 * No-op when none exist.
	 */
	deleteByProject(ctx: RequestContext, projectId: string): Promise<void>;
	/**
	 * Cascade hook: drop every org grant whose `granteeId === orgId`. Called by
	 * `deleteOrg`. User grants are identity-scoped and remain. No-op when none
	 * exist.
	 */
	deleteByGranteeOrg(ctx: RequestContext, orgId: string): Promise<void>;
}
