import type { RequestHandler } from './$types';
import { handleMcp } from '$lib/server/mcp/server';

// Stateless streamable HTTP: every message is a POST; there is no session to GET or DELETE.
export const POST: RequestHandler = ({ request, url, fetch }) =>
	handleMcp(request, url.origin, fetch);
