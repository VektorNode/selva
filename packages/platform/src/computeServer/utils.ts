import {
	isOrgServer,
	isPlatformServer,
	type ComputeConfig,
	type ComputeServerConfig
} from './types.js';

/**
 * Servers an org can see in pickers and use for solves. Architecture spec §4.8.
 *
 * = platform servers shared with this org (or `'all'`, or the global default)
 * ∪ org-private servers owned by this org
 *
 * The global default is always included — it's the floor of the system.
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
 * Resolve the default server id for an org. Per-org override → global default.
 * Returns `undefined` if neither is set or the chosen id is not visible.
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

/**
 * Resolve a definition's compute server. Architecture spec §4.8 resolution order:
 *   1. Definition pin (`computeServerId`) if visible to the project's org.
 *   2. `orgDefaults[orgId]` if set.
 *   3. Global `defaultServerId`.
 *
 * Pure — throws if no usable server exists.
 */
export interface ResolveOptions {
	/** Per-definition pin. Falls through silently if not visible. */
	definitionPin?: string | null;
}

export function resolveServerForOrg(
	config: ComputeConfig,
	orgId: string | null | undefined,
	opts: ResolveOptions = {}
): ComputeServerConfig {
	const visible = serversVisibleTo(config, orgId);
	if (visible.length === 0) {
		throw new Error('No compute servers are configured or visible for this org.');
	}

	if (opts.definitionPin) {
		const pinned = visible.find((s) => s.id === opts.definitionPin);
		if (pinned) return pinned;
		// Fall through — admin may have un-shared the server since the pin
		// was set.
	}

	const defaultId = defaultServerIdFor(config, orgId);
	if (defaultId) {
		const found = visible.find((s) => s.id === defaultId);
		if (found) return found;
	}

	// Last resort — return the first visible server. Mostly applies in tests
	// and during initial setup before a default is chosen.
	return visible[0];
}

/**
 * Lookup by id, regardless of scope or visibility. Useful in admin contexts
 * that need to display a server independently of the visibility filter.
 */
export function findServerById(config: ComputeConfig, id: string): ComputeServerConfig | undefined {
	return config.servers.find((s) => s.id === id);
}

// ============================================================================
// Filters
// ============================================================================

export function platformServers(config: ComputeConfig) {
	return config.servers.filter(isPlatformServer);
}

export function orgServersFor(config: ComputeConfig, orgId: string) {
	return config.servers.filter((s) => isOrgServer(s) && s.ownerOrgId === orgId);
}
