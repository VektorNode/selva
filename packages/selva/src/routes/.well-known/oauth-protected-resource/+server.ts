import { json } from '@sveltejs/kit';
import { protectedResourceMetadata } from '@selvajs/server/oauth';
import { DISCOVERY_HEADERS } from '#lib/server/oauth/server.js';
import { publicUrl } from '#lib/server/origin.js';
import type { RequestHandler } from './$types';

// The bare path is the fallback clients probe when a 401 carries no pointer.
export const GET: RequestHandler = ({ url }) =>
	json(protectedResourceMetadata(publicUrl(url).origin), { headers: DISCOVERY_HEADERS });
