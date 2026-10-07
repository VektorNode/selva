import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { projectScopeTarget } from '@selvajs/server/api';
import { addProjectMember, listProjectMembers } from '@selvajs/server/handlers';

const scopeTarget = projectScopeTarget('id');

export const GET: RequestHandler = mount('Failed to load members', listProjectMembers, {
	scopeTarget
});
export const POST: RequestHandler = mount('Failed to add member', addProjectMember, {
	scopeTarget
});
