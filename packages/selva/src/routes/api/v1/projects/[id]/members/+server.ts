import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { addProjectMember, listProjectMembers } from '$lib/server/api/handlers/projectMembers';

export const GET: RequestHandler = mount('Failed to load members', listProjectMembers);
export const POST: RequestHandler = mount('Failed to add member', addProjectMember);
