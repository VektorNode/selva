import type { RequestContext } from '../context.js';
import type { PlatformProjectGrant } from './types.js';

/**
 * Grants for `platform`-visibility projects. Lets `instance_admin` grant orgs
 * or individual users view-only or view+solve access without creating
 * project membership rows.
 *
 * All deletes are hard-deletes — grants have no downstream references and
 * revocation is immediate.
 *
 * The Supabase adapter does not implement grants: its store is a stub that throws 501 and sets
 * `unsupported`, and `createSelvaProviders` then refuses `ENABLE_PLATFORM_PROJECTS`.
 */
export interface IPlatformProjectGrantStore {
	/** Set by a stub that cannot store grants, so a host can refuse the feature instead of 501ing. */
	readonly unsupported?: true;
	listByProject(ctx: RequestContext, projectId: string): Promise<PlatformProjectGrant[]>;
	/** Keys are the requested `projectIds`; a project with no grants maps to an empty array. */
	listByProjects(
		ctx: RequestContext,
		projectIds: readonly string[]
	): Promise<Map<string, PlatformProjectGrant[]>>;
	create(ctx: RequestContext, grant: PlatformProjectGrant): Promise<void>;
	delete(ctx: RequestContext, id: string): Promise<void>;
	/** Cascade hook called by `deleteProject`. */
	deleteByProject(ctx: RequestContext, projectId: string): Promise<void>;
	/**
	 * Cascade hook called by `deleteOrg`: drops every org grant whose
	 * `granteeId === orgId`. User grants are identity-scoped and remain.
	 */
	deleteByGranteeOrg(ctx: RequestContext, orgId: string): Promise<void>;
}
