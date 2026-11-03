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

// ============================================================================
// Cached resolution
// ============================================================================

export interface ServerResolver {
	/** `resolveServerForOrg`, answered from what the same caller resolved within the TTL. */
	resolve(
		ctx: RequestContext,
		orgId: string | null | undefined,
		store: ComputeServerStore,
		opts?: { definitionPin?: string | null }
	): Promise<ComputeServerConfig>;
	/** Call after any compute-config write: the next resolve reads the config again. */
	forget(): void;
}

/**
 * Remembers each caller's resolved server for `ttlMs`: every solve and every
 * describe resolves one, and the config changes only through its own write
 * handlers, which call `forget`. The TTL bounds a write made on another
 * instance. Keyed by what row security decides visibility by, so one caller's
 * answer is never handed to another; a share link's anonymous context is never
 * remembered. A failed read is not kept.
 */
export function createServerResolver({
	ttlMs = 30_000,
	maxEntries = 1_000
}: { ttlMs?: number; maxEntries?: number } = {}): ServerResolver {
	// Per store: a host that swaps its data provider (tests do) must not read another's answers.
	let byStore = new WeakMap<
		ComputeServerStore,
		Map<string, { server: Promise<ComputeServerConfig>; until: number }>
	>();
	return {
		resolve(ctx, orgId, store, opts = {}) {
			const caller = callerKey(ctx);
			if (caller === null) return resolveServerForOrg(ctx, orgId, store, opts);
			let entries = byStore.get(store);
			if (!entries) byStore.set(store, (entries = new Map()));
			const key = `${caller}|${orgId ?? ''}|${opts.definitionPin ?? ''}`;
			const now = Date.now();
			const hit = entries.get(key);
			if (hit && hit.until > now) return hit.server;
			if (entries.size >= maxEntries) {
				for (const [k, e] of entries) if (e.until <= now) entries.delete(k);
				while (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
			}
			const server = resolveServerForOrg(ctx, orgId, store, opts);
			entries.set(key, { server, until: now + ttlMs });
			server.catch(() => {
				if (entries.get(key)?.server === server) entries.delete(key);
			});
			return server;
		},
		forget() {
			byStore = new WeakMap();
		}
	};
}

/** Who row security sees: the user, acting org, platform permissions and API key; null for a share link. */
function callerKey(ctx: RequestContext): string | null {
	if (ctx.system) return ctx.shareLinkId ? null : 'system';
	if (!ctx.userId) return null;
	const permissions = [...ctx.platformPermissions].sort().join(',');
	return `${ctx.userId}:${ctx.actingOrgId ?? ''}:${permissions}:${ctx.apiScope?.tokenId ?? ''}`;
}
