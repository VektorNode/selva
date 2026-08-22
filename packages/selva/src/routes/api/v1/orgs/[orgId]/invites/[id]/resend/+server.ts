import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { resendInvite } from '@selvajs/server/handlers';

export const POST: RequestHandler = mount('Failed to resend invite', resendInvite);
