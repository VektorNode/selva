import { createMcpServer, type ScopeAction, type UntypedApi } from '@selvajs/mcp';
import { parseApiScope } from '@selvajs/platform';
import { env } from '$env/dynamic/private';
import { buildOpenApiDocument } from '$lib/server/api/v1/openapi';
import { INSTRUCTIONS, selvaTools } from './tools';

export const MCP_PATH = '/mcp';

/** `write` and `solve` each include `read`, as `scopeAllows` decides at /api/v1. */
export async function grantedActions(api: UntypedApi): Promise<ScopeAction[]> {
	const me = (await api.call('getMe')) as { apiToken?: { scopes: string[] } };
	const actions = new Set<ScopeAction>();
	for (const s of me.apiToken?.scopes ?? []) {
		const scope = parseApiScope(s);
		if (!scope) continue;
		actions.add(scope.action).add('read');
	}
	return [...actions];
}

function mcpAllowedOrigins(): string[] {
	return (env.MCP_ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);
}

// Built once and reused: building indexes the OpenAPI document and resolves
// every tool, which an unauthenticated POST must not be able to trigger. One
// slot, not a map: the origin comes from the Host header, so a map would grow
// with whatever hosts a caller sends.
let cached: { origin: string; server: ReturnType<typeof createMcpServer> } | null = null;

/**
 * One streamable-HTTP MCP request, stateless. `handle` passes the caller's key
 * through to `/api/v1`, so every tool call is authenticated, scoped and
 * rate-limited exactly as that key's own requests are.
 *
 * `fetch` is SvelteKit's `event.fetch`: same-origin calls run in-process
 * instead of going back out through the proxy.
 */
export function handleMcp(request: Request, origin: string, fetch: typeof globalThis.fetch) {
	if (cached?.origin !== origin) {
		const server = createMcpServer({
			name: 'selva',
			version: '1.0.0',
			instructions: INSTRUCTIONS,
			baseUrl: origin,
			openapi: buildOpenApiDocument(),
			tools: selvaTools(origin),
			grantedActions,
			allowedOrigins: mcpAllowedOrigins()
		});
		cached = { origin, server };
	}
	return cached.server.handle(request, { fetch });
}
