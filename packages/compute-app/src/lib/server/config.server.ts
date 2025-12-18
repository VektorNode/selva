import { env } from '$env/dynamic/private';

export function getServerConfig() {
	const computeServerUrl = env.COMPUTE_SERVER_URL;
	const ghDefinitionsBaseUrl = env.GH_DEFINITION_URL;

	if (!computeServerUrl) {
		throw new Error('COMPUTE_SERVER_URL environment variable is required');
	}

	if (!ghDefinitionsBaseUrl) {
		throw new Error('GH_DEFINITIONS_BASE_URL environment variable is required');
	}

	return {
		computeServerUrl,
		ghDefinitionsBaseUrl,
		computeApiKey: env.COMPUTE_API_KEY
	};
}
