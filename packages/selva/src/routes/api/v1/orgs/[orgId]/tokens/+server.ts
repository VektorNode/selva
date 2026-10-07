import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { createApiToken, listApiTokens } from '@selvajs/server/handlers';

export const GET: RequestHandler = mount('Failed to list API tokens', listApiTokens);
export const POST: RequestHandler = mount('Failed to create API token', createApiToken);
