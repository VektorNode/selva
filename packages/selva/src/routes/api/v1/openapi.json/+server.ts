import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { buildOpenApiDocument } from '$lib/server/api/v1/openapi';

// Public, like `/docs/api/openapi.yaml`: it documents the API's shape, not tenant data.
// `@selvajs/mcp` checks its tools against this at startup.
let document: unknown;

export const GET: RequestHandler = mount('Failed to build the API document', async () => {
	document ??= buildOpenApiDocument();
	return { body: document, headers: { 'Cache-Control': 'public, max-age=300' } };
});
