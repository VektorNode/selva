import type { ComputeConfig, ComputeServerConfig } from './types.js';

/**
 * Resolve which server to use for a given solve request.
 * Pure function — no I/O. Takes a loaded ComputeConfig.
 * Throws if no server is configured.
 */
export function resolveComputeServer(config: ComputeConfig): ComputeServerConfig {
	if (config.defaultServerId) {
		const found = config.servers.find((s) => s.id === config.defaultServerId);
		if (!found)
			throw new Error(
				`defaultServerId "${config.defaultServerId}" not found in servers list`
			);
		return found;
	}

	const first = config.servers[0];
	if (!first) throw new Error('No compute servers configured');
	return first;
}

export function resolveServerById(
	config: ComputeConfig,
	id: string
): ComputeServerConfig | undefined {
	return config.servers.find((s) => s.id === id);
}

/**
 * Spec §3 BYO compute resolution. Returns the org's override server when one
 * exists AND the platform flag `ALLOW_ORG_COMPUTE_OVERRIDE` is on; otherwise
 * falls back to the instance pool. Pure function — callers fetch both
 * configs upstream.
 *
 * `orgConfig` may be `null` (no org scope) or empty (scope exists but no
 * servers configured) — both fall through to the instance pool.
 */
export interface OrgComputeOptions {
	allowOrgOverride: boolean;
}

export function resolveComputeServerForOrg(
	instanceConfig: ComputeConfig,
	orgConfig: ComputeConfig | null,
	opts: OrgComputeOptions
): ComputeServerConfig {
	if (opts.allowOrgOverride && orgConfig && orgConfig.servers.length > 0) {
		return resolveComputeServer(orgConfig);
	}
	return resolveComputeServer(instanceConfig);
}
