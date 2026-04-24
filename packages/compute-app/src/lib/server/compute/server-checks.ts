import { resolveComputeServer, SYSTEM_CONTEXT } from '@selva/platform';
import { getComputeServerConfigStore } from '../providers.server';

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
	const config = await getComputeServerConfigStore().getConfig(SYSTEM_CONTEXT);
	const server = resolveComputeServer(config);
	const url = new URL(endpoint, server.serverUrl).toString();

	const headers: Record<string, string> = {};
	if (server.apiKey) {
		headers['RhinoComputeKey'] = server.apiKey;
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
