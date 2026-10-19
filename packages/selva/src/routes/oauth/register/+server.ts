import { json } from '@sveltejs/kit';
import { oauthRateLimited, oauthServer, oauthUnavailable } from '$lib/server/oauth/server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const limited = oauthRateLimited(event);
	if (limited) return limited;
	const oauth = oauthServer(event.url.origin);
	if (!oauth) return oauthUnavailable();
	const body = await event.request.json().catch(() => null);
	const { status, body: out } = oauth.register(body);
	return json(out, { status, headers: { 'Cache-Control': 'no-store' } });
};
