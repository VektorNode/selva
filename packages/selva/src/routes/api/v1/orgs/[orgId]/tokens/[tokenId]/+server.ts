import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { revokeApiToken } from '@selvajs/server/handlers';

export const DELETE: RequestHandler = mount('Failed to revoke API token', revokeApiToken);
