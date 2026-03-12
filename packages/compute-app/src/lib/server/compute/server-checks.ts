import { getServerConfig } from './config.server';

interface ComputeEndpointResponseMap {
	'/version': { rhino: string; compute: string; git_sha: string | null };
	'/plugins/gh/installed': Record<string, string>;
	'/plugins/rhino/installed': Record<string, string>;
	'/healthcheck': string;
}

type ComputeEndpoint = keyof ComputeEndpointResponseMap | (string & {});
type ComputeEndpointResponse<T extends ComputeEndpoint> = T extends keyof ComputeEndpointResponseMap
	? ComputeEndpointResponseMap[T]
	: unknown;

export async function getComputeEndpoint<T extends ComputeEndpoint>(
	endpoint: T
): Promise<ComputeEndpointResponse<T>> {
	const config = getServerConfig();
	const url = new URL(endpoint, config.computeServerUrl).toString();

	const headers: Record<string, string> = {};
	if (config.computeApiKey) {
		headers['RhinoComputeKey'] = config.computeApiKey;
	}

	const response = await fetch(url, { headers });
	if (!response.ok) {
		throw new Error(`Failed to fetch ${endpoint}: ${response.statusText}`);
	}

	if (endpoint === '/healthcheck') {
		return response.text() as Promise<ComputeEndpointResponse<T>>;
	}

	return response.json() as Promise<ComputeEndpointResponse<T>>;
}
