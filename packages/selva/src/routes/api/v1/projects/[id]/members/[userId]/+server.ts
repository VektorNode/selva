import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import {
	removeProjectMember,
	updateProjectMemberRole
} from '$lib/server/api/handlers/projectMembers';

export const PATCH: RequestHandler = mount('Failed to update role', updateProjectMemberRole);
export const DELETE: RequestHandler = mount('Failed to remove member', removeProjectMember);
