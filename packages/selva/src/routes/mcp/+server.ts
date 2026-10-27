import type { RequestHandler } from './$types';
import { handleMcp } from '#lib/server/mcp/server.js';
import { publicUrl } from '#lib/server/origin.js';

// Stateless streamable HTTP: every message is a POST; there is no session to GET or DELETE.
export const POST: RequestHandler = ({ request, url, fetch }) =>
	handleMcp(request, publicUrl(url).origin, fetch);
