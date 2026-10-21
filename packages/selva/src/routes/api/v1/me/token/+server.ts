import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { revokeOwnApiToken } from '@selvajs/server/handlers';

export const DELETE: RequestHandler = mount('Failed to revoke API token', revokeOwnApiToken, {
	anyScope: true
});
