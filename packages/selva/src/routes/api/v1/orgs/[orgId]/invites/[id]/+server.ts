import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { revokeInvite } from '$lib/server/api/handlers/invites';

export const DELETE: RequestHandler = mount('Failed to revoke invite', revokeInvite);
