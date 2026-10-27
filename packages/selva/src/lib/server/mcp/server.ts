import { createMcpServer, type ScopeAction, type UntypedApi } from '@selvajs/mcp';
import { ApiScopeActionSchema, apiScopeActionCovers, parseApiScope } from '@selvajs/platform';
import { env } from '$env/dynamic/private';
import { REGISTERED_CLIENT_SCOPES, resourceMetadataUrl } from '@selvajs/server/oauth';
import { oauthServer } from '$lib/server/oauth/server';
import { buildOpenApiDocument } from '$lib/server/api/v1/openapi';
import { INSTRUCTIONS, selvaTools } from './tools';

export const MCP_PATH = '/mcp';

/** Every action the key's scopes cover, as `scopeAllows` decides at /api/v1. */
export async function grantedActions(api: UntypedApi): Promise<ScopeAction[]> {
	const me = (await api.call('getMe')) as { apiToken?: { scopes: string[] } };
	const actions = new Set<ScopeAction>();
	for (const s of me.apiToken?.scopes ?? []) {
		const scope = parseApiScope(s);
		if (!scope) continue;
		for (const action of ApiScopeActionSchema.options) {
			if (apiScopeActionCovers(scope.action, action)) actions.add(action);
		}
	}
	return [...actions];
}

function mcpAllowedOrigins(): string[] {
	return (env.MCP_ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);
}

// Building a server indexes the OpenAPI document and resolves every tool, which
// an unauthenticated POST must not be able to trigger per request. The origin
// comes from the Host header unless ORIGIN is set, so the cache is a small LRU:
// a caller alternating hosts can't grow it, and an occasional rebuild reuses
// the origin-free document.
const MAX_CACHED_ORIGINS = 4;
const servers = new Map<string, ReturnType<typeof createMcpServer>>();
let openapi: ReturnType<typeof buildOpenApiDocument> | undefined;

function serverFor(origin: string): ReturnType<typeof createMcpServer> {
	const hit = servers.get(origin);
	if (hit) {
		servers.delete(origin);
		servers.set(origin, hit);
		return hit;
	}
	openapi ??= buildOpenApiDocument();
	const server = createMcpServer({
		name: 'selva',
		version: '1.0.0',
		instructions: INSTRUCTIONS,
		baseUrl: origin,
		openapi,
		tools: selvaTools(origin),
		grantedActions,
		allowedOrigins: mcpAllowedOrigins(),
		// Only when OAuth can run: a challenge pointing at a 503 sends clients nowhere.
		...(oauthServer(origin) && {
			challenge: {
				resourceMetadataUrl: resourceMetadataUrl(origin),
				scopes: [...REGISTERED_CLIENT_SCOPES]
			}
		})
	});
	if (servers.size >= MAX_CACHED_ORIGINS) servers.delete(servers.keys().next().value!);
	servers.set(origin, server);
	return server;
}

/**
 * One streamable-HTTP MCP request, stateless. `handle` passes the caller's key
 * through to `/api/v1`, so every tool call is authenticated, scoped and
 * rate-limited exactly as that key's own requests are.
 *
 * `fetch` is SvelteKit's `event.fetch`: same-origin calls run in-process
 * instead of going back out through the proxy.
 */
export function handleMcp(request: Request, origin: string, fetch: typeof globalThis.fetch) {
	return serverFor(origin).handle(request, { fetch });
}
