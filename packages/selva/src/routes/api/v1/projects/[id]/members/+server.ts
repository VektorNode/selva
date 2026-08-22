import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { addProjectMember, listProjectMembers } from '@selvajs/server/handlers';

export const GET: RequestHandler = mount('Failed to load members', listProjectMembers);
export const POST: RequestHandler = mount('Failed to add member', addProjectMember);
