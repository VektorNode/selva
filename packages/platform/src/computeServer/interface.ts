import type { RequestContext } from '../context.js';
import type { ComputeConfig, ComputeServerConfig } from './types.js';
import type { SecretVerificationReport } from './secrets.js';

/**
 * Compute-server configuration. Architecture spec §4.8.
 *
 * One config doc holds *all* servers (platform + org-private) plus the
 * global `defaultServerId` and per-org `orgDefaults` map. Authorization is
 * the route layer's job — `manage_compute` for platform-server mutations,
 * `manage_org_compute` (gated by the `ALLOW_ORG_COMPUTE_OVERRIDE` flag) for
 * org-private mutations and `orgDefaults[orgId]`.
 */
export interface GetConfigOptions {
	/**
	 * Include each server's decrypted `apiKey`. Defaults to `false`: secrets are
	 * the exception, not the norm — most callers (pickers, page loaders, the
	 * resolver) only need connection metadata, and decrypting every stored key to
	 * satisfy them costs one decrypt per server per call on the solve path.
	 *
	 * Set this only when you genuinely need every server's key at once — i.e. the
	 * admin/org save handlers, which diff and preserve keys across a write. To use
	 * a single server's key (the common case), resolve the server first and then
	 * call `getServerApiKey` for just that one.
	 */
	includeApiKeys?: boolean;
}

export interface IComputeServerStore {
	/**
	 * Read the full config. Callers (resolver, page loaders, route handlers)
	 * apply the visibility predicate from `serversVisibleTo` themselves —
	 * the store does not pre-filter, because the same row set is needed at
	 * different scopes (admin manage vs. org manage vs. solve).
	 *
	 * Servers come back with `apiKey: undefined` unless `includeApiKeys` is set.
	 * A returned server therefore says nothing about whether a key is *stored* —
	 * use `hasApiKey` for that.
	 */
	getConfig(ctx: RequestContext, opts?: GetConfigOptions): Promise<ComputeConfig>;

	/**
	 * Decrypted `apiKey` for a single server, or `undefined` when the server has
	 * no key stored, does not exist, or its ciphertext cannot be authenticated
	 * under the current `SELVA_AT_REST_KEY` (tolerated the same way `getConfig`
	 * tolerates it — the solve fails later at Rhino.Compute rather than here).
	 *
	 * This is the narrow path onto the solve hot path: resolve a server from the
	 * key-free config, then fetch that one key.
	 */
	getServerApiKey(ctx: RequestContext, serverId: string): Promise<string | undefined>;

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

	/**
	 * Boot-time integrity check: attempt to decrypt every stored `apiKey` and
	 * report any that are plaintext-at-rest or fail to decrypt under the current
	 * `SELVA_AT_REST_KEY`. Does NOT throw — returns a structured report so the
	 * caller (boot health) decides whether to refuse boot / drive `/api/health`
	 * to 503. Both encrypting stores (local file, Supabase) implement this;
	 * optional so a hypothetical non-encrypting store can omit it.
	 */
	verifySecrets?(): Promise<SecretVerificationReport>;
}
