import {
	resolveComputeServerForOrg,
	type ComputeConfig,
	type ComputeServerConfig,
	type RequestContext
} from '@selva/platform';
import { flag, getComputeServerConfigStore } from '../providers.server';

/**
 * Spec §3 — pick the right Rhino.Compute server for a given org context.
 *   1. If `ALLOW_ORG_COMPUTE_OVERRIDE` is on AND the org has its own
 *      configured server, use it.
 *   2. Otherwise fall through to the instance pool.
 *
 * Used by every solve/schema path; the caller picks the orgId (project's
 * `orgId` for solves, `ctx.actingOrgId` for schema previews).
 */
export async function resolveServerForOrg(
	ctx: RequestContext,
	orgId: string | null | undefined
): Promise<ComputeServerConfig> {
	const store = getComputeServerConfigStore();
	const allowOverride = flag('ALLOW_ORG_COMPUTE_OVERRIDE');

	// Always fetch the instance pool — it's the fallback. Strip actingOrgId so
	// the store gives us the instance scope, not the user's current org scope.
	const instance = await store.getConfig({
		...ctx,
		actingOrgId: undefined,
		orgPermissions: []
	});

	let org: ComputeConfig | null = null;
	if (orgId && allowOverride) {
		org = await store.getConfig({ ...ctx, actingOrgId: orgId });
	}
	return resolveComputeServerForOrg(instance, org, { allowOrgOverride: allowOverride });
}
