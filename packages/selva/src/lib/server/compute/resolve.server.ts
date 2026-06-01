import {
	resolveServerForOrg as resolvePure,
	type ComputeServerConfig,
	type RequestContext
} from '@selvajs/platform';
import { getComputeServerConfigStore } from '../providers.server';

/**
 * Thrown when no compute server is configured or visible for the org — a
 * misconfiguration an operator must fix in `/admin/compute`, not a bug. Routes
 * map this to 503 with operator guidance instead of letting the pure helper's
 * plain `Error` surface as a generic 500. `handleApiError` recognizes it; the
 * two compute routes that don't route through `handleApiError` map it inline.
 */
export class ComputeServerUnconfiguredError extends Error {
	constructor(
		message = 'No compute server configured. Ask an admin to add one in /admin/compute.'
	) {
		super(message);
		this.name = 'ComputeServerUnconfiguredError';
	}
}

/**
 * Spec §3 — pick the right Rhino.Compute server for a (org, definition) pair.
 *
 * Resolution order, narrowest wins:
 *   1. `definitionPin` if it points at a server visible to `orgId`.
 *   2. `orgDefaults[orgId]` if set and visible.
 *   3. Global `defaultServerId`.
 *
 * The store returns the full config; the visibility predicate runs in the
 * pure helper so callers don't reimplement it. Re-throws the pure helper's
 * "nothing visible" failure as a typed `ComputeServerUnconfiguredError` so
 * callers can map it to a 503 with operator guidance.
 */
export async function resolveServerForOrg(
	ctx: RequestContext,
	orgId: string | null | undefined,
	opts: { definitionPin?: string | null } = {}
): Promise<ComputeServerConfig> {
	const config = await getComputeServerConfigStore().getConfig(ctx);
	try {
		return resolvePure(config, orgId, { definitionPin: opts.definitionPin });
	} catch (err) {
		throw new ComputeServerUnconfiguredError(err instanceof Error ? err.message : undefined);
	}
}
