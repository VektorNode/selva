import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { listOrgMembers } from '$lib/server/api/handlers/orgs';

export const GET: RequestHandler = mount('Failed to list organization members', listOrgMembers);
