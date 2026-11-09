import { json } from '@sveltejs/kit';
import { DISCOVERY_HEADERS, oauthServer, oauthUnavailable } from '#lib/server/oauth/server.js';
import { publicUrl } from '#lib/server/origin.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const oauth = oauthServer(publicUrl(url).origin);
	if (!oauth) return oauthUnavailable();
	return json(oauth.protectedResourceMetadata(), { headers: DISCOVERY_HEADERS });
};
