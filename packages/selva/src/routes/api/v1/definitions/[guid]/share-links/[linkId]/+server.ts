import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { revokeShareLink } from '$lib/server/api/handlers/shareLinks';

export const DELETE: RequestHandler = mount('Failed to revoke share link', revokeShareLink);
