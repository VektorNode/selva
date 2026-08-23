import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { revokeShareLink } from '@selvajs/server/handlers';

export const DELETE: RequestHandler = mount('Failed to revoke share link', revokeShareLink);
