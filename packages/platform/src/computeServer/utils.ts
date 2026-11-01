import {
	COMPUTE_RETRY_MAX,
	COMPUTE_TIMEOUT_DEFAULT_MS,
	COMPUTE_TIMEOUT_MAX_MS,
	COMPUTE_TIMEOUT_MIN_MS,
	isPlatformServer,
	type ComputeConfig,
	type ComputeServerConfig
} from './types.js';

/**
 * Servers an org can see in pickers and use for solves:
 * platform servers shared with this org (or `'all'`, or the global default)
 * ∪ org-private servers owned by this org.
 */
export function serversVisibleTo(
	config: ComputeConfig,
	orgId: string | null | undefined
): ComputeServerConfig[] {
	return config.servers.filter((s) => {
		if (isPlatformServer(s)) {
			if (s.id === config.defaultServerId) return true;
			if (s.sharedWith === 'all') return true;
			if (orgId && s.sharedWith.includes(orgId)) return true;
			return false;
		}
		// Org-private — visible only to its owner org.
		return !!orgId && s.ownerOrgId === orgId;
	});
}

/**
 * Resolves the default server id for an org: per-org override, then global
 * default. Returns `undefined` if neither is set or visible.
 */
export function defaultServerIdFor(
	config: ComputeConfig,
	orgId: string | null | undefined
): string | undefined {
	const visible = serversVisibleTo(config, orgId);
	const visibleIds = new Set(visible.map((s) => s.id));

	if (orgId) {
		const orgChoice = config.orgDefaults?.[orgId];
		if (orgChoice && visibleIds.has(orgChoice)) return orgChoice;
	}
	if (config.defaultServerId && visibleIds.has(config.defaultServerId)) {
		return config.defaultServerId;
	}
	return undefined;
}

export interface ResolveOptions {
	/** Per-definition pin. Falls through silently if not visible. */
	definitionPin?: string | null;
}

/**
 * From servers already filtered for visibility, the pin if it is among them, then
 * the default, then the first. Only for a caller holding the filtered list: use
 * {@link resolveServerForOrg} when you have the config.
 */
export function pickServer<T extends { id: string }>(
	visible: readonly T[],
	defaultId: string | null | undefined,
	pin: string | null | undefined
): T | undefined {
	// A pin can go stale when an admin un-shares the server, so it falls through.
	return visible.find((s) => s.id === pin) ?? visible.find((s) => s.id === defaultId) ?? visible[0];
}

/**
 * Resolves a definition's compute server, in order:
 *   1. Definition pin (`computeServerId`) if visible to the project's org.
 *   2. `orgDefaults[orgId]` if set.
 *   3. Global `defaultServerId`.
 *   4. The first visible server, mainly before a default is chosen.
 *
 * Throws if no usable server exists.
 */
export function resolveServerForOrg(
	config: ComputeConfig,
	orgId: string | null | undefined,
	opts: ResolveOptions = {}
): ComputeServerConfig {
	const visible = serversVisibleTo(config, orgId);
	const server = pickServer(visible, defaultServerIdFor(config, orgId), opts.definitionPin);
	if (!server) throw new Error('No compute servers are configured or visible for this org.');
	return server;
}

/**
 * The config as one org may see it: visible servers only, `orgDefaults` reduced
 * to this org's own entry, and `defaultServerId` dropped when the global default
 * is not visible here.
 *
 * Applied inside `getConfig` when `scopeToOrgId` is passed, so an org-facing
 * caller cannot forget the filter and leak other orgs' server URLs or the
 * instance's default choice.
 */
export function scopeConfigToOrg(config: ComputeConfig, orgId: string): ComputeConfig {
	const servers = serversVisibleTo(config, orgId);
	const visibleIds = new Set(servers.map((s) => s.id));
	const orgDefault = config.orgDefaults?.[orgId];

	return {
		servers,
		defaultServerId:
			config.defaultServerId && visibleIds.has(config.defaultServerId)
				? config.defaultServerId
				: undefined,
		orgDefaults: orgDefault && visibleIds.has(orgDefault) ? { [orgId]: orgDefault } : {}
	};
}

/** Lookup by id, ignoring scope or visibility — for admin contexts that display a server outside the visibility filter. */
export function findServerById(config: ComputeConfig, id: string): ComputeServerConfig | undefined {
	return config.servers.find((s) => s.id === id);
}

// ============================================================================
// Filters
// ============================================================================

export function platformServers(config: ComputeConfig) {
	return config.servers.filter(isPlatformServer);
}

/** What a compute settings form should send for a typed timeout. */
export function clampTimeoutMs(value: unknown): number {
	const ms = Number(value) || COMPUTE_TIMEOUT_DEFAULT_MS;
	return Math.min(COMPUTE_TIMEOUT_MAX_MS, Math.max(COMPUTE_TIMEOUT_MIN_MS, ms));
}

/** What a compute settings form should send for a typed retry count. */
export function clampRetryCount(value: unknown): number {
	return Math.min(COMPUTE_RETRY_MAX, Math.max(0, Number(value) || 0));
}
