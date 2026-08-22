import {
	resolveServerForOrg as resolvePure,
	type ComputeServerConfig,
	type IDataProvider,
	type RequestContext
} from '@selvajs/platform';
import { ComputeServerUnconfiguredError } from './errors.js';

// Re-exported so the throw site and the class still read as one unit. Error
// mappers should import from `./errors.js` directly.
export { ComputeServerUnconfiguredError };

/** The one store this module reads — `SelvaDeps['computeServer']`. */
type ComputeServerStore = IDataProvider['computeServer'];

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
	store: ComputeServerStore,
	opts: { definitionPin?: string | null } = {}
): Promise<ComputeServerConfig> {
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
