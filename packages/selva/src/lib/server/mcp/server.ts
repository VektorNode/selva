import { createMcpServer } from '@selvajs/mcp';
import { buildOpenApiDocument } from '$lib/server/api/v1/openapi';
import { INSTRUCTIONS, selvaTools } from './tools';

export const MCP_PATH = '/mcp';

let openapi: unknown;

/**
 * One streamable-HTTP MCP request, stateless. `handle` passes the caller's key
 * through to `/api/v1`, so every tool call is authenticated, scoped and
 * rate-limited exactly as that key's own requests are.
 *
 * `fetch` is SvelteKit's `event.fetch`: same-origin calls run in-process
 * instead of going back out through the proxy.
 */
export function handleMcp(request: Request, origin: string, fetch: typeof globalThis.fetch) {
	openapi ??= buildOpenApiDocument();
	const server = createMcpServer({
		name: 'selva',
		version: '1.0.0',
		instructions: INSTRUCTIONS,
		baseUrl: origin,
		fetch,
		openapi,
		tools: selvaTools(origin)
	});
	return server.handle(request);
}
