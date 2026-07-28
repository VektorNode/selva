/**
 * Compute servers belong to one of two scopes — never both.
 *
 * - **Platform server** (`scope: 'platform'`) — created by `manage_compute`.
 *   `sharedWith` controls which orgs see it. The single global
 *   `defaultServerId` (in {@link ComputeConfig}) must reference a platform
 *   server and is *always* visible to every org regardless of `sharedWith`.
 *
 * - **Org-private server** (`scope: 'org'`) — created by an org owner/admin
 *   with `manage_org_compute`. Visible only to its `ownerOrgId`. Gated by
 *   the `ALLOW_ORG_COMPUTE_OVERRIDE` platform flag.
 *
 * Architecture spec §4.8.
 */
export type ComputeServerConfig = PlatformComputeServer | OrgComputeServer;

interface ComputeServerCommon {
	id: string;
	label: string;
	/** Base URL of the Rhino.Compute instance. */
	serverUrl: string;
	/**
	 * Sent as `RhinoComputeKey` header. Populated only when the config was read
	 * with `includeApiKeys`, so `apiKey === undefined` means "not loaded" just as
	 * often as it means "none stored" — read {@link ComputeServerCommon.hasApiKey}
	 * to tell those apart.
	 */
	apiKey?: string;
	/**
	 * Whether a key is stored for this server, independent of whether `apiKey`
	 * was loaded. Lets pickers and admin pages render "key set" without any store
	 * decrypting a secret it will only throw away.
	 */
	hasApiKey?: boolean;
	/** Default: 30000. */
	timeoutMs?: number;
	/** Default: 0. */
	retryCount?: number;
}

export interface PlatformComputeServer extends ComputeServerCommon {
	scope: 'platform';
	/**
	 * Which orgs can see this server in pickers / use it for solves.
	 *   - `'all'`  — every org. Default in `tenancy: 'single'`.
	 *   - `string[]` — explicit org-id allowlist. `[]` = dormant
	 *     (admin-only) unless this server is the global `defaultServerId`,
	 *     which is always usable everywhere.
	 */
	sharedWith: 'all' | string[];
}

export interface OrgComputeServer extends ComputeServerCommon {
	scope: 'org';
	/** The org that owns this server. Visible only to members of this org. */
	ownerOrgId: string;
}

export interface ComputeConfig {
	servers: ComputeServerConfig[];
	/**
	 * Global default. Must reference a platform server. Always usable by
	 * every org regardless of that server's `sharedWith` — this is the
	 * "baseline server any user uses" floor.
	 */
	defaultServerId?: string;
	/**
	 * Per-org default override. `orgDefaults[orgId]` must reference a server
	 * that is visible to `orgId` (a platform server with `orgId` in
	 * `sharedWith` or `'all'`, or an org server owned by `orgId`).
	 */
	orgDefaults?: Record<string, string>;
}

// ============================================================================
// Type guards
// ============================================================================

export function isPlatformServer(s: ComputeServerConfig): s is PlatformComputeServer {
	return s.scope === 'platform';
}

export function isOrgServer(s: ComputeServerConfig): s is OrgComputeServer {
	return s.scope === 'org';
}
