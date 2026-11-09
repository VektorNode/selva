import { json } from '@sveltejs/kit';
import { DISCOVERY_HEADERS, oauthServer, oauthUnavailable } from '#lib/server/oauth/server.js';
import { publicUrl } from '#lib/server/origin.js';
import type { RequestHandler } from './$types';

// The bare path is the fallback clients probe when a 401 carries no pointer.
export const GET: RequestHandler = ({ url }) => {
	const oauth = oauthServer(publicUrl(url).origin);
	if (!oauth) return oauthUnavailable();
	return json(oauth.protectedResourceMetadata(), { headers: DISCOVERY_HEADERS });
};
