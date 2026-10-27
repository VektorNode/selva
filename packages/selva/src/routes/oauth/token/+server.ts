import { json } from '@sveltejs/kit';
import { oauthRateLimited, oauthServer, oauthUnavailable } from '#lib/server/oauth/server.js';
import { publicUrl } from '#lib/server/origin.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const limited = oauthRateLimited(event);
	if (limited) return limited;
	const oauth = oauthServer(publicUrl(event.url).origin);
	if (!oauth) return oauthUnavailable();
	// RFC 6749 sends the token request form-encoded; some frameworks would default to JSON.
	const form = new URLSearchParams(await event.request.text());
	const { status, body } = oauth.exchange(form);
	return json(body, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
};
