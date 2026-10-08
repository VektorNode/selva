import { createMcpServer } from '@selvajs/mcp';
import { buildOpenApiDocument } from '$lib/server/api/v1/openapi';
import { INSTRUCTIONS, selvaTools } from './tools';

export const MCP_PATH = '/mcp';

let openapi: unknown;

/**
 * One streamable-HTTP MCP request, stateless. The caller's key is passed
 * through to `/api/v1`, so every tool call is authenticated, scoped and
 * rate-limited exactly as that key's own requests are.
 *
 * `fetch` is SvelteKit's `event.fetch`: same-origin calls run in-process
 * instead of going back out through the proxy.
 */
export async function handleMcp(request: Request, origin: string, fetch: typeof globalThis.fetch) {
	const key = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
	if (!key) {
		return new Response(
			JSON.stringify({
				message: 'Send an API key as `Authorization: Bearer <key>`.',
				code: 'UNAUTHORIZED'
			}),
			{
				status: 401,
				headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' }
			}
		);
	}

	openapi ??= buildOpenApiDocument();
	const server = createMcpServer({
		name: 'selva',
		version: '1.0.0',
		instructions: INSTRUCTIONS,
		baseUrl: origin,
		apiKey: key,
		fetch,
		openapi,
		tools: selvaTools(origin)
	});
	return server.handle(request);
}
