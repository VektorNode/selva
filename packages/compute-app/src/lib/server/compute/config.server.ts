import { env } from '$env/dynamic/private';

export { getComputeServerProvider } from '../providers.server.js';

export type ServerConfig = {
	computeServerUrl: string;
	dataPath: string;
	computeApiKey?: string;
};

/**
 * Load and validate the raw compute server URL from environment variables.
 * Used by GrasshopperClient in route handlers — not a provider concern.
 */
export function getServerConfig(): ServerConfig {
	const computeServerUrl = env.COMPUTE_SERVER_URL;
	const dataPath = env.DATA_PATH;

	if (!computeServerUrl) {
		throw new Error('COMPUTE_SERVER_URL environment variable is required.');
	}

	if (!dataPath) {
		throw new Error('DATA_PATH environment variable is required.');
	}

	try {
		const parsed = new URL(computeServerUrl);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			throw new Error('COMPUTE_SERVER_URL must use http:// or https://');
		}
	} catch {
		throw new Error('COMPUTE_SERVER_URL must be a valid http(s) URL.');
	}

	return {
		computeServerUrl,
		dataPath,
		computeApiKey: env.COMPUTE_API_KEY
	};
}
