import { json } from '@sveltejs/kit';
import { authorizationServerMetadata } from '@selvajs/server/oauth';
import { DISCOVERY_HEADERS } from '$lib/server/oauth/server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) =>
	json(authorizationServerMetadata(url.origin), { headers: DISCOVERY_HEADERS });
