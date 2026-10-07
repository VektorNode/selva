import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { projectScopeTarget } from '@selvajs/server/api';
import { removeProjectMember, updateProjectMemberRole } from '@selvajs/server/handlers';

const scopeTarget = projectScopeTarget('id');

export const PATCH: RequestHandler = mount('Failed to update role', updateProjectMemberRole, {
	scopeTarget
});
export const DELETE: RequestHandler = mount('Failed to remove member', removeProjectMember, {
	scopeTarget
});
