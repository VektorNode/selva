import type { RequestContext } from '../context.js';
import type { ComputeConfig, ComputeServerConfig } from './types.js';
import type { SecretVerificationReport } from './secrets.js';

/**
 * One config doc holds *all* servers (platform + org-private) plus the
 * global `defaultServerId` and per-org `orgDefaults` map. Authorization is
 * the route layer's job — `manage_compute` for platform-server mutations,
 * `manage_org_compute` (gated by the `ALLOW_ORG_COMPUTE_OVERRIDE` flag) for
 * org-private mutations and `orgDefaults[orgId]`.
 */
export interface GetConfigOptions {
	/**
	 * Include each server's decrypted `apiKey`. Defaults to `false` — most
	 * callers (pickers, page loaders, the resolver) only need connection
	 * metadata, and decrypting every stored key costs one decrypt per server
	 * per call on the solve path.
	 *
	 * Set this only when you need every server's key at once — the
	 * admin/org save handlers, which diff and preserve keys across a write.
	 * For a single server's key, resolve the server first and call
	 * `getServerApiKey` for just that one.
	 */
	includeApiKeys?: boolean;

	/**
	 * Narrow the result to what this org may see: `serversVisibleTo(orgId)`,
	 * `orgDefaults` reduced to this org's entry, and `defaultServerId` blanked
	 * when the global default is not among them.
	 *
	 * Org-facing surfaces must pass this. Without it the store hands back every
	 * platform server and every *other* org's private servers, leaving each
	 * caller to re-apply a filter it can silently forget — the global
	 * `defaultServerId` in particular passed straight through before this
	 * existed. Admin surfaces, boot health and the save-diff handlers omit it
	 * deliberately; they act instance-wide.
	 */
	scopeToOrgId?: string;
}

export interface IComputeServerStore {
	/**
	 * Reads the config. Instance-wide by default — the same row set is needed at
	 * different scopes (admin manage vs. org manage vs. solve). Pass
	 * `scopeToOrgId` on any org-facing surface so the narrowing happens here
	 * rather than in each caller.
	 *
	 * Servers come back with `apiKey: undefined` unless `includeApiKeys` is
	 * set, so a returned server says nothing about whether a key is *stored*
	 * — use `hasApiKey` for that.
	 */
	getConfig(ctx: RequestContext, opts?: GetConfigOptions): Promise<ComputeConfig>;

	/**
	 * Decrypted `apiKey` for a single server, or `undefined` when the server
	 * has no key stored, does not exist, or its ciphertext cannot be
	 * authenticated under the current `SELVA_AT_REST_KEY` (the solve fails
	 * later at Rhino.Compute rather than here).
	 *
	 * The narrow path onto the solve hot path: resolve a server from the
	 * key-free config, then fetch that one key.
	 */
	getServerApiKey(ctx: RequestContext, serverId: string): Promise<string | undefined>;

	/** Replaces the entire platform-server set + global `defaultServerId`. Org-private rows and `orgDefaults` are left untouched. */
	savePlatformServers(
		ctx: RequestContext,
		servers: ComputeServerConfig[],
		defaultServerId: string | undefined
	): Promise<void>;

	/**
	 * Replaces the org-private server set for `orgId` and (optionally) updates
	 * `orgDefaults[orgId]`. Platform rows are left untouched.
	 *
	 * `defaultServerId: null` clears the org's override; `undefined` leaves
	 * the existing value alone.
	 */
	saveOrgServers(
		ctx: RequestContext,
		orgId: string,
		servers: ComputeServerConfig[],
		defaultServerId?: string | null
	): Promise<void>;

	/**
	 * Sets or clears `orgDefaults[orgId]`. The route layer must verify the
	 * chosen server is visible to the org before calling this. `serverId ===
	 * null` clears the override.
	 */
	setOrgDefault(ctx: RequestContext, orgId: string, serverId: string | null): Promise<void>;

	/**
	 * Hard-deletes this org's compute rows: org-private servers, the
	 * `orgDefaults[orgId]` entry, and any references to this org inside
	 * platform servers' `sharedWith` allowlists. No-op when none exist.
	 * Called from `deleteOrg` so soft-deleting an org doesn't leave its
	 * compute config behind.
	 */
	deleteByOrg(ctx: RequestContext, orgId: string): Promise<void>;

	/**
	 * Boot-time integrity check: decrypts every stored `apiKey` and reports
	 * any that are plaintext-at-rest or fail to decrypt under the current
	 * `SELVA_AT_REST_KEY`. Does not throw — returns a structured report so
	 * the caller (boot health) decides whether to refuse boot / drive
	 * `/api/health` to 503. Optional so a non-encrypting store can omit it.
	 */
	verifySecrets?(): Promise<SecretVerificationReport>;
}
