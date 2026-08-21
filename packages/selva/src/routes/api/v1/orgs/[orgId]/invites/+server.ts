import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { createInvite, listInvites } from '$lib/server/api/handlers/invites';

export const GET: RequestHandler = mount('Failed to list invites', listInvites);
export const POST: RequestHandler = mount('Failed to create invite', createInvite);
