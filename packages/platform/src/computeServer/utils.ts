import type { ComputeConfig, ComputeServerConfig, SolveRequest } from './types.js';

/**
 * Resolve which server to use for a given solve request.
 * Pure function — no I/O. Takes a loaded ComputeConfig.
 * Throws if no server is configured.
 */
export function resolveComputeServer(
	config: ComputeConfig,
	request?: SolveRequest
): ComputeServerConfig {
	if (config.defaultServerId) {
		const found = config.servers.find((s) => s.id === config.defaultServerId);
		if (found) return found;
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
