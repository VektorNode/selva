import {
	resolveServerForOrg as resolvePure,
	type ComputeServerConfig,
	type RequestContext
} from '@selvajs/platform';
import { getComputeServerConfigStore } from '../providers.server';
import { ComputeServerUnconfiguredError } from './errors';

// Re-exported so the throw site and the class still read as one unit. Error
// mappers should import from `./errors` directly — importing it from here drags
// in `providers.server` and its top-level await.
export { ComputeServerUnconfiguredError };

/**
 * Pick the right Rhino.Compute server for an (org, definition) pair.
 *
 * Resolution order, narrowest wins:
 *   1. `definitionPin` if it points at a server visible to `orgId`.
 *   2. `orgDefaults[orgId]` if set and visible.
 *   3. Global `defaultServerId`.
 *
 * The store returns the full config; the visibility predicate runs in the pure
 * helper so callers don't reimplement it. Re-throws the pure helper's "nothing
 * visible" failure as a typed `ComputeServerUnconfiguredError`.
 *
 * Reads a key-free config and fetches the `apiKey` only for the server that
 * actually wins, instead of decrypting every configured server's key to use
 * exactly one of them.
 */
export async function resolveServerForOrg(
	ctx: RequestContext,
	orgId: string | null | undefined,
	opts: { definitionPin?: string | null } = {}
): Promise<ComputeServerConfig> {
	const store = getComputeServerConfigStore();
	const config = await store.getConfig(ctx);
	let server: ComputeServerConfig;
	try {
		server = resolvePure(config, orgId, { definitionPin: opts.definitionPin });
	} catch (err) {
		throw new ComputeServerUnconfiguredError(err instanceof Error ? err.message : undefined);
	}
	if (!server.hasApiKey) return server;
	return { ...server, apiKey: await store.getServerApiKey(ctx, server.id) };
}
