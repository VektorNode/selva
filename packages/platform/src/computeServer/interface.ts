import type { RequestContext } from '../context.js';
import type { ComputeConfig } from './types.js';

/**
 * Compute-server configuration. Scope is determined by `ctx.actingOrgId`:
 * unset → instance pool (admin only); set → that org's override (gated by
 * the `ALLOW_ORG_COMPUTE_OVERRIDE` platform flag at the route layer).
 */
export interface IComputeServerStore {
	getConfig(ctx: RequestContext): Promise<ComputeConfig>;
	saveConfig(ctx: RequestContext, config: ComputeConfig): Promise<void>;
	/**
	 * Hard-delete this org's compute override rows (servers + defaults). No-op
	 * when none exist. Called from `deleteOrg` so soft-deleting an org does
	 * not leave its operational config behind.
	 */
	deleteByOrg(ctx: RequestContext, orgId: string): Promise<void>;
}
