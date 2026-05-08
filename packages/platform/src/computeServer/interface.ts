import type { RequestContext } from '../context.js';
import type { ComputeConfig, ComputeServerConfig } from './types.js';

/**
 * Compute-server configuration. Spec §3.
 *
 * One config doc holds *all* servers (platform + org-private) plus the
 * global `defaultServerId` and per-org `orgDefaults` map. Authorization is
 * the route layer's job — `manage_compute` for platform-server mutations,
 * `manage_org_compute` (gated by the `ALLOW_ORG_COMPUTE_OVERRIDE` flag) for
 * org-private mutations and `orgDefaults[orgId]`.
 */
export interface IComputeServerStore {
	/**
	 * Read the full config. Callers (resolver, page loaders, route handlers)
	 * apply the visibility predicate from `serversVisibleTo` themselves —
	 * the store does not pre-filter, because the same row set is needed at
	 * different scopes (admin manage vs. org manage vs. solve).
	 */
	getConfig(ctx: RequestContext): Promise<ComputeConfig>;

	/**
	 * Replace the entire platform-server set + global `defaultServerId`.
	 * Org-private rows and `orgDefaults` are left untouched.
	 */
	savePlatformServers(
		ctx: RequestContext,
		servers: ComputeServerConfig[],
		defaultServerId: string | undefined
	): Promise<void>;

	/**
	 * Replace the org-private server set for `orgId` and (optionally) update
	 * `orgDefaults[orgId]`. Platform rows are left untouched.
	 *
	 * Pass `defaultServerId: null` to clear the org's override; `undefined`
	 * leaves the existing value alone.
	 */
	saveOrgServers(
		ctx: RequestContext,
		orgId: string,
		servers: ComputeServerConfig[],
		defaultServerId?: string | null
	): Promise<void>;

	/**
	 * Set or clear `orgDefaults[orgId]`. The route layer is responsible for
	 * verifying the chosen server is visible to the org before calling this.
	 *
	 * `serverId === null` clears the override.
	 */
	setOrgDefault(ctx: RequestContext, orgId: string, serverId: string | null): Promise<void>;

	/**
	 * Hard-delete this org's compute rows: org-private servers, the
	 * `orgDefaults[orgId]` entry, and any references to this org inside
	 * platform servers' `sharedWith` allowlists. No-op when none exist.
	 * Called from `deleteOrg` so soft-deleting an org does not leave its
	 * compute config behind.
	 */
	deleteByOrg(ctx: RequestContext, orgId: string): Promise<void>;
}
