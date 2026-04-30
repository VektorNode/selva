import {
	resolveServerForOrg as resolvePure,
	type ComputeServerConfig,
	type RequestContext
} from '@selvajs/platform';
import { getComputeServerConfigStore } from '../providers.server';

/**
 * Spec §3 — pick the right Rhino.Compute server for a (org, definition) pair.
 *
 * Resolution order, narrowest wins:
 *   1. `definitionPin` if it points at a server visible to `orgId`.
 *   2. `orgDefaults[orgId]` if set and visible.
 *   3. Global `defaultServerId`.
 *
 * The store returns the full config; the visibility predicate runs in the
 * pure helper so callers don't reimplement it.
 */
export async function resolveServerForOrg(
	ctx: RequestContext,
	orgId: string | null | undefined,
	opts: { definitionPin?: string | null } = {}
): Promise<ComputeServerConfig> {
	const config = await getComputeServerConfigStore().getConfig(ctx);
	return resolvePure(config, orgId, { definitionPin: opts.definitionPin });
}
