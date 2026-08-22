import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { createInvite, listInvites } from '@selvajs/server/handlers';

export const GET: RequestHandler = mount('Failed to list invites', listInvites);
export const POST: RequestHandler = mount('Failed to create invite', createInvite);
