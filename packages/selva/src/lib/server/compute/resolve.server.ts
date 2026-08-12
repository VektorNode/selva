import {
	resolveServerForOrg as resolvePure,
	type ComputeServerConfig,
	type RequestContext
} from '@selvajs/platform';
import { getComputeServerConfigStore } from '../providers.server';

/**
 * Thrown when no compute server is configured or visible for the org — a
 * misconfiguration an operator must fix in `/admin/compute`, not a bug. Routes
 * map this to 503 instead of letting the pure helper's plain `Error` surface as
 * a generic 500.
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
