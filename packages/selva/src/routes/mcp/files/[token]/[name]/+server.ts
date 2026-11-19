import type { RequestHandler } from './$types';
import { mcpStash } from '#lib/server/mcp/stash-instance.js';

// `name` is only for the browser's save dialog: the token alone picks the file.
export const GET: RequestHandler = async ({ params }) => {
	const entry = await mcpStash().get(params.token, 'file');
	if (!entry) {
		return new Response('This link has expired. Solve again for a new one.', {
			status: 404,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	}
	// Always a download, never rendered: the bytes are whatever the definition wrote.
	return new Response(Buffer.from(entry.data), {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
